use crate::PluginError;
use jsonschema::PatternOptions;
use serde_json::Value;

pub(crate) fn validate_declared_schema(schema: &Value) -> Result<(), String> {
    reject_external_references(schema)?;
    jsonschema::draft202012::meta::validate(schema)
        .map_err(|error| format!("is not valid JSON Schema: {error}"))?;
    jsonschema::draft202012::options()
        .with_pattern_options(PatternOptions::regex())
        .build(schema)
        .map_err(|error| format!("could not be compiled safely: {error}"))?;
    Ok(())
}

pub fn validate_schema_instance(
    schema: &Value,
    instance: &Value,
    label: &str,
) -> Result<(), PluginError> {
    reject_external_references(schema).map_err(PluginError::Manifest)?;
    let validator = jsonschema::draft202012::options()
        // Publisher-controlled regular expressions must have linear-time behavior.
        .with_pattern_options(PatternOptions::regex())
        .build(schema)
        .map_err(|error| PluginError::Manifest(format!("{label} schema is invalid: {error}")))?;
    validator.validate(instance).map_err(|error| {
        PluginError::Manifest(format!(
            "{label} does not match the declared schema at {}: {}",
            error.instance_path(),
            error
        ))
    })
}

fn reject_external_references(value: &Value) -> Result<(), String> {
    match value {
        Value::Object(object) => {
            if let Some(reference) = object.get("$ref").and_then(Value::as_str) {
                if !reference.starts_with('#') {
                    return Err(
                        "external JSON Schema references are not allowed in plugin packages".into(),
                    );
                }
            }
            for nested in object.values() {
                reject_external_references(nested)?;
            }
        }
        Value::Array(values) => {
            for nested in values {
                reject_external_references(nested)?;
            }
        }
        _ => {}
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn validates_instances_without_resolving_external_resources() {
        let schema = json!({"type":"object","required":["name"],"properties":{"name":{"type":"string","pattern":"^[a-z]+$"}},"additionalProperties":false});
        validate_declared_schema(&schema).unwrap();
        validate_schema_instance(&schema, &json!({"name":"safe"}), "Input").unwrap();
        assert!(
            validate_schema_instance(&schema, &json!({"name":"123"}), "Input")
                .unwrap_err()
                .to_string()
                .contains("declared schema")
        );
        assert!(validate_declared_schema(&json!({"$ref":"file:///etc/passwd"})).is_err());
        assert!(validate_declared_schema(&json!({"$ref":"https://example.com/schema"})).is_err());
    }
}
