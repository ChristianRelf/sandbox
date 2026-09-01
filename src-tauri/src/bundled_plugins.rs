use crate::plugin_manager::PluginManager;
use sandbox_engine::{EngineError, InstalledPlugin};
use serde::Deserialize;

const GOOGLE_WORKSPACE: &[u8] = include_bytes!(
    "../../plugins/first-party/dist/com.sndbox.google-workspace-1.0.0.sandbox-plugin"
);
const SLACK: &[u8] =
    include_bytes!("../../plugins/first-party/dist/com.sndbox.slack-1.0.0.sandbox-plugin");
const NOTION: &[u8] =
    include_bytes!("../../plugins/first-party/dist/com.sndbox.notion-1.0.0.sandbox-plugin");
const GITHUB: &[u8] =
    include_bytes!("../../plugins/first-party/dist/com.sndbox.github-1.0.0.sandbox-plugin");
const REGISTRY: &str = include_str!("../../plugins/first-party/registry.json");

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RegistryTrust {
    publisher_id: String,
    key_id: String,
    public_key_pem: String,
}

pub fn install(manager: &PluginManager) -> Result<Vec<InstalledPlugin>, EngineError> {
    let trust: RegistryTrust = serde_json::from_str(REGISTRY)
        .map_err(|error| EngineError::Storage(format!("Bundled plugin registry is invalid: {error}")))?;
    [GOOGLE_WORKSPACE, SLACK, NOTION, GITHUB]
        .into_iter()
        .map(|package| {
            manager.install_bundled(
                package,
                &trust.publisher_id,
                &trust.key_id,
                &trust.public_key_pem,
            )
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use sandbox_engine::Database;

    #[test]
    fn bundled_packages_are_signed_and_expose_thirty_five_nodes() {
        let temp = tempfile::tempdir().unwrap();
        let manager = PluginManager::new(Database::in_memory().unwrap(), temp.path().into()).unwrap();
        let plugins = install(&manager).unwrap();
        assert_eq!(plugins.len(), 4);
        assert_eq!(
            plugins
                .iter()
                .map(|plugin| plugin.manifest["nodes"].as_array().unwrap().len())
                .sum::<usize>(),
            35
        );
        assert!(plugins.iter().all(|plugin| plugin.state == sandbox_engine::PluginInstallState::Enabled));
    }
}
