use crate::{Capability, HttpMethod, Manifest, NetworkDomain, PluginError};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, BTreeSet, HashMap, VecDeque},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use url::Url;

const MAX_REQUEST_BYTES: usize = 1024 * 1024;
const MAX_RESPONSE_BYTES: usize = 2 * 1024 * 1024;
const MAX_REDIRECTS: usize = 3;
const MAX_REQUESTS_PER_MINUTE: usize = 120;

#[derive(Debug, Clone)]
pub struct ExecutionContext {
    pub plugin_id: String,
    pub plugin_version: String,
    pub publisher_id: String,
    pub owner_id: String,
    pub workspace_id: Option<String>,
    pub execution_id: String,
    pub node_id: String,
    pub plugin_major_version: u64,
    pub approved_capabilities: BTreeSet<String>,
    pub network_domains: Vec<NetworkDomain>,
    pub approved_credential_references: BTreeMap<String, String>,
    pub approved_credential_operations: BTreeMap<String, BTreeSet<String>>,
    pub persistent_quota_bytes: u64,
    pub temporary_quota_bytes: u64,
    pub cancellation: Arc<AtomicBool>,
}

impl ExecutionContext {
    pub fn from_manifest(
        manifest: &Manifest,
        execution_id: impl Into<String>,
        node_id: impl Into<String>,
    ) -> Self {
        let mut credential_operations = BTreeMap::<String, BTreeSet<String>>::new();
        let mut persistent_quota_bytes = 0;
        let mut temporary_quota_bytes = 0;
        for capability in &manifest.capabilities {
            match capability {
                Capability::CredentialOperations {
                    credential_type,
                    operations,
                } => {
                    credential_operations
                        .entry(credential_type.clone())
                        .or_default()
                        .extend(operations.iter().cloned());
                }
                Capability::PersistentStorage { max_bytes } => {
                    persistent_quota_bytes = manifest
                        .storage_requirements
                        .persistent_bytes
                        .min(*max_bytes);
                }
                Capability::TemporaryStorage { max_bytes } => {
                    temporary_quota_bytes = manifest
                        .storage_requirements
                        .temporary_bytes
                        .min(*max_bytes);
                }
                _ => {}
            }
        }
        Self {
            plugin_id: manifest.plugin_id.clone(),
            plugin_version: manifest.version.to_string(),
            publisher_id: manifest.publisher_id.clone(),
            owner_id: "personal-local".into(),
            workspace_id: None,
            execution_id: execution_id.into(),
            node_id: node_id.into(),
            plugin_major_version: manifest.version.major,
            approved_capabilities: manifest.capabilities.iter().map(Capability::key).collect(),
            network_domains: manifest.network_domains.clone(),
            approved_credential_references: BTreeMap::new(),
            approved_credential_operations: credential_operations,
            persistent_quota_bytes,
            temporary_quota_bytes,
            cancellation: Arc::new(AtomicBool::new(false)),
        }
    }

    fn ensure_active(&self) -> Result<(), PluginError> {
        if self.cancellation.load(Ordering::SeqCst) {
            Err(PluginError::Cancelled)
        } else {
            Ok(())
        }
    }

    fn require(&self, capability: &str) -> Result<(), PluginError> {
        self.ensure_active()?;
        if self.approved_capabilities.contains(capability) {
            Ok(())
        } else {
            Err(PluginError::Permission(format!(
                "Capability '{capability}' was not approved."
            )))
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct HttpRequest {
    pub url: String,
    pub method: HttpMethod,
    #[serde(default)]
    pub headers: BTreeMap<String, String>,
    #[serde(default)]
    pub body_base64: Option<String>,
    #[serde(default = "default_timeout")]
    pub timeout_ms: u64,
}

fn default_timeout() -> u64 {
    30_000
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct HttpResponse {
    pub status: u16,
    pub headers: BTreeMap<String, String>,
    pub body: Vec<u8>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(
    tag = "operation",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
pub enum HostRequest {
    HttpRequest(HttpRequest),
    CredentialOperation {
        credential_reference: String,
        credential_type: String,
        action: String,
        #[serde(default)]
        input: Value,
    },
    Log {
        level: String,
        message: String,
        #[serde(default)]
        fields: Value,
    },
    StorageGet {
        key: String,
        #[serde(default)]
        temporary: bool,
    },
    StoragePut {
        key: String,
        value_base64: String,
        #[serde(default)]
        temporary: bool,
    },
    StorageDelete {
        key: String,
        #[serde(default)]
        temporary: bool,
    },
    Time,
    RandomIdentifier,
    CryptoSha256 {
        value_base64: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct HostResponse {
    pub value: Value,
    #[serde(default)]
    pub diagnostics: Vec<String>,
}

pub trait NetworkTransport: Send + Sync {
    fn send(&self, request: &HttpRequest) -> Result<HttpResponse, PluginError>;
}

pub trait CredentialOperationBroker: Send + Sync {
    fn execute(
        &self,
        credential_id: &str,
        credential_type: &str,
        operation: &str,
        input: &Value,
    ) -> Result<Value, PluginError>;
}

#[derive(Debug, Clone, Hash, PartialEq, Eq)]
pub struct StorageScope {
    pub plugin_id: String,
    pub publisher_id: String,
    pub owner_id: String,
    pub workspace_id: Option<String>,
    pub major_version: Option<u64>,
    pub temporary_execution_id: Option<String>,
}

pub trait PluginStorage: Send + Sync {
    fn get(&self, scope: &StorageScope, key: &str) -> Result<Option<Vec<u8>>, PluginError>;
    fn put(
        &self,
        scope: &StorageScope,
        key: &str,
        value: &[u8],
        quota: u64,
    ) -> Result<(), PluginError>;
    fn delete(&self, scope: &StorageScope, key: &str) -> Result<(), PluginError>;
    fn used_bytes(&self, scope: &StorageScope) -> Result<u64, PluginError>;
}

#[derive(Default)]
pub struct InMemoryPluginStorage {
    values: Mutex<HashMap<(StorageScope, String), Vec<u8>>>,
}

impl PluginStorage for InMemoryPluginStorage {
    fn get(&self, scope: &StorageScope, key: &str) -> Result<Option<Vec<u8>>, PluginError> {
        validate_storage_key(key)?;
        Ok(self
            .values
            .lock()
            .get(&(scope.clone(), key.into()))
            .cloned())
    }

    fn put(
        &self,
        scope: &StorageScope,
        key: &str,
        value: &[u8],
        quota: u64,
    ) -> Result<(), PluginError> {
        validate_storage_key(key)?;
        let mut values = self.values.lock();
        let map_key = (scope.clone(), key.to_string());
        let previous = values.get(&map_key).map_or(0, Vec::len) as u64;
        let used: u64 = values
            .iter()
            .filter(|((item, _), _)| item == scope)
            .map(|(_, value)| value.len() as u64)
            .sum();
        let next = used
            .saturating_sub(previous)
            .saturating_add(value.len() as u64);
        if next > quota {
            return Err(PluginError::Storage(format!(
                "Storage quota of {quota} bytes would be exceeded."
            )));
        }
        values.insert(map_key, value.to_vec());
        Ok(())
    }

    fn delete(&self, scope: &StorageScope, key: &str) -> Result<(), PluginError> {
        validate_storage_key(key)?;
        self.values.lock().remove(&(scope.clone(), key.into()));
        Ok(())
    }

    fn used_bytes(&self, scope: &StorageScope) -> Result<u64, PluginError> {
        Ok(self
            .values
            .lock()
            .iter()
            .filter(|((item, _), _)| item == scope)
            .map(|(_, value)| value.len() as u64)
            .sum())
    }
}

pub struct ReqwestTransport {
    client: reqwest::blocking::Client,
}

impl ReqwestTransport {
    pub fn new() -> Result<Self, PluginError> {
        let client = reqwest::blocking::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .https_only(true)
            .user_agent("SandboxPluginHost/0.3")
            .build()
            .map_err(|error| PluginError::Host(error.to_string()))?;
        Ok(Self { client })
    }
}

impl NetworkTransport for ReqwestTransport {
    fn send(&self, request: &HttpRequest) -> Result<HttpResponse, PluginError> {
        let method = reqwest::Method::from_bytes(request.method.as_str().as_bytes())
            .map_err(|error| PluginError::Host(error.to_string()))?;
        let mut builder = self
            .client
            .request(method, &request.url)
            .timeout(Duration::from_millis(request.timeout_ms));
        for (name, value) in &request.headers {
            builder = builder.header(name, value);
        }
        if let Some(body) = &request.body_base64 {
            builder = builder.body(
                BASE64
                    .decode(body)
                    .map_err(|_| PluginError::Host("HTTP body is not valid base64.".into()))?,
            );
        }
        let response = builder
            .send()
            .map_err(|error| PluginError::Host(format!("HTTP request failed: {error}")))?;
        let status = response.status().as_u16();
        let headers = response
            .headers()
            .iter()
            .filter_map(|(name, value)| {
                value
                    .to_str()
                    .ok()
                    .map(|value| (name.as_str().to_ascii_lowercase(), value.to_string()))
            })
            .collect();
        let body = response
            .bytes()
            .map_err(|error| {
                PluginError::Host(format!("HTTP response could not be read: {error}"))
            })?
            .to_vec();
        Ok(HttpResponse {
            status,
            headers,
            body,
        })
    }
}

pub struct CapabilityBroker {
    network: Arc<dyn NetworkTransport>,
    credentials: Arc<dyn CredentialOperationBroker>,
    storage: Arc<dyn PluginStorage>,
    request_windows: Mutex<HashMap<String, VecDeque<Instant>>>,
}

impl CapabilityBroker {
    pub fn new(
        network: Arc<dyn NetworkTransport>,
        credentials: Arc<dyn CredentialOperationBroker>,
        storage: Arc<dyn PluginStorage>,
    ) -> Self {
        Self {
            network,
            credentials,
            storage,
            request_windows: Mutex::new(HashMap::new()),
        }
    }

    pub fn invoke(
        &self,
        context: &ExecutionContext,
        request: HostRequest,
    ) -> Result<HostResponse, PluginError> {
        context.ensure_active()?;
        match request {
            HostRequest::HttpRequest(request) => self.http(context, request),
            HostRequest::CredentialOperation {
                credential_reference,
                credential_type,
                action,
                input,
            } => {
                let capability = format!("credential_operations:{credential_type}");
                context.require(&capability)?;
                if !context
                    .approved_credential_operations
                    .get(&credential_type)
                    .is_some_and(|operations| operations.contains(&action))
                {
                    return Err(PluginError::Permission(format!(
                        "Credential operation '{credential_type}.{action}' is not declared."
                    )));
                }
                let credential_id = context
                    .approved_credential_references
                    .get(&credential_reference)
                    .ok_or_else(|| {
                        PluginError::Permission(format!(
                            "Credential reference '{credential_reference}' is not assigned."
                        ))
                    })?;
                let value =
                    self.credentials
                        .execute(credential_id, &credential_type, &action, &input)?;
                if contains_secret_material(&value) {
                    return Err(PluginError::Host(
                        "Credential broker returned secret-like material; response was blocked."
                            .into(),
                    ));
                }
                Ok(HostResponse { value, diagnostics: vec![format!("Credential operation {credential_type}.{action} completed through the host.")] })
            }
            HostRequest::Log {
                level,
                message,
                fields,
            } => {
                context.require("structured_logging")?;
                let safe = redact(fields);
                Ok(HostResponse {
                    value: json!({"accepted":true,"level":level,"message":bounded(&message, 8192),"fields":safe}),
                    diagnostics: vec![],
                })
            }
            HostRequest::StorageGet { key, temporary } => {
                let (scope, quota) = storage_scope(context, temporary)?;
                let value = self
                    .storage
                    .get(&scope, &key)?
                    .map(|bytes| BASE64.encode(bytes));
                Ok(HostResponse {
                    value: json!({"valueBase64":value,"usedBytes":self.storage.used_bytes(&scope)?,"quotaBytes":quota}),
                    diagnostics: vec![],
                })
            }
            HostRequest::StoragePut {
                key,
                value_base64,
                temporary,
            } => {
                let (scope, quota) = storage_scope(context, temporary)?;
                let value = BASE64.decode(value_base64).map_err(|_| {
                    PluginError::Storage("Storage value is not valid base64.".into())
                })?;
                self.storage.put(&scope, &key, &value, quota)?;
                Ok(HostResponse {
                    value: json!({"stored":true,"usedBytes":self.storage.used_bytes(&scope)?,"quotaBytes":quota}),
                    diagnostics: vec![],
                })
            }
            HostRequest::StorageDelete { key, temporary } => {
                let (scope, quota) = storage_scope(context, temporary)?;
                self.storage.delete(&scope, &key)?;
                Ok(HostResponse {
                    value: json!({"deleted":true,"usedBytes":self.storage.used_bytes(&scope)?,"quotaBytes":quota}),
                    diagnostics: vec![],
                })
            }
            HostRequest::Time => {
                context.require("time")?;
                let millis = SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .map_err(|error| PluginError::Host(error.to_string()))?
                    .as_millis();
                Ok(HostResponse {
                    value: json!({"unixTimeMs":millis}),
                    diagnostics: vec![],
                })
            }
            HostRequest::RandomIdentifier => {
                context.require("random_identifiers")?;
                Ok(HostResponse {
                    value: json!({"uuid":uuid::Uuid::new_v4().to_string()}),
                    diagnostics: vec![],
                })
            }
            HostRequest::CryptoSha256 { value_base64 } => {
                context.require("cryptography")?;
                let value = BASE64.decode(value_base64).map_err(|_| {
                    PluginError::Host("Cryptography input is not valid base64.".into())
                })?;
                Ok(HostResponse {
                    value: json!({"sha256":format!("{:x}", Sha256::digest(value))}),
                    diagnostics: vec![],
                })
            }
        }
    }

    fn http(
        &self,
        context: &ExecutionContext,
        mut request: HttpRequest,
    ) -> Result<HostResponse, PluginError> {
        context.require("network")?;
        if request
            .body_base64
            .as_ref()
            .is_some_and(|value| value.len() > MAX_REQUEST_BYTES * 2)
        {
            return Err(PluginError::Host("HTTP request body exceeds 1 MB.".into()));
        }
        request.timeout_ms = request.timeout_ms.clamp(100, 30_000);
        request.headers = sanitize_request_headers(request.headers)?;
        self.take_rate_limit(context)?;
        let mut diagnostics = Vec::new();
        for redirect in 0..=MAX_REDIRECTS {
            let rule = authorize_url(&request.url, &request.method, &context.network_domains)?;
            let response = self.network.send(&request)?;
            if response.body.len() > MAX_RESPONSE_BYTES {
                return Err(PluginError::Host("HTTP response exceeds 2 MB.".into()));
            }
            if matches!(response.status, 301 | 302 | 303 | 307 | 308) {
                if redirect == MAX_REDIRECTS {
                    return Err(PluginError::Host("HTTP redirect limit exceeded.".into()));
                }
                if !rule.allow_redirects {
                    return Err(PluginError::Permission(format!(
                        "Redirects from '{}' were not approved.",
                        rule.domain
                    )));
                }
                let location = response.headers.get("location").ok_or_else(|| {
                    PluginError::Host("Redirect response has no Location header.".into())
                })?;
                let target = Url::parse(&request.url)
                    .and_then(|base| base.join(location))
                    .map_err(|_| PluginError::Host("Redirect target is invalid.".into()))?;
                authorize_url(target.as_str(), &request.method, &context.network_domains)?;
                diagnostics.push(format!("Approved redirect {} -> {}", request.url, target));
                request.url = target.into();
                continue;
            }
            let headers = response
                .headers
                .into_iter()
                .filter(|(name, _)| !sensitive_header(name))
                .collect::<BTreeMap<_, _>>();
            return Ok(HostResponse {
                value: json!({"status":response.status,"headers":headers,"bodyBase64":BASE64.encode(response.body)}),
                diagnostics,
            });
        }
        unreachable!()
    }

    fn take_rate_limit(&self, context: &ExecutionContext) -> Result<(), PluginError> {
        let mut windows = self.request_windows.lock();
        let values = windows.entry(context.plugin_id.clone()).or_default();
        let cutoff = Instant::now() - Duration::from_secs(60);
        while values.front().is_some_and(|value| *value < cutoff) {
            values.pop_front();
        }
        if values.len() >= MAX_REQUESTS_PER_MINUTE {
            return Err(PluginError::Host(
                "Plugin HTTP rate limit exceeded (120 requests/minute).".into(),
            ));
        }
        values.push_back(Instant::now());
        Ok(())
    }
}

fn authorize_url<'a>(
    url: &str,
    method: &HttpMethod,
    rules: &'a [NetworkDomain],
) -> Result<&'a NetworkDomain, PluginError> {
    let parsed =
        Url::parse(url).map_err(|_| PluginError::Permission("HTTP URL is invalid.".into()))?;
    if parsed.scheme() != "https" || parsed.username() != "" || parsed.password().is_some() {
        return Err(PluginError::Permission(
            "Plugins may only request HTTPS URLs without embedded credentials.".into(),
        ));
    }
    let host = parsed
        .host_str()
        .ok_or_else(|| PluginError::Permission("HTTP URL has no domain.".into()))?
        .to_ascii_lowercase();
    rules
        .iter()
        .find(|rule| {
            (host == rule.domain
                || (rule.allow_subdomains && host.ends_with(&format!(".{}", rule.domain))))
                && rule.methods.contains(method)
        })
        .ok_or_else(|| {
            PluginError::Permission(format!(
                "{} {} is outside the approved network allowlist.",
                method.as_str(),
                host
            ))
        })
}

fn sanitize_request_headers(
    headers: BTreeMap<String, String>,
) -> Result<BTreeMap<String, String>, PluginError> {
    let mut safe = BTreeMap::new();
    for (name, value) in headers {
        let normalized = name.to_ascii_lowercase();
        if sensitive_header(&normalized) || normalized == "host" || normalized == "content-length" {
            return Err(PluginError::Permission(format!(
                "Plugin-supplied header '{name}' is not allowed; use a credential operation."
            )));
        }
        if name.contains(['\r', '\n'])
            || value.contains(['\r', '\n'])
            || name.len() > 128
            || value.len() > 8192
        {
            return Err(PluginError::Host(
                "HTTP header is invalid or too large.".into(),
            ));
        }
        safe.insert(normalized, value);
    }
    Ok(safe)
}

fn sensitive_header(name: &str) -> bool {
    matches!(
        name.to_ascii_lowercase().as_str(),
        "authorization" | "proxy-authorization" | "cookie" | "set-cookie" | "x-api-key"
    )
}

fn storage_scope(
    context: &ExecutionContext,
    temporary: bool,
) -> Result<(StorageScope, u64), PluginError> {
    let (capability, quota) = if temporary {
        ("temporary_storage", context.temporary_quota_bytes)
    } else {
        ("persistent_storage", context.persistent_quota_bytes)
    };
    context.require(capability)?;
    Ok((
        StorageScope {
            plugin_id: context.plugin_id.clone(),
            publisher_id: context.publisher_id.clone(),
            owner_id: context.owner_id.clone(),
            workspace_id: context.workspace_id.clone(),
            major_version: (!temporary).then_some(context.plugin_major_version),
            temporary_execution_id: temporary.then(|| context.execution_id.clone()),
        },
        quota,
    ))
}

fn validate_storage_key(key: &str) -> Result<(), PluginError> {
    if key.is_empty() || key.len() > 256 || key.contains("..") || key.contains(['/', '\\', '\0']) {
        Err(PluginError::Storage("Storage key is invalid.".into()))
    } else {
        Ok(())
    }
}

fn bounded(value: &str, max: usize) -> String {
    value.chars().take(max).collect()
}

fn contains_secret_material(value: &Value) -> bool {
    match value {
        Value::Object(values) => values.iter().any(|(key, value)| {
            [
                "token",
                "secret",
                "password",
                "authorization",
                "cookie",
                "credential",
            ]
            .iter()
            .any(|part| key.to_ascii_lowercase().contains(part))
                || contains_secret_material(value)
        }),
        Value::Array(values) => values.iter().any(contains_secret_material),
        _ => false,
    }
}

fn redact(value: Value) -> Value {
    match value {
        Value::Object(values) => Value::Object(
            values
                .into_iter()
                .map(|(key, value)| {
                    let sensitive = [
                        "token",
                        "secret",
                        "password",
                        "authorization",
                        "cookie",
                        "credential",
                    ]
                    .iter()
                    .any(|part| key.to_ascii_lowercase().contains(part));
                    (
                        key,
                        if sensitive {
                            Value::String("[REDACTED]".into())
                        } else {
                            redact(value)
                        },
                    )
                })
                .collect(),
        ),
        Value::Array(values) => Value::Array(values.into_iter().map(redact).collect()),
        other => other,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::manifest::tests::manifest;

    #[derive(Default)]
    struct MockNetwork {
        responses: Mutex<VecDeque<HttpResponse>>,
        requests: Mutex<Vec<HttpRequest>>,
    }
    impl NetworkTransport for MockNetwork {
        fn send(&self, request: &HttpRequest) -> Result<HttpResponse, PluginError> {
            self.requests.lock().push(request.clone());
            self.responses
                .lock()
                .pop_front()
                .ok_or_else(|| PluginError::Host("No mock response.".into()))
        }
    }
    struct MockCredentials;
    impl CredentialOperationBroker for MockCredentials {
        fn execute(
            &self,
            _id: &str,
            _kind: &str,
            operation: &str,
            _input: &Value,
        ) -> Result<Value, PluginError> {
            Ok(json!({"operation":operation,"accepted":true}))
        }
    }

    fn broker(network: Arc<MockNetwork>) -> CapabilityBroker {
        CapabilityBroker::new(
            network,
            Arc::new(MockCredentials),
            Arc::new(InMemoryPluginStorage::default()),
        )
    }

    #[test]
    fn enforces_http_domain_method_headers_and_redirect_target() {
        let network = Arc::new(MockNetwork::default());
        network.responses.lock().push_back(HttpResponse {
            status: 302,
            headers: BTreeMap::from([("location".into(), "https://evil.example/steal".into())]),
            body: vec![],
        });
        let mut context = ExecutionContext::from_manifest(&manifest(), "run", "node");
        context.network_domains[0].allow_redirects = true;
        let error = broker(network)
            .invoke(
                &context,
                HostRequest::HttpRequest(HttpRequest {
                    url: "https://api.example.com/weather".into(),
                    method: HttpMethod::Get,
                    headers: BTreeMap::new(),
                    body_base64: None,
                    timeout_ms: 5_000,
                }),
            )
            .unwrap_err();
        assert!(error
            .to_string()
            .contains("outside the approved network allowlist"));

        let network = Arc::new(MockNetwork::default());
        let error = broker(network)
            .invoke(
                &context,
                HostRequest::HttpRequest(HttpRequest {
                    url: "https://api.example.com/weather".into(),
                    method: HttpMethod::Post,
                    headers: BTreeMap::new(),
                    body_base64: None,
                    timeout_ms: 5_000,
                }),
            )
            .unwrap_err();
        assert!(error
            .to_string()
            .contains("outside the approved network allowlist"));
    }

    #[test]
    fn storage_is_isolated_and_quota_limited() {
        let storage = Arc::new(InMemoryPluginStorage::default());
        let network = Arc::new(MockNetwork::default());
        let broker = CapabilityBroker::new(network, Arc::new(MockCredentials), storage.clone());
        let mut one = ExecutionContext::from_manifest(&manifest(), "run", "node");
        one.approved_capabilities
            .insert("persistent_storage".into());
        one.persistent_quota_bytes = 4;
        broker
            .invoke(
                &one,
                HostRequest::StoragePut {
                    key: "state".into(),
                    value_base64: BASE64.encode(b"four"),
                    temporary: false,
                },
            )
            .unwrap();
        assert!(broker
            .invoke(
                &one,
                HostRequest::StoragePut {
                    key: "state2".into(),
                    value_base64: BASE64.encode(b"x"),
                    temporary: false
                }
            )
            .is_err());
        let mut two = one.clone();
        two.plugin_id = "com.sandbox.other".into();
        let response = broker
            .invoke(
                &two,
                HostRequest::StorageGet {
                    key: "state".into(),
                    temporary: false,
                },
            )
            .unwrap();
        assert!(response.value["valueBase64"].is_null());
    }

    #[test]
    fn credential_broker_never_returns_secret_material() {
        let network = Arc::new(MockNetwork::default());
        let broker = broker(network);
        let mut context = ExecutionContext::from_manifest(&manifest(), "run", "node");
        context
            .approved_capabilities
            .insert("credential_operations:gmail".into());
        context
            .approved_credential_references
            .insert("company-gmail".into(), "vault-id".into());
        let response = broker
            .invoke(
                &context,
                HostRequest::CredentialOperation {
                    credential_reference: "company-gmail".into(),
                    credential_type: "gmail".into(),
                    action: "gmail.messages.list".into(),
                    input: json!({}),
                },
            )
            .unwrap();
        assert_eq!(response.value["accepted"], true);
        assert!(!serde_json::to_string(&response)
            .unwrap()
            .contains("vault-id"));
    }
}
