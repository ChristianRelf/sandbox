use crate::{
    account_auth,
    plugin_manager::{PackageTrustMetadata, PluginManager, PluginPackageInspection},
};
use reqwest::{redirect::Policy, Client, Url};
use serde::{Deserialize, Serialize};
use std::time::Duration;

const MAX_PACKAGE_BYTES: u64 = 32 * 1024 * 1024;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MarketplaceSearch {
    pub search: Option<String>,
    pub category: Option<String>,
    pub pricing: Option<String>,
    pub verified_only: Option<bool>,
    pub sort: Option<String>,
    pub cursor: Option<String>,
    pub limit: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MarketplacePublisher {
    pub public_id: String,
    pub public_name: String,
    pub verified: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MarketplaceListing {
    pub plugin_id: String,
    pub name: String,
    pub summary: String,
    pub publisher: MarketplacePublisher,
    pub version: String,
    pub package_integrity: String,
    pub categories: Vec<String>,
    pub pricing: serde_json::Value,
    pub capabilities: Vec<serde_json::Value>,
    pub network_domains: Vec<serde_json::Value>,
    pub nodes: Vec<serde_json::Value>,
    pub minimum_host_version: String,
    pub maximum_host_version: Option<String>,
    pub install_count: u64,
    pub rating_average: Option<f64>,
    pub rating_count: u64,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MarketplacePage {
    pub items: Vec<MarketplaceListing>,
    pub next_cursor: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct InstallGrant {
    plugin_id: String,
    version: String,
    package_integrity: String,
    package_size: u64,
    publisher: InstallPublisher,
    download: DownloadGrant,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct InstallPublisher {
    public_id: String,
    key_id: String,
    public_key_pem: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DownloadGrant {
    download_url: String,
    expires_at: String,
}

pub async fn search(query: MarketplaceSearch) -> Result<MarketplacePage, String> {
    let mut url = endpoint("/v1/marketplace/plugins")?;
    {
        let mut pairs = url.query_pairs_mut();
        pairs.append_pair("hostVersion", sandbox_plugin_runtime::HOST_VERSION);
        pairs.append_pair("limit", &query.limit.unwrap_or(24).clamp(1, 50).to_string());
        if let Some(value) = query.search.filter(|value| !value.trim().is_empty()) {
            pairs.append_pair("search", value.trim());
        }
        if let Some(value) = query.category {
            pairs.append_pair("category", &value);
        }
        if let Some(value) = query.pricing {
            pairs.append_pair("pricing", &value);
        }
        if let Some(value) = query.verified_only {
            pairs.append_pair("verifiedOnly", &value.to_string());
        }
        if let Some(value) = query.sort {
            pairs.append_pair("sort", &value);
        }
        if let Some(value) = query.cursor {
            pairs.append_pair("cursor", &value);
        }
    }
    let response = client()?.get(url).send().await.map_err(network)?;
    if !response.status().is_success() {
        return Err(format!(
            "Marketplace request failed with HTTP {}.",
            response.status()
        ));
    }
    response
        .json::<MarketplacePage>()
        .await
        .map_err(|_| "Marketplace returned an invalid response.".into())
}

pub async fn inspect_for_install(
    plugin_id: &str,
    manager: &PluginManager,
) -> Result<PluginPackageInspection, String> {
    if plugin_id.len() > 200
        || !plugin_id.chars().all(|character| {
            character.is_ascii_lowercase()
                || character.is_ascii_digit()
                || matches!(character, '.' | '-')
        })
    {
        return Err("Marketplace plugin ID is invalid.".into());
    }
    let grant_url = endpoint(&format!(
        "/v1/marketplace/plugins/{}/install",
        urlencoding::encode(plugin_id)
    ))?;
    let response = client()?.get(grant_url).send().await.map_err(network)?;
    if !response.status().is_success() {
        let status = response.status();
        let body: serde_json::Value = response.json().await.unwrap_or_default();
        return Err(body
            .pointer("/error/message")
            .and_then(serde_json::Value::as_str)
            .map(str::to_string)
            .unwrap_or_else(|| format!("Plugin download grant failed with HTTP {status}.")));
    }
    let grant: InstallGrant = response
        .json()
        .await
        .map_err(|_| "Plugin download grant was invalid.".to_string())?;
    if grant.plugin_id != plugin_id
        || grant.package_size == 0
        || grant.package_size > MAX_PACKAGE_BYTES
        || !grant.package_integrity.starts_with("sha256:")
    {
        return Err("Plugin download grant did not match the requested immutable package.".into());
    }
    let expires_at = chrono::DateTime::parse_from_rfc3339(&grant.download.expires_at)
        .map_err(|_| "Plugin download grant expiry was invalid.".to_string())?
        .with_timezone(&chrono::Utc);
    if expires_at <= chrono::Utc::now() {
        return Err("Plugin download grant expired before use.".into());
    }
    let download_url = Url::parse(&grant.download.download_url)
        .map_err(|_| "Plugin download URL was invalid.".to_string())?;
    if download_url.scheme() != "https" || download_url.host_str().is_none() {
        return Err("Plugin downloads require a signed HTTPS URL.".into());
    }
    let package_response = client()?.get(download_url).send().await.map_err(network)?;
    if !package_response.status().is_success() {
        return Err(format!(
            "Plugin package download failed with HTTP {}.",
            package_response.status()
        ));
    }
    if package_response
        .content_length()
        .is_some_and(|length| length != grant.package_size || length > MAX_PACKAGE_BYTES)
    {
        return Err("Plugin package size did not match the immutable grant.".into());
    }
    let bytes = package_response.bytes().await.map_err(network)?.to_vec();
    if bytes.len() as u64 != grant.package_size || bytes.len() as u64 > MAX_PACKAGE_BYTES {
        return Err("Downloaded plugin package size did not match the immutable grant.".into());
    }
    let inspection = manager
        .inspect_bytes(
            bytes,
            PackageTrustMetadata {
                publisher_id: grant.publisher.public_id,
                key_id: grant.publisher.key_id,
                publisher_public_key_pem: grant.publisher.public_key_pem,
                owner_type: "personal".into(),
                owner_id: "local".into(),
                source: "marketplace".into(),
            },
        )
        .map_err(|error| error.to_string())?;
    if inspection.manifest.version.to_string() != grant.version
        || inspection.manifest.package_integrity != grant.package_integrity
    {
        return Err("Verified package identity did not match the download grant.".into());
    }
    Ok(inspection)
}

fn endpoint(path: &str) -> Result<Url, String> {
    Url::parse(&format!(
        "{}{}",
        account_auth::control_plane_url()?.trim_end_matches('/'),
        path
    ))
    .map_err(|_| "Control-plane URL is invalid.".into())
}

fn client() -> Result<Client, String> {
    Client::builder()
        .timeout(Duration::from_secs(30))
        .redirect(Policy::none())
        .user_agent(format!("Sandbox/{}", sandbox_plugin_runtime::HOST_VERSION))
        .build()
        .map_err(|error| error.to_string())
}

fn network(error: impl std::fmt::Display) -> String {
    format!("Marketplace network request failed: {error}")
}
