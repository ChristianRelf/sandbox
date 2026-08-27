use thiserror::Error;

#[derive(Debug, Error)]
pub enum PluginError {
    #[error("manifest validation failed: {0}")]
    Manifest(String),
    #[error("package verification failed: {0}")]
    Package(String),
    #[error("plugin permission denied: {0}")]
    Permission(String),
    #[error("plugin sandbox failed: {0}")]
    Sandbox(String),
    #[error("plugin execution exceeded its resource limit: {0}")]
    ResourceLimit(String),
    #[error("plugin host call failed: {0}")]
    Host(String),
    #[error("plugin storage failed: {0}")]
    Storage(String),
    #[error("plugin execution was cancelled")]
    Cancelled,
}
