#[macro_use]
mod cli;

use clap::{error::ErrorKind, CommandFactory, Parser, Subcommand};
use cli::{CliError, DEFAULT_CONFIG, DOCS_URL};
use reqwest::{Certificate, Client, Identity, Proxy};
use sandbox_server_runner::{
    client::{DeviceClient, RunnerStatus},
    config::RunnerConfig,
    credential_vault::{CredentialVault, OsCredentialVault},
    identity::StoredIdentity,
    pairing::pair,
    runner::{
        open_engine, poll_synced_triggers, process_command, CommandVerifier, RunnerActivation,
    },
};
use serde_json::{json, Value};
use std::{
    io::{IsTerminal, Read},
    path::PathBuf,
    sync::{
        atomic::{AtomicU16, Ordering},
        Arc,
    },
    time::Duration,
};
use tokio::{sync::Semaphore, task::JoinSet};

#[cfg(target_os = "windows")]
const AFTER_HELP: &str = "Run without a subcommand to open the guided terminal home.\nDocs: https://docs.sndbox.app/windows";
#[cfg(not(target_os = "windows"))]
const AFTER_HELP: &str = "Run without a subcommand to open the guided terminal home.\nDocs: https://docs.sndbox.app/linux";

#[derive(Parser)]
#[command(
    name = "sandbox-runner",
    bin_name = "sandbox-runner",
    version,
    about = "Run sndbox workflows safely on Linux or Windows",
    after_help = AFTER_HELP
)]
struct Cli {
    #[arg(long, default_value = DEFAULT_CONFIG)]
    config: PathBuf,
    #[command(subcommand)]
    command: Option<Command>,
}
#[derive(Subcommand)]
enum Command {
    /// Create a validated configuration with guided prompts.
    Setup {
        /// Preserve a .bak copy and replace an existing unpaired configuration.
        #[arg(long)]
        force: bool,
    },
    /// Check the platform, configuration, pairing, paths and service state.
    Doctor {
        /// Print stable machine-readable JSON.
        #[arg(long)]
        json: bool,
    },
    /// Show configuration, pairing and service state.
    Status {
        /// Print stable machine-readable JSON.
        #[arg(long)]
        json: bool,
    },
    /// Pair this machine using a one-time token (prompted securely when omitted).
    Pair {
        #[arg(long, env = "SANDBOX_PAIRING_TOKEN", hide_env_values = true)]
        token: Option<String>,
    },
    /// Validate configuration, TLS settings and command-signing keys.
    Validate,
    /// Run the foreground service loop (normally started by the OS service manager).
    Run,
    /// Store a local connection from a JSON object read on standard input.
    AuthorizeConnection {
        #[arg(long)]
        id: String,
        #[arg(long)]
        provider: String,
        #[arg(long)]
        display_name: String,
        #[arg(long)]
        account_identifier: Option<String>,
        #[arg(long = "scope")]
        scopes: Vec<String>,
    },
    /// Authorize selected GitHub repositories with the device flow.
    AuthorizeGithub {
        #[arg(long)]
        id: String,
        #[arg(long, env = "SANDBOX_GITHUB_APP_CLIENT_ID")]
        client_id: String,
        #[arg(long)]
        installation_id: Option<u64>,
        #[arg(long = "repository", required = true)]
        repositories: Vec<String>,
    },
    /// Remove one runner-local connection and its credential.
    RemoveConnection {
        #[arg(long)]
        id: String,
    },
}

#[tokio::main]
async fn main() {
    cli::enable_virtual_terminal();
    if let Err(error) = run().await {
        eprintln!("{error}");
        std::process::exit(error.exit_code)
    }
}

async fn run() -> Result<(), CliError> {
    let cli = match Cli::try_parse() {
        Ok(cli) => cli,
        Err(error)
            if matches!(
                error.kind(),
                ErrorKind::DisplayHelp | ErrorKind::DisplayVersion
            ) =>
        {
            error
                .print()
                .map_err(|source| CliError::runtime(source.to_string()))?;
            return Ok(());
        }
        Err(error) => return Err(CliError::invalid_input(error.to_string())),
    };
    match cli.command {
        None if std::io::stdin().is_terminal() && std::io::stdout().is_terminal() => {
            cli::home(&cli.config).await?;
        }
        None => {
            Cli::command()
                .print_help()
                .map_err(|error| CliError::runtime(error.to_string()))?;
            println!();
        }
        Some(Command::Setup { force }) => cli::interactive_setup(&cli.config, force)?,
        Some(Command::Doctor { json }) => {
            let checks = cli::doctor(&cli.config);
            cli::print_doctor(&checks, json)?;
            if checks
                .iter()
                .any(|check| matches!(check.state, cli::CheckState::Fail))
            {
                return Err(CliError::new(
                    sbx_code!("1100"),
                    "One or more doctor checks failed.",
                    2,
                )
                .help(format!(
                    "Resolve the named checks, then rerun the command. Docs: {DOCS_URL}"
                )));
            }
        }
        Some(Command::Status { json }) => cli::print_status(&cli.config, json)?,
        Some(command) => {
            let config = cli::load_config(&cli.config)?;
            run_command(command, &config).await?;
        }
    }
    Ok(())
}

async fn run_command(command: Command, config: &RunnerConfig) -> Result<(), CliError> {
    match command {
        Command::Validate => {
            build_http_client(config).map_err(classify_runtime_error)?;
            CommandVerifier::from_config(config)
                .map_err(|error| CliError::new(sbx_code!("1102"), error, 2))?;
            println!("✓ configuration valid");
            println!(
                "  runner: {}\n  environment: {}\n  trusted signing keys: {}",
                config.runner_name,
                config.environment,
                config.command_signing_keys.len()
            );
        }
        Command::Pair { token } => {
            cli::require_unprivileged("pair")?;
            let token = cli::read_pairing_token(token)?;
            std::fs::create_dir_all(&config.data_directory).map_err(|error| {
                CliError::filesystem("Could not create the runner data directory", error)
            })?;
            let identity_path = config.data_directory.join("identity.json");
            if identity_path.exists() {
                return Err(CliError::new(
                    sbx_code!("1008"),
                    "Runner is already paired; its identity was not replaced.",
                    3,
                )
                .help("Revoke it in Account → Operations before replacing its identity."));
            }
            let client = build_http_client(config).map_err(classify_runtime_error)?;
            let (identity, fingerprint) = pair(config, &token, &client)
                .await
                .map_err(classify_pairing_error)?;
            identity.save(&identity_path).map_err(|error| {
                CliError::filesystem("Could not save the runner identity", error)
            })?;
            println!("Pairing request accepted. Confirm fingerprint: {fingerprint}");
            println!("Next: sudo systemctl enable --now sandbox-runner");
        }
        Command::Run => {
            cli::require_unprivileged("run")?;
            cli::require_identity(config)?;
            run_service(config).await.map_err(CliError::runtime)?;
        }
        Command::AuthorizeConnection {
            id,
            provider,
            display_name,
            account_identifier,
            scopes,
        } => {
            cli::require_unprivileged("authorize-connection")?;
            authorize_connection(
                config,
                &id,
                &provider,
                &display_name,
                account_identifier,
                scopes,
            )
            .map_err(CliError::runtime)?;
        }
        Command::AuthorizeGithub {
            id,
            client_id,
            installation_id,
            repositories,
        } => {
            cli::require_unprivileged("authorize-github")?;
            authorize_github(config, &id, &client_id, installation_id, repositories)
                .await
                .map_err(classify_runtime_error)?;
        }
        Command::RemoveConnection { id } => {
            cli::require_unprivileged("remove-connection")?;
            remove_connection(config, &id).map_err(CliError::runtime)?
        }
        Command::Setup { .. } | Command::Doctor { .. } | Command::Status { .. } => {
            unreachable!("handled before configuration loading")
        }
    }
    Ok(())
}

fn classify_pairing_error(error: String) -> CliError {
    if error.contains("error sending request")
        || error.contains("connect")
        || error.contains("DNS")
        || error.contains("certificate")
    {
        CliError::network(error)
    } else {
        CliError::pairing(error)
    }
}

fn classify_runtime_error(error: String) -> CliError {
    if error.contains("error sending request")
        || error.contains("connect")
        || error.contains("certificate")
        || error.contains("proxy")
    {
        CliError::network(error)
    } else {
        CliError::runtime(error)
    }
}

fn authorize_connection(
    config: &RunnerConfig,
    id: &str,
    provider: &str,
    display_name: &str,
    account_identifier: Option<String>,
    scopes: Vec<String>,
) -> Result<(), String> {
    validate_connection_id_provider(id, provider)?;
    let mut input = Vec::new();
    std::io::stdin()
        .take(65_537)
        .read_to_end(&mut input)
        .map_err(|error| error.to_string())?;
    if input.len() > 65_536 {
        return Err("Connection secret exceeds the 64 KB vault limit.".into());
    }
    let secret: Value = serde_json::from_slice(&input)
        .map_err(|_| "Read a JSON credential object from standard input.".to_string())?;
    if !secret.is_object() {
        return Err("Connection secret must be a JSON object.".into());
    }
    let vault = OsCredentialVault::new();
    vault.put(id, &secret)?;
    if let Err(error) = write_connection_marker(
        config,
        id,
        json!({"authorized":true,"providerId":provider,"displayName":display_name,"accountIdentifier":account_identifier,"scopes":scopes,"metadata":{"authorizedAt":chrono::Utc::now(),"authType":"runner_local"}}),
    ) {
        let _ = vault.delete(id);
        return Err(error);
    }
    println!("Connection {id} is authorized in this runner's OS vault.");
    Ok(())
}

async fn authorize_github(
    config: &RunnerConfig,
    id: &str,
    client_id: &str,
    installation_id: Option<u64>,
    repositories: Vec<String>,
) -> Result<(), String> {
    validate_connection_id_provider(id, "github_app")?;
    if client_id.trim().is_empty() {
        return Err("GitHub App client ID is required.".into());
    }
    for repository in &repositories {
        validate_repository(repository)?;
    }
    let client = build_http_client(config)?;
    let device: Value = client
        .post("https://github.com/login/device/code")
        .header("accept", "application/json")
        .form(&[("client_id", client_id)])
        .send()
        .await
        .map_err(|error| error.to_string())?
        .json()
        .await
        .map_err(|error| error.to_string())?;
    let verification = device
        .get("verification_uri")
        .and_then(Value::as_str)
        .ok_or("GitHub did not return a verification URL.")?;
    let user_code = device
        .get("user_code")
        .and_then(Value::as_str)
        .ok_or("GitHub did not return a user code.")?;
    let device_code = device
        .get("device_code")
        .and_then(Value::as_str)
        .ok_or("GitHub did not return a device code.")?;
    let mut wait = device
        .get("interval")
        .and_then(Value::as_u64)
        .unwrap_or(5)
        .max(5);
    let deadline = chrono::Utc::now()
        + chrono::Duration::seconds(
            device
                .get("expires_in")
                .and_then(Value::as_i64)
                .unwrap_or(900),
        );
    println!("Open {verification} and enter code {user_code}.");
    let token = loop {
        if chrono::Utc::now() >= deadline {
            return Err("GitHub device authorization expired.".into());
        }
        tokio::time::sleep(Duration::from_secs(wait)).await;
        let response: Value = client
            .post("https://github.com/login/oauth/access_token")
            .header("accept", "application/json")
            .form(&[
                ("client_id", client_id),
                ("device_code", device_code),
                ("grant_type", "urn:ietf:params:oauth:grant-type:device_code"),
            ])
            .send()
            .await
            .map_err(|error| error.to_string())?
            .json()
            .await
            .map_err(|error| error.to_string())?;
        match response.get("error").and_then(Value::as_str) {
            Some("authorization_pending") => continue,
            Some("slow_down") => {
                wait += 5;
                continue;
            }
            Some(error) => return Err(format!("GitHub authorization failed: {error}.")),
            None => break response,
        }
    };
    let access = token
        .get("access_token")
        .and_then(Value::as_str)
        .ok_or("GitHub did not return an access token.")?;
    let github = |request: reqwest::RequestBuilder| {
        request
            .bearer_auth(access)
            .header("accept", "application/vnd.github+json")
            .header("X-GitHub-Api-Version", "2026-03-10")
            .header("user-agent", "sndbox-runner/0.8")
    };
    let profile: Value = github(client.get("https://api.github.com/user"))
        .send()
        .await
        .map_err(|error| error.to_string())?
        .json()
        .await
        .map_err(|error| error.to_string())?;
    let installations: Value = github(client.get("https://api.github.com/user/installations"))
        .send()
        .await
        .map_err(|error| error.to_string())?
        .json()
        .await
        .map_err(|error| error.to_string())?;
    let available_installations = installations
        .get("installations")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let selected_installation = installation_id
        .or_else(|| {
            (available_installations.len() == 1)
                .then(|| available_installations[0].get("id").and_then(Value::as_u64))
                .flatten()
        })
        .ok_or_else(|| {
            format!(
                "Choose --installation-id from: {}",
                available_installations
                    .iter()
                    .filter_map(|item| Some(format!(
                        "{} ({})",
                        item.get("id")?,
                        item.pointer("/account/login")?.as_str()?
                    )))
                    .collect::<Vec<_>>()
                    .join(", ")
            )
        })?;
    let selected_summary = available_installations
        .iter()
        .find(|item| item.get("id").and_then(Value::as_u64) == Some(selected_installation))
        .ok_or("The selected GitHub installation is unavailable.")?;
    let available:Value=github(client.get(format!("https://api.github.com/user/installations/{selected_installation}/repositories?per_page=100"))).send().await.map_err(|error|error.to_string())?.json().await.map_err(|error|error.to_string())?;
    let repository_items = available
        .get("repositories")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let selected=repositories.iter().map(|name|repository_items.iter().find(|item|item.get("full_name").and_then(Value::as_str)==Some(name)).map(|item|json!({"repositoryId":item.get("id"),"fullName":name,"owner":item.pointer("/owner/login"),"permissions":item.get("permissions")})).ok_or_else(||format!("Repository '{name}' is unavailable to installation {selected_installation}."))).collect::<Result<Vec<_>,_>>()?;
    let vault = OsCredentialVault::new();
    vault.put(id,&json!({"accessToken":access,"refreshToken":token.get("refresh_token"),"tokenType":token.get("token_type")}))?;
    let login = profile
        .get("login")
        .and_then(Value::as_str)
        .unwrap_or("GitHub account");
    let scopes = vec![
        "metadata:read",
        "issues:write",
        "pull_requests:write",
        "actions:write",
        "contents:write",
    ];
    if let Err(error) = write_connection_marker(
        config,
        id,
        json!({"authorized":true,"providerId":"github_app","displayName":login,"accountIdentifier":login,"scopes":scopes,"metadata":{"authType":"github_app_device_flow","avatarUrl":profile.get("avatar_url"),"installationId":selected_installation,"accessibleOwner":selected_summary.pointer("/account/login"),"selectedRepositories":selected,"grantedPermissionSnapshot":selected_summary.get("permissions"),"lastSuccessfulValidationTime":chrono::Utc::now()}}),
    ) {
        let _ = vault.delete(id);
        return Err(error);
    }
    println!(
        "GitHub connection {id} authorized for {} repositories.",
        repositories.len()
    );
    Ok(())
}

fn remove_connection(config: &RunnerConfig, id: &str) -> Result<(), String> {
    uuid::Uuid::parse_str(id).map_err(|_| "Connection ID must be a UUID.".to_string())?;
    OsCredentialVault::new().delete(id)?;
    let marker = config
        .data_directory
        .join("connections")
        .join(format!("{id}.json"));
    if marker.exists() {
        std::fs::remove_file(marker).map_err(|error| error.to_string())?;
    }
    println!("Connection {id} was removed from this runner.");
    Ok(())
}
fn validate_connection_id_provider(id: &str, provider: &str) -> Result<(), String> {
    uuid::Uuid::parse_str(id).map_err(|_| "Connection ID must be a UUID.".to_string())?;
    if !matches!(
        provider,
        "google_workspace" | "slack_oauth" | "notion" | "github_app"
    ) {
        return Err(
            "Provider must be google_workspace, slack_oauth, notion, or github_app.".into(),
        );
    }
    Ok(())
}
fn validate_repository(value: &str) -> Result<(), String> {
    let parts = value.split('/').collect::<Vec<_>>();
    if parts.len() != 2
        || parts.iter().any(|part| {
            part.is_empty()
                || !part.chars().all(|character| {
                    character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | '.')
                })
        })
    {
        Err("Repository must use owner/name format.".into())
    } else {
        Ok(())
    }
}
fn write_connection_marker(config: &RunnerConfig, id: &str, value: Value) -> Result<(), String> {
    let directory = config.data_directory.join("connections");
    std::fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    let destination = directory.join(format!("{id}.json"));
    let temporary = directory.join(format!(".{id}.{}.tmp", uuid::Uuid::new_v4()));
    std::fs::write(
        &temporary,
        serde_json::to_vec_pretty(&value).map_err(|error| error.to_string())?,
    )
    .map_err(|error| error.to_string())?;
    if destination.exists() {
        std::fs::remove_file(&destination).map_err(|error| error.to_string())?;
    }
    std::fs::rename(&temporary, destination).map_err(|error| error.to_string())
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
    let (engine, plugin_manager, credential_vault, provider_adapter) = open_engine(config)?;
    let engine = Arc::new(engine);
    let verifier = Arc::new(CommandVerifier::from_config(config)?);
    let activation = Arc::new(RunnerActivation::new(
        config,
        plugin_manager,
        credential_vault,
        provider_adapter,
    ));
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
    let polling_task = tokio::spawn(poll_synced_triggers(
        device.clone(),
        engine.clone(),
        activation.clone(),
        runner_id.clone(),
    ));
    loop {
        tokio::select! {
            signal = shutdown_signal() => {
                signal?;
                if let Err(error) = device.heartbeat(active.load(Ordering::Relaxed), RunnerStatus::Draining).await { eprintln!("warn[{}]: failed to report draining state: {error}", sbx_code!("2101")); }
                break;
            },
            _ = heartbeat.tick() => if let Err(error) = device.heartbeat(active.load(Ordering::Relaxed), RunnerStatus::Online).await { eprintln!("warn[{}]: heartbeat failed: {error}", sbx_code!("2102")); },
            _ = poll.tick() => {
                let available = config.concurrency.saturating_sub(active.load(Ordering::Relaxed));
                if available == 0 { continue; }
                match device.commands(available.min(50)).await {
                    Ok(commands) => for command in commands {
                        let Ok(permit) = permits.clone().try_acquire_owned() else { break };
                        let device = device.clone(); let engine = engine.clone(); let verifier = verifier.clone(); let activation = activation.clone();
                        let runner_id = runner_id.clone(); let workspace_id = config.workspace_id.clone();let environment_id=config.environment_id.clone();let environment=config.environment.clone(); let active = active.clone();
                        active.fetch_add(1, Ordering::Relaxed);
                        tasks.spawn(async move {
                            let _permit = permit;
                            process_command(&device, &engine, &verifier, &runner_id, &workspace_id,&environment_id,&environment, &activation, command).await;
                            active.fetch_sub(1, Ordering::Relaxed);
                        });
                    },
                    Err(error) => eprintln!("warn[{}]: command poll failed: {error}", sbx_code!("2103")),
                }
            },
            Some(result) = tasks.join_next(), if !tasks.is_empty() => if let Err(error) = result { eprintln!("warn[{}]: command task failed: {error}", sbx_code!("2104")); },
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
    polling_task.abort();
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
