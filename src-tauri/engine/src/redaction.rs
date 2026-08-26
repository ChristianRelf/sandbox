use serde_json::Value;

const SENSITIVE: &[&str] = &[
    "authorization",
    "proxy-authorization",
    "cookie",
    "set-cookie",
    "x-api-key",
    "api-key",
    "token",
    "secret",
    "password",
];
const MAX_LOG_CHARS: usize = 8_192;
const MAX_VALUE_CHARS: usize = 262_144;

pub fn redact_value(value: &Value) -> Value {
    match value {
        Value::Object(map) => Value::Object(
            map.iter()
                .map(|(key, value)| {
                    let redacted = if SENSITIVE
                        .iter()
                        .any(|s| key.to_ascii_lowercase().contains(s))
                    {
                        Value::String("[REDACTED]".into())
                    } else {
                        redact_value(value)
                    };
                    (key.clone(), redacted)
                })
                .collect(),
        ),
        Value::Array(values) => Value::Array(values.iter().map(redact_value).collect()),
        Value::String(value) if value.len() > MAX_VALUE_CHARS => {
            Value::String(format!("{}… [truncated]", &value[..MAX_VALUE_CHARS]))
        }
        _ => value.clone(),
    }
}

pub fn bounded_log(message: impl AsRef<str>) -> String {
    let value = message.as_ref();
    if value.chars().count() <= MAX_LOG_CHARS {
        value.to_string()
    } else {
        format!(
            "{}… [truncated]",
            value.chars().take(MAX_LOG_CHARS).collect::<String>()
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn redacts_nested_secrets() {
        let out = redact_value(
            &json!({"headers":{"Authorization":"Bearer abc","Accept":"json"},"password":"oops"}),
        );
        assert_eq!(out["headers"]["Authorization"], "[REDACTED]");
        assert_eq!(out["headers"]["Accept"], "json");
        assert_eq!(out["password"], "[REDACTED]");
    }
}
