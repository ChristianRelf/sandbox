use sandbox_plugin_runtime::{
    CapabilityBroker, CredentialOperationBroker, ExecutionContext, HttpRequest, HttpResponse,
    InMemoryPluginStorage, Manifest, NetworkTransport, PluginError, PluginRuntime, RuntimeLimits,
};
use serde_json::{json, Value};
use std::{collections::BTreeMap, sync::Arc, time::Duration};

struct WeatherNetwork;
impl NetworkTransport for WeatherNetwork {
    fn send(&self, request: &HttpRequest) -> Result<HttpResponse, PluginError> {
        assert!(request
            .url
            .starts_with("https://api.open-meteo.com/v1/forecast?"));
        Ok(HttpResponse {
            status: 200,
            headers: BTreeMap::from([("content-type".into(), "application/json".into())]),
            body: serde_json::to_vec(
                &json!({"current_weather":{"temperature":14.5,"windspeed":8.2,"weathercode":2}}),
            )
            .unwrap(),
        })
    }
}

struct NoCredentials;
impl CredentialOperationBroker for NoCredentials {
    fn execute(&self, _: &str, _: &str, _: &str, _: &Value) -> Result<Value, PluginError> {
        panic!("weather example must not request credentials")
    }
}

struct NoNetwork;
impl NetworkTransport for NoNetwork {
    fn send(&self, _: &HttpRequest) -> Result<HttpResponse, PluginError> {
        panic!("approval example must not receive raw network access")
    }
}

struct ApprovalCredentials;
impl CredentialOperationBroker for ApprovalCredentials {
    fn execute(
        &self,
        credential_id: &str,
        credential_type: &str,
        operation: &str,
        input: &Value,
    ) -> Result<Value, PluginError> {
        assert_eq!(credential_id, "vault-internal-1");
        assert_eq!(credential_type, "internal_approval");
        assert_eq!(operation, "approval.requests.create");
        assert_eq!(input["idempotencyKey"], "run-123-node-approval");
        Ok(json!({"requestId":"approval-42","status":"pending"}))
    }
}

fn runtime() -> PluginRuntime {
    PluginRuntime::new(RuntimeLimits {
        memory_bytes: 16 * 1024 * 1024,
        fuel: 10_000_000,
        timeout: Duration::from_secs(2),
    })
    .unwrap()
}

#[test]
fn weather_example_runs_through_production_sandbox_and_http_broker() {
    let manifest: Manifest = serde_json::from_str(include_str!(
        "../../../examples/plugins/weather-data/manifest.json"
    ))
    .unwrap();
    assert!(
        manifest
            .validate(&semver::Version::new(0, 3, 0), false)
            .valid
    );
    let context = ExecutionContext::from_manifest(&manifest, "run-weather", "weather");
    let broker = Arc::new(CapabilityBroker::new(
        Arc::new(WeatherNetwork),
        Arc::new(NoCredentials),
        Arc::new(InMemoryPluginStorage::default()),
    ));
    let (result, _) = runtime()
        .execute(
            include_bytes!("../../../examples/plugins/weather-data/components/main.wasm"),
            "execute",
            &json!({"configuration":{"latitude":51.5,"longitude":-0.12,"units":"celsius"}}),
            broker,
            context,
        )
        .unwrap();
    assert_eq!(result["ok"], true);
    assert_eq!(result["output"]["temperature"], 14.5);
}

#[test]
fn approval_example_uses_credential_reference_idempotency_and_migration_in_same_sandbox() {
    let manifest: Manifest = serde_json::from_str(include_str!(
        "../../../examples/plugins/internal-approval/manifest.json"
    ))
    .unwrap();
    assert!(
        manifest
            .validate(&semver::Version::new(0, 3, 0), false)
            .valid
    );
    let mut context = ExecutionContext::from_manifest(&manifest, "run-approval", "approval");
    context
        .approved_credential_references
        .insert("internal-approval".into(), "vault-internal-1".into());
    let broker = Arc::new(CapabilityBroker::new(
        Arc::new(NoNetwork),
        Arc::new(ApprovalCredentials),
        Arc::new(InMemoryPluginStorage::default()),
    ));
    let wasm = include_bytes!("../../../examples/plugins/internal-approval/components/main.wasm");
    let (result, _) = runtime()
        .execute(
            wasm,
            "execute",
            &json!({"configuration":{"subject":"Deploy","details":"Deploy release","credentialReference":"internal-approval"},"idempotencyKey":"run-123-node-approval"}),
            broker.clone(),
            context.clone(),
        )
        .unwrap();
    assert_eq!(result["output"]["requestId"], "approval-42");
    let (migration, _) = runtime()
        .execute(
            wasm,
            "migrate_v1_to_v2",
            &json!({"configuration":{"message":"Deploy release"}}),
            broker,
            context,
        )
        .unwrap();
    assert_eq!(migration["nodeVersion"], 2);
    assert_eq!(migration["configuration"]["subject"], "Deploy release");
}
