use crate::model::ExecutionError;

#[derive(Debug, thiserror::Error)]
pub enum EngineError {
    #[error("{0}")]
    Validation(String),
    #[error("{0}")]
    Storage(String),
    #[error("{0}")]
    Node(String),
    #[error("Execution cancelled")]
    Cancelled,
    #[error("{0}")]
    Permission(String),
}

impl EngineError {
    pub fn execution_error(&self) -> ExecutionError {
        let (code, suggestion) = match self {
            Self::Validation(_) => (
                "workflow_validation",
                "Open the workflow and resolve its validation warnings.",
            ),
            Self::Storage(_) => (
                "storage_error",
                "Retry the operation. If it continues, restart Sandbox.",
            ),
            Self::Node(_) => (
                "node_failed",
                "Inspect this node's input and configuration, then retry.",
            ),
            Self::Cancelled => ("cancelled", "Run the workflow again when ready."),
            Self::Permission(_) => (
                "permission_required",
                "Review and approve the workflow permissions.",
            ),
        };
        ExecutionError {
            code: code.into(),
            message: self.to_string(),
            detail: None,
            suggestion: Some(suggestion.into()),
        }
    }
}
