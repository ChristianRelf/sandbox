use sandbox_hosted_runner::{HostedRunner, WorkloadRequest};
use std::io::Read;
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
    match HostedRunner::default()
        .execute(request, CancellationToken::new())
        .await
    {
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
