use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeMap,
    fs,
    path::{Path, PathBuf},
};
use url::Url;

#[derive(Debug, thiserror::Error)]
pub enum ConfigError {
    #[error("configuration read failed: {0}")]
    Io(#[from] std::io::Error),
    #[error("configuration is invalid: {0}")]
    Parse(#[from] toml::de::Error),
    #[error("configuration policy is invalid: {0}")]
    Policy(String),
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case", deny_unknown_fields)]
pub enum UpdateMode {
    Automatic,
    NotifyOnly,
    MaintenanceWindow,
    VersionPinned,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CertificateConfig {
    pub ca_file: Option<PathBuf>,
    pub client_certificate_file: Option<PathBuf>,
    pub client_key_file: Option<PathBuf>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct NetworkTarget {
    pub host: String,
    pub port: u16,
    pub protocol: String,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RunnerConfig {
    pub config_version: u16,
    pub control_plane_url: String,
    pub runner_name: String,
    pub workspace_id: String,
    pub environment: String,
    pub tags: Vec<String>,
    pub concurrency: u16,
    pub data_directory: PathBuf,
    pub plugin_cache: PathBuf,
    pub allowed_working_directories: Vec<PathBuf>,
    pub approved_network_targets: Vec<NetworkTarget>,
    pub log_level: String,
    pub update_channel: String,
    pub update_mode: UpdateMode,
    pub pinned_version_range: Option<String>,
    pub maintenance_window: Option<String>,
    pub proxy: Option<String>,
    pub certificate: CertificateConfig,
    pub drain_timeout_seconds: u32,
    pub enable_managed_chromium: bool,
    pub allow_simple_commands: bool,
    pub command_signing_keys: BTreeMap<String, String>,
}
impl RunnerConfig {
    pub fn load(path: &Path) -> Result<Self, ConfigError> {
        let parsed: Self = toml::from_str(&fs::read_to_string(path)?)?;
        parsed.validate()?;
        Ok(parsed)
    }
    pub fn validate(&self) -> Result<(), ConfigError> {
        if self.config_version != 1 {
            return Err(ConfigError::Policy("unsupported config_version".into()));
        }
        let url = Url::parse(&self.control_plane_url)
            .map_err(|_| ConfigError::Policy("control_plane_url must be a URL".into()))?;
        if url.scheme() != "https" && url.host_str() != Some("localhost") {
            return Err(ConfigError::Policy(
                "control_plane_url must use HTTPS".into(),
            ));
        }
        if url.username() != ""
            || url.password().is_some()
            || url.query().is_some()
            || url.fragment().is_some()
        {
            return Err(ConfigError::Policy(
                "control_plane_url must not contain credentials, a query, or a fragment".into(),
            ));
        }
        if self.runner_name.trim().is_empty() || self.workspace_id.trim().is_empty() {
            return Err(ConfigError::Policy(
                "runner name and workspace are required".into(),
            ));
        }
        uuid::Uuid::parse_str(&self.workspace_id)
            .map_err(|_| ConfigError::Policy("workspace_id must be a UUID".into()))?;
        if !matches!(
            self.environment.as_str(),
            "development" | "staging" | "production"
        ) {
            return Err(ConfigError::Policy("environment is invalid".into()));
        }
        if !(1..=128).contains(&self.concurrency) {
            return Err(ConfigError::Policy(
                "concurrency must be between 1 and 128".into(),
            ));
        }
        if !(5..=3600).contains(&self.drain_timeout_seconds) {
            return Err(ConfigError::Policy(
                "drain timeout must be between 5 and 3600 seconds".into(),
            ));
        }
        if !matches!(
            self.update_channel.as_str(),
            "stable" | "preview" | "development"
        ) {
            return Err(ConfigError::Policy("update channel is invalid".into()));
        }
        if !matches!(self.log_level.as_str(), "error" | "warn" | "info" | "debug") {
            return Err(ConfigError::Policy("log level is invalid".into()));
        }
        if !self.data_directory.is_absolute() || !self.plugin_cache.is_absolute() {
            return Err(ConfigError::Policy(
                "data and plugin-cache directories must be absolute".into(),
            ));
        }
        if self
            .allowed_working_directories
            .iter()
            .any(|path| !path.is_absolute())
        {
            return Err(ConfigError::Policy(
                "allowed working directories must be absolute".into(),
            ));
        }
        if self.tags.len() > 50
            || self
                .tags
                .iter()
                .any(|tag| tag.trim().is_empty() || tag.len() > 50)
        {
            return Err(ConfigError::Policy(
                "tags must be non-empty and at most 50 characters".into(),
            ));
        }
        match self.update_mode {
            UpdateMode::MaintenanceWindow
                if self.maintenance_window.as_deref().is_none_or(str::is_empty) =>
            {
                return Err(ConfigError::Policy(
                    "maintenance_window is required for maintenance-window updates".into(),
                ));
            }
            UpdateMode::VersionPinned
                if self
                    .pinned_version_range
                    .as_deref()
                    .is_none_or(str::is_empty) =>
            {
                return Err(ConfigError::Policy(
                    "pinned_version_range is required for version-pinned updates".into(),
                ));
            }
            _ => {}
        }
        if self.certificate.client_certificate_file.is_some()
            != self.certificate.client_key_file.is_some()
        {
            return Err(ConfigError::Policy(
                "client certificate and key files must be configured together".into(),
            ));
        }
        if let Some(proxy) = &self.proxy {
            let proxy =
                Url::parse(proxy).map_err(|_| ConfigError::Policy("proxy must be a URL".into()))?;
            if !matches!(proxy.scheme(), "http" | "https") {
                return Err(ConfigError::Policy("proxy must use HTTP or HTTPS".into()));
            }
        }
        for target in &self.approved_network_targets {
            if target.host.trim().is_empty()
                || target.port == 0
                || !matches!(target.protocol.as_str(), "http" | "https" | "tcp")
            {
                return Err(ConfigError::Policy(
                    "approved network targets require exact host, port and protocol".into(),
                ));
            }
        }
        if self.command_signing_keys.is_empty()
            || self
                .command_signing_keys
                .iter()
                .any(|(key_id, public_key)| {
                    key_id.is_empty()
                        || key_id.len() > 120
                        || public_key.is_empty()
                        || public_key.len() > 256
                })
        {
            return Err(ConfigError::Policy(
                "at least one bounded command_signing_keys entry is required".into(),
            ));
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_unknown_security_fields() {
        let input = r#"config_version=1
control_plane_url="https://control.example"
runner_name="server"
workspace_id="workspace"
environment="production"
tags=[]
concurrency=1
data_directory="/var/lib/sandbox"
plugin_cache="/var/lib/sandbox/plugins"
allowed_working_directories=[]
approved_network_targets=[]
log_level="info"
update_channel="stable"
update_mode="notify_only"
drain_timeout_seconds=30
enable_managed_chromium=false
allow_simple_commands=false
privileged=true
[command_signing_keys]
release-2026="MCowBQYDK2VwAyEAmvioumjf5SNvG9DZASLr1oYC3fz5MV9NVC11o7DFrZQ="
[certificate]
"#;
        assert!(toml::from_str::<RunnerConfig>(input)
            .unwrap_err()
            .to_string()
            .contains("unknown field"));
    }
}
