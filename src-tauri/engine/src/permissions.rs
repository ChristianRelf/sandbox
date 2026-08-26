use crate::{EngineError, PermissionSummary};
use std::path::{Path, PathBuf};
use url::Url;

fn normalized(path: &Path) -> Option<PathBuf> {
    if path.exists() {
        path.canonicalize().ok()
    } else {
        let parent = path.parent()?.canonicalize().ok()?;
        Some(parent.join(path.file_name()?))
    }
}

pub fn require_path(path: &Path, permissions: &PermissionSummary) -> Result<PathBuf, EngineError> {
    let requested = normalized(path).ok_or_else(|| {
        EngineError::Permission(format!(
            "The selected path '{}' is no longer available.",
            path.display()
        ))
    })?;
    let allowed = permissions
        .approved_folders
        .iter()
        .filter_map(|p| normalized(Path::new(p)))
        .any(|root| requested.starts_with(root));
    if allowed {
        Ok(requested)
    } else {
        Err(EngineError::Permission(format!(
            "'{}' is outside the workflow's approved folders.",
            path.display()
        )))
    }
}

pub fn require_domain(url: &str, permissions: &PermissionSummary) -> Result<(), EngineError> {
    let parsed = Url::parse(url)
        .map_err(|_| EngineError::Validation("HTTP Request URL is invalid.".into()))?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return Err(EngineError::Permission(
            "HTTP Request only supports http and https URLs.".into(),
        ));
    }
    let host = parsed
        .host_str()
        .ok_or_else(|| EngineError::Validation("HTTP Request URL has no domain.".into()))?;
    if permissions
        .approved_network_domains
        .iter()
        .any(|d| d == "*" || d.eq_ignore_ascii_case(host))
    {
        Ok(())
    } else {
        Err(EngineError::Permission(format!(
            "Network access to '{host}' has not been approved."
        )))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;
    #[test]
    fn enforces_folder_boundary() {
        let root = tempdir().unwrap();
        let other = tempdir().unwrap();
        let permissions = PermissionSummary {
            approved_folders: vec![root.path().display().to_string()],
            ..Default::default()
        };
        assert!(require_path(&root.path().join("new.txt"), &permissions).is_ok());
        assert!(require_path(&other.path().join("new.txt"), &permissions).is_err());
    }
}
