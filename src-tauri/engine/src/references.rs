use crate::EngineError;
use regex::Regex;
use serde_json::{Map, Value};
use std::collections::HashMap;

pub fn resolve_path(
    path: &str,
    trigger: &Value,
    outputs: &HashMap<String, Value>,
) -> Option<Value> {
    let parts: Vec<&str> = path.split('.').collect();
    if parts.is_empty() {
        return None;
    }
    let (root, rest) = match parts[0] {
        "trigger" => (trigger, &parts[1..]),
        "nodes" if parts.len() >= 3 && parts[2] == "output" => {
            (outputs.get(parts[1])?, &parts[3..])
        }
        _ => return None,
    };
    let mut current = root;
    for part in rest {
        if part.is_empty()
            || !part
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
        {
            return None;
        }
        current = current.get(*part)?;
    }
    Some(current.clone())
}

pub fn interpolate(
    template: &str,
    trigger: &Value,
    outputs: &HashMap<String, Value>,
) -> Result<String, EngineError> {
    let pattern = Regex::new(r"\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}").unwrap();
    let mut error = None;
    let result = pattern.replace_all(template, |caps: &regex::Captures| {
        match resolve_path(&caps[1], trigger, outputs) {
            Some(Value::String(s)) => s,
            Some(Value::Null) => String::new(),
            Some(v) => v.to_string(),
            None => {
                error = Some(format!("Data reference '{}' is not available.", &caps[1]));
                String::new()
            }
        }
    });
    if let Some(message) = error {
        Err(EngineError::Node(message))
    } else {
        Ok(result.into_owned())
    }
}

pub fn resolve_value(
    value: &Value,
    trigger: &Value,
    outputs: &HashMap<String, Value>,
) -> Result<Value, EngineError> {
    match value {
        Value::String(s) => {
            let trimmed = s.trim();
            if trimmed.starts_with("{{")
                && trimmed.ends_with("}}")
                && trimmed.matches("{{").count() == 1
            {
                let path = trimmed
                    .trim_start_matches("{{")
                    .trim_end_matches("}}")
                    .trim();
                resolve_path(path, trigger, outputs).ok_or_else(|| {
                    EngineError::Node(format!("Data reference '{path}' is not available."))
                })
            } else {
                Ok(Value::String(interpolate(s, trigger, outputs)?))
            }
        }
        Value::Array(values) => Ok(Value::Array(
            values
                .iter()
                .map(|v| resolve_value(v, trigger, outputs))
                .collect::<Result<_, _>>()?,
        )),
        Value::Object(values) => {
            let mut out = Map::new();
            for (key, value) in values {
                out.insert(key.clone(), resolve_value(value, trigger, outputs)?);
            }
            Ok(Value::Object(out))
        }
        _ => Ok(value.clone()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn resolves_safe_paths_and_templates() {
        let outputs = HashMap::from([("http".into(), json!({"status":200,"body":{"ok":true}}))]);
        assert_eq!(
            resolve_path("nodes.http.output.status", &json!({}), &outputs),
            Some(json!(200))
        );
        assert_eq!(
            interpolate(
                "Status {{ nodes.http.output.status }}",
                &json!({}),
                &outputs
            )
            .unwrap(),
            "Status 200"
        );
        assert!(resolve_path("nodes.http.output.__proto__", &json!({}), &outputs).is_none());
    }
}
