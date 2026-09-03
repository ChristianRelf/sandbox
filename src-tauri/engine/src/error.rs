use crate::model::{BrowserDiagnostics, ExecutionError};

#[derive(Debug, thiserror::Error)]
pub enum EngineError {
    #[error("{0}")]
    Validation(String),
    #[error("{0}")]
    Storage(String),
    #[error("{0}")]
    Node(String),
    #[error("{message}")]
    NodeCode { code: String, message: String },
    #[error("Execution cancelled")]
    Cancelled,
    #[error("{0}")]
    Permission(String),
    #[error("{message}")]
    Browser {
        message: String,
        diagnostics: Option<BrowserDiagnostics>,
    },
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
                "Retry the operation. If it continues, restart sndbox.",
            ),
            Self::Node(_) => (
                "node_failed",
                "Inspect this node's input and configuration, then retry.",
            ),
            Self::NodeCode { code, .. } => (
                code.as_str(),
                "Reduce the collection or adjust the explicit workflow limit, then retry.",
            ),
            Self::Cancelled => ("cancelled", "Run the workflow again when ready."),
            Self::Permission(_) => (
                "permission_required",
                "Review and approve the workflow permissions.",
            ),
            Self::Browser { .. } => (
                "browser_operation_failed",
                "Inspect the locator attempts and failure screenshot, then test or re-record this node.",
            ),
        };
        let (line, column) = source_location(&self.to_string());
        ExecutionError {
            code: code.into(),
            message: self.to_string(),
            detail: None,
            suggestion: Some(suggestion.into()),
            line,
            column,
        }
    }
}

fn source_location(message: &str) -> (Option<u32>, Option<u32>) {
    for marker in ["user_code.py:", "<anonymous>:"] {
        if let Some(position) = message.find(marker) {
            let tail = &message[position + marker.len()..];
            let mut numbers = tail
                .split(|character: char| !character.is_ascii_digit())
                .filter(|part| !part.is_empty());
            let mut line = numbers.next().and_then(|value| value.parse::<u32>().ok());
            let column = numbers.next().and_then(|value| value.parse::<u32>().ok());
            // AsyncFunction adds two wrapper lines before user JavaScript.
            if marker == "<anonymous>:" {
                line = line.map(|value| value.saturating_sub(2).max(1));
            }
            return (line, column);
        }
    }
    (None, None)
}
