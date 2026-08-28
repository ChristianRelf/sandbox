use chrono::Utc;
use sandbox_hosted_runner::{
    usage::{HttpUsageReporter, UsageContext},
    HostedRunner, WorkloadRequest,
};
use std::io::Read;
use std::time::Instant;
use tokio_util::sync::CancellationToken;

#[tokio::main]
async fn main() {
    let mut input = String::new();
    if let Err(error) = std::io::stdin().read_to_string(&mut input) {
        eprintln!("failed to read workload: {error}");
        std::process::exit(2);
    }
    let request: WorkloadRequest = match serde_json::from_str(&input) {
        Ok(request) => request,
        Err(error) => {
            eprintln!("invalid workload: {error}");
            std::process::exit(2)
        }
    };
    let reporter = match HttpUsageReporter::from_environment() {
        Ok(value) => value,
        Err(error) => {
            eprintln!("{error}");
            std::process::exit(2)
        }
    };
    let usage = UsageContext {
        workspace_id: request.policy.workspace_id.clone(),
        environment_id: request.policy.environment_id.clone(),
        execution_id: request.policy.execution_id.clone(),
        deployment_id: request.policy.deployment_id.clone(),
        region: request.policy.region.clone(),
    };
    let usage_started_at = Utc::now();
    let usage_started = Instant::now();
    let outcome = HostedRunner::default()
        .execute(request, CancellationToken::new())
        .await;
    let usage_ended_at = Utc::now();
    let quantity = (usage_started.elapsed().as_secs_f64().ceil() as u64).max(1);
    if let Err(error) = reporter
        .record_hosted_seconds(&usage, usage_started_at, usage_ended_at, quantity)
        .await
    {
        eprintln!("hosted usage reporting failed: {error}");
        std::process::exit(1)
    }
    match outcome {
        Ok(record) => println!(
            "{}",
            serde_json::to_string(&record).expect("serializable execution")
        ),
        Err(error) => {
            eprintln!("hosted execution failed: {error}");
            std::process::exit(1)
        }
    }
}
