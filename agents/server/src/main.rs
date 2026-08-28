use clap::{Parser, Subcommand};
use reqwest::{Certificate, Client, Identity, Proxy};
use sandbox_server_runner::{
    client::{DeviceClient, RunnerStatus},
    config::RunnerConfig,
    identity::StoredIdentity,
    pairing::pair,
    runner::{open_engine, process_command, CommandVerifier},
};
use std::{
    path::PathBuf,
    sync::{
        atomic::{AtomicU16, Ordering},
        Arc,
    },
    time::Duration,
};
use tokio::{sync::Semaphore, task::JoinSet};

#[derive(Parser)]
#[command(name = "sandbox-runner", version)]
struct Cli {
    #[arg(long, default_value = "/etc/sandbox-runner/config.toml")]
    config: PathBuf,
    #[command(subcommand)]
    command: Command,
}
#[derive(Subcommand)]
enum Command {
    Pair {
        #[arg(long, env = "SANDBOX_PAIRING_TOKEN", hide_env_values = true)]
        token: String,
    },
    Validate,
    Run,
}

#[tokio::main]
async fn main() {
    if let Err(error) = run().await {
        eprintln!("{error}");
        std::process::exit(1)
    }
}

async fn run() -> Result<(), String> {
    let cli = Cli::parse();
    let config = RunnerConfig::load(&cli.config).map_err(|error| error.to_string())?;
    match cli.command {
        Command::Validate => {
            build_http_client(&config)?;
            CommandVerifier::from_config(&config)?;
            println!("configuration valid");
        }
        Command::Pair { token } => {
            std::fs::create_dir_all(&config.data_directory).map_err(|error| error.to_string())?;
            let identity_path = config.data_directory.join("identity.json");
            if identity_path.exists() {
                return Err(
                    "Runner is already paired; revoke it before replacing its identity.".into(),
                );
            }
            let client = build_http_client(&config)?;
            let (identity, fingerprint) = pair(&config, &token, &client).await?;
            identity.save(&identity_path)?;
            println!("Pairing request accepted. Confirm fingerprint: {fingerprint}");
        }
        Command::Run => run_service(&config).await?,
    }
    Ok(())
}

async fn run_service(config: &RunnerConfig) -> Result<(), String> {
    let identity = StoredIdentity::load(&config.data_directory.join("identity.json"))
        .map_err(|error| format!("Runner is not paired or its identity is invalid: {error}"))?;
    let runner_id = identity.runner_id.clone();
    let device = Arc::new(
        DeviceClient::new(
            &config.control_plane_url,
            build_http_client(config)?,
            identity,
        )
        .map_err(|error| error.to_string())?,
    );
    let engine = Arc::new(open_engine(config)?);
    let verifier = Arc::new(CommandVerifier::from_config(config)?);
    let active = Arc::new(AtomicU16::new(0));
    let permits = Arc::new(Semaphore::new(config.concurrency as usize));
    let mut tasks = JoinSet::new();
    println!(
        "runner starting in {} with concurrency {}",
        config.environment, config.concurrency
    );
    let mut heartbeat = tokio::time::interval(Duration::from_secs(30));
    heartbeat.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    let mut poll = tokio::time::interval(Duration::from_secs(2));
    poll.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    loop {
        tokio::select! {
            signal = shutdown_signal() => {
                signal?;
                if let Err(error) = device.heartbeat(active.load(Ordering::Relaxed), RunnerStatus::Draining).await { eprintln!("failed to report draining state: {error}"); }
                break;
            },
            _ = heartbeat.tick() => if let Err(error) = device.heartbeat(active.load(Ordering::Relaxed), RunnerStatus::Online).await { eprintln!("heartbeat failed: {error}"); },
            _ = poll.tick() => {
                let available = config.concurrency.saturating_sub(active.load(Ordering::Relaxed));
                if available == 0 { continue; }
                match device.commands(available.min(50)).await {
                    Ok(commands) => for command in commands {
                        let Ok(permit) = permits.clone().try_acquire_owned() else { break };
                        let device = device.clone(); let engine = engine.clone(); let verifier = verifier.clone();
                        let runner_id = runner_id.clone(); let workspace_id = config.workspace_id.clone(); let active = active.clone();
                        active.fetch_add(1, Ordering::Relaxed);
                        tasks.spawn(async move {
                            let _permit = permit;
                            process_command(&device, &engine, &verifier, &runner_id, &workspace_id, command).await;
                            active.fetch_sub(1, Ordering::Relaxed);
                        });
                    },
                    Err(error) => eprintln!("command poll failed: {error}"),
                }
            },
            Some(result) = tasks.join_next(), if !tasks.is_empty() => if let Err(error) = result { eprintln!("command task failed: {error}"); },
        }
    }
    let drain = async { while tasks.join_next().await.is_some() {} };
    if tokio::time::timeout(
        Duration::from_secs(config.drain_timeout_seconds.into()),
        drain,
    )
    .await
    .is_err()
    {
        tasks.abort_all();
        return Err("drain timeout expired before active commands completed".into());
    }
    Ok(())
}

#[cfg(unix)]
async fn shutdown_signal() -> Result<(), String> {
    use tokio::signal::unix::{signal, SignalKind};
    let mut terminate = signal(SignalKind::terminate()).map_err(|error| error.to_string())?;
    tokio::select! { result = tokio::signal::ctrl_c() => result.map_err(|error| error.to_string()), _ = terminate.recv() => Ok(()) }
}
#[cfg(not(unix))]
async fn shutdown_signal() -> Result<(), String> {
    tokio::signal::ctrl_c()
        .await
        .map_err(|error| error.to_string())
}

fn build_http_client(config: &RunnerConfig) -> Result<Client, String> {
    let mut builder = Client::builder().timeout(Duration::from_secs(30));
    if let Some(proxy) = &config.proxy {
        builder = builder.proxy(Proxy::all(proxy).map_err(|error| error.to_string())?);
    }
    if let Some(ca_file) = &config.certificate.ca_file {
        let pem =
            std::fs::read(ca_file).map_err(|error| format!("could not read CA file: {error}"))?;
        builder = builder
            .add_root_certificate(Certificate::from_pem(&pem).map_err(|error| error.to_string())?);
    }
    match (
        &config.certificate.client_certificate_file,
        &config.certificate.client_key_file,
    ) {
        (Some(certificate_file), Some(key_file)) => {
            let mut pem = std::fs::read(certificate_file)
                .map_err(|error| format!("could not read client certificate: {error}"))?;
            pem.push(b'\n');
            pem.extend(
                std::fs::read(key_file)
                    .map_err(|error| format!("could not read client key: {error}"))?,
            );
            builder =
                builder.identity(Identity::from_pem(&pem).map_err(|error| error.to_string())?);
        }
        (None, None) => {}
        _ => return Err("client certificate and key files must be configured together".into()),
    }
    builder.build().map_err(|error| error.to_string())
}
