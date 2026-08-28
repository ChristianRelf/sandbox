use base64::{engine::general_purpose::STANDARD, Engine as _};
use chrono::{DateTime, Utc};
use hmac::{Hmac, Mac};
use serde::Serialize;
use sha2::Sha256;
use std::time::Duration;
use uuid::Uuid;

#[derive(Debug, thiserror::Error)]
pub enum UsageReporterError {
    #[error("usage reporter configuration is invalid: {0}")]
    Configuration(String),
    #[error("usage ingestion request failed: {0}")]
    Request(String),
}

#[derive(Debug, Clone)]
pub struct UsageContext {
    pub workspace_id: String,
    pub environment_id: String,
    pub execution_id: String,
    pub deployment_id: String,
    pub region: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct UsageEvent<'a> {
    event_id: Uuid,
    workspace_id: &'a str,
    environment_id: &'a str,
    execution_id: &'a str,
    deployment_id: &'a str,
    meter: &'static str,
    quantity: u64,
    unit: &'static str,
    source_event_id: String,
    idempotency_key: String,
    period_started_at: DateTime<Utc>,
    period_ended_at: DateTime<Utc>,
    region: &'a str,
    metadata: serde_json::Value,
}

pub struct HttpUsageReporter {
    endpoint: String,
    producer_id: String,
    secret: Vec<u8>,
    client: reqwest::Client,
}

impl HttpUsageReporter {
    pub fn from_environment() -> Result<Self, UsageReporterError> {
        let required = |name: &str| {
            std::env::var(name)
                .map_err(|_| UsageReporterError::Configuration(format!("{name} is required")))
        };
        let endpoint = required("SANDBOX_CONTROL_PLANE_URL")?;
        let producer_id = required("SANDBOX_USAGE_PRODUCER_ID")?;
        let secret = STANDARD
            .decode(required("SANDBOX_USAGE_PRODUCER_SECRET_BASE64")?)
            .map_err(|_| {
                UsageReporterError::Configuration("producer secret is not valid base64".into())
            })?;
        if secret.len() < 32 {
            return Err(UsageReporterError::Configuration(
                "producer secret requires at least 32 bytes".into(),
            ));
        }
        Ok(Self {
            endpoint: endpoint.trim_end_matches('/').to_owned(),
            producer_id,
            secret,
            client: reqwest::Client::builder()
                .timeout(Duration::from_secs(10))
                .build()
                .map_err(|error| UsageReporterError::Configuration(error.to_string()))?,
        })
    }

    pub async fn record_hosted_seconds(
        &self,
        context: &UsageContext,
        started_at: DateTime<Utc>,
        ended_at: DateTime<Utc>,
        quantity: u64,
    ) -> Result<(), UsageReporterError> {
        let event = UsageEvent {
            event_id: Uuid::new_v4(),
            workspace_id: &context.workspace_id,
            environment_id: &context.environment_id,
            execution_id: &context.execution_id,
            deployment_id: &context.deployment_id,
            meter: "hosted_runner_seconds",
            quantity,
            unit: "seconds",
            source_event_id: format!("hosted-runner-stop:{}", context.execution_id),
            idempotency_key: format!("hosted-runner-usage:{}", context.execution_id),
            period_started_at: started_at,
            period_ended_at: ended_at,
            region: &context.region,
            metadata: serde_json::json!({"producer":self.producer_id}),
        };
        let body = serde_json::to_string(&event)
            .map_err(|error| UsageReporterError::Request(error.to_string()))?;
        let timestamp = Utc::now().timestamp().to_string();
        let mut signer = Hmac::<Sha256>::new_from_slice(&self.secret)
            .map_err(|_| UsageReporterError::Configuration("producer secret is invalid".into()))?;
        signer.update(format!("{timestamp}.{body}").as_bytes());
        let signature = hex::encode(signer.finalize().into_bytes());
        let mut failure = "usage ingestion did not complete".to_owned();
        for attempt in 0..3 {
            match self
                .client
                .post(format!("{}/v1/internal/usage-events", self.endpoint))
                .header("content-type", "application/json")
                .header("x-sandbox-usage-producer", &self.producer_id)
                .header("x-sandbox-usage-timestamp", &timestamp)
                .header("x-sandbox-usage-signature", &signature)
                .body(body.clone())
                .send()
                .await
            {
                Ok(response) if response.status().is_success() => return Ok(()),
                Ok(response) => {
                    let status = response.status();
                    failure = format!("control plane returned HTTP {status}");
                    if status.is_client_error() && status.as_u16() != 429 {
                        return Err(UsageReporterError::Request(failure));
                    }
                }
                Err(error) => failure = error.to_string(),
            }
            if attempt < 2 {
                tokio::time::sleep(Duration::from_millis(100 * 2u64.pow(attempt))).await;
            }
        }
        Err(UsageReporterError::Request(failure))
    }
}
