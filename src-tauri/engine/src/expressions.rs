//! Deterministic, allowlisted workflow expressions.
//!
//! This deliberately is not JavaScript. The small language supports paths,
//! safe access, null coalescing and a versioned helper set. It has no host,
//! filesystem, network, process, module or credential primitives.

use crate::EngineError;
use serde_json::{json, Map, Number, Value};
use std::collections::HashMap;

pub const EXPRESSION_LANGUAGE_VERSION: u32 = 1;
const MAX_EXPRESSION_BYTES: usize = 16 * 1024;
const MAX_PATH_SEGMENTS: usize = 256;

#[derive(Clone)]
pub struct ExpressionContext<'a> {
    pub input: &'a Value,
    pub items: &'a [Value],
    pub trigger: &'a Value,
    pub outputs: &'a HashMap<String, Value>,
    pub workflow: &'a Value,
    pub execution: &'a Value,
    pub environment: &'a Map<String, Value>,
}

#[derive(Debug, Clone, PartialEq)]
enum Evaluated {
    Missing,
    Value(Value),
}

/// Lightweight static inspection used by workflow validation and editor
/// autocomplete. Runtime evaluation remains the authority for values/types.
pub fn inspect_template(source: &str) -> Result<Vec<String>, EngineError> {
    if source.len() > MAX_EXPRESSION_BYTES { return Err(expression_error("Expression exceeds the 16 KiB limit.")); }
    let openings = source.match_indices("{{").count();
    let closings = source.match_indices("}}").count();
    if openings != closings { return Err(expression_error("Expression delimiters are not balanced.")); }
    for forbidden in ["__proto__", "prototype", "constructor", "eval(", "Function(", "process.", "globalThis", "require("] {
        if source.contains(forbidden) { return Err(expression_error("Expression contains a forbidden host or prototype operation.")); }
    }
    let mut expression_cursor=0;
    while let Some(relative)=source[expression_cursor..].find("{{") {
        let start=expression_cursor+relative+2;let end=source[start..].find("}}").ok_or_else(||expression_error("Expression delimiters are not balanced."))?+start;let body=source[start..end].trim();
        if body.is_empty()||body.contains("..")||body.ends_with('.') {return Err(expression_error("Expression contains an incomplete property path."));}
        for alternative in split_top_level(body,"??")? {
            let atom=alternative.trim();let head=atom.split(|character:char|character=='.'||character=='['||character=='('||character.is_whitespace()).next().unwrap_or("");
            let root_ok=matches!(head,"input"|"items"|"trigger"|"nodes"|"workflow"|"execution"|"env"|"string"|"number"|"boolean"|"json"|"array"|"object"|"date")||parse_literal(atom)?.is_some();
            if !root_ok{return Err(expression_error(&format!("Unknown expression root '{head}'.")));}
        }
        expression_cursor=end+2;
    }
    let mut node_ids = Vec::new();
    let mut cursor = 0;
    while let Some(relative) = source[cursor..].find("nodes.") {
        let start = cursor + relative + "nodes.".len();
        let end = source[start..].find(|character: char| !(character.is_ascii_alphanumeric() || character == '_' || character == '-')).map(|value| start + value).unwrap_or(source.len());
        if end == start { return Err(expression_error("nodes requires a node identifier.")); }
        node_ids.push(source[start..end].to_string());
        cursor = end;
    }
    Ok(node_ids)
}

pub fn resolve_value(value: &Value, context: &ExpressionContext<'_>) -> Result<Value, EngineError> {
    match value {
        Value::String(source) => resolve_string(source, context),
        Value::Array(values) => Ok(Value::Array(values.iter().map(|value| resolve_value(value, context)).collect::<Result<_, _>>()?)),
        Value::Object(values) => {
            let mut resolved = Map::new();
            for (key, value) in values {
                resolved.insert(key.clone(), resolve_value(value, context)?);
            }
            Ok(Value::Object(resolved))
        }
        _ => Ok(value.clone()),
    }
}

pub fn evaluate(source: &str, context: &ExpressionContext<'_>) -> Result<Value, EngineError> {
    if source.len() > MAX_EXPRESSION_BYTES {
        return Err(expression_error("Expression exceeds the 16 KiB limit."));
    }
    let source = source.trim();
    if source.is_empty() {
        return Err(expression_error("Expression is empty."));
    }
    let parts = split_top_level(source, "??")?;
    for (index, part) in parts.iter().enumerate() {
        let result = evaluate_atom(part.trim(), context)?;
        match result {
            Evaluated::Value(Value::Null) | Evaluated::Missing if index + 1 < parts.len() => continue,
            Evaluated::Missing => return Err(expression_error(&format!("Value '{source}' is missing. Use safe access or ?? to provide a fallback."))),
            Evaluated::Value(value) => return Ok(value),
        }
    }
    Ok(Value::Null)
}

fn resolve_string(source: &str, context: &ExpressionContext<'_>) -> Result<Value, EngineError> {
    let trimmed = source.trim();
    if trimmed.starts_with("{{") && trimmed.ends_with("}}") && count_openings(trimmed) == 1 {
        return evaluate(trimmed[2..trimmed.len() - 2].trim(), context);
    }
    let mut output = String::with_capacity(source.len());
    let mut cursor = 0;
    while let Some(relative) = source[cursor..].find("{{") {
        let start = cursor + relative;
        output.push_str(&source[cursor..start]);
        let rest = &source[start + 2..];
        let end = rest.find("}}").ok_or_else(|| expression_error("Expression is missing a closing '}}'."))?;
        let value = evaluate(rest[..end].trim(), context)?;
        output.push_str(&display_value(&value));
        cursor = start + 2 + end + 2;
    }
    if source[cursor..].contains("}}") {
        return Err(expression_error("Expression has an unexpected closing '}}'."));
    }
    output.push_str(&source[cursor..]);
    Ok(Value::String(output))
}

fn evaluate_atom(source: &str, context: &ExpressionContext<'_>) -> Result<Evaluated, EngineError> {
    if let Some(value) = parse_literal(source)? {
        return Ok(Evaluated::Value(value));
    }
    if source.ends_with(')') {
        if let Some(open) = find_call_open(source) {
            let name = source[..open].trim();
            if valid_helper_name(name) {
                let args = split_arguments(&source[open + 1..source.len() - 1])?
                    .into_iter()
                    .map(|arg| evaluate(arg.trim(), context))
                    .collect::<Result<Vec<_>, _>>()?;
                return call_helper(name, args);
            }
        }
    }
    evaluate_path(source, context)
}

fn evaluate_path(source: &str, context: &ExpressionContext<'_>) -> Result<Evaluated, EngineError> {
    let (root, mut cursor) = read_identifier(source, 0)?;
    let root_value = match root.as_str() {
        "input" => context.input.clone(),
        "items" => Value::Array(context.items.to_vec()),
        "trigger" => context.trigger.clone(),
        "nodes" => json!(context.outputs.iter().map(|(id, value)| (id.clone(), json!({"output":value}))).collect::<Map<_,_>>()),
        "workflow" => context.workflow.clone(),
        "execution" => context.execution.clone(),
        "env" => Value::Object(context.environment.clone()),
        _ => return Err(expression_error(&format!("Unknown expression root '{root}'."))),
    };
    let mut current = Evaluated::Value(root_value);
    let mut segments = 0;
    while cursor < source.len() {
        segments += 1;
        if segments > MAX_PATH_SEGMENTS {
            return Err(expression_error("Expression path is too deep."));
        }
        let remaining = &source[cursor..];
        let (safe, segment, next) = if remaining.starts_with("?.") {
            let (name, next) = read_identifier(source, cursor + 2)?;
            (true, name, next)
        } else if remaining.starts_with('.') {
            let (name, next) = read_identifier(source, cursor + 1)?;
            (false, name, next)
        } else if remaining.starts_with("?[") || remaining.starts_with('[') {
            let safe = remaining.starts_with("?[");
            let offset = if safe { cursor + 2 } else { cursor + 1 };
            let close = source[offset..].find(']').ok_or_else(|| expression_error("Array access is missing ']'."))? + offset;
            let raw = source[offset..close].trim();
            let segment = if (raw.starts_with('\'') && raw.ends_with('\'')) || (raw.starts_with('"') && raw.ends_with('"')) {
                raw[1..raw.len() - 1].to_string()
            } else if raw.chars().all(|character| character.is_ascii_digit()) {
                raw.to_string()
            } else {
                return Err(expression_error("Bracket access accepts only a numeric index or quoted property."));
            };
            (safe, segment, close + 1)
        } else {
            return Err(expression_error(&format!("Unexpected token near '{}'.", truncate(remaining, 24))));
        };
        reject_segment(&segment)?;
        current = access(current, &segment, safe)?;
        cursor = next;
    }
    Ok(current)
}

fn access(current: Evaluated, segment: &str, safe: bool) -> Result<Evaluated, EngineError> {
    let value = match current {
        Evaluated::Missing => return if safe { Ok(Evaluated::Value(Value::Null)) } else { Ok(Evaluated::Missing) },
        Evaluated::Value(Value::Null) if safe => return Ok(Evaluated::Value(Value::Null)),
        Evaluated::Value(value) => value,
    };
    let found = match &value {
        Value::Object(object) => object.get(segment).cloned(),
        Value::Array(array) => segment.parse::<usize>().ok().and_then(|index| array.get(index).cloned()),
        _ => None,
    };
    match found {
        Some(value) => Ok(Evaluated::Value(value)),
        None if safe => Ok(Evaluated::Value(Value::Null)),
        None => Ok(Evaluated::Missing),
    }
}

fn call_helper(name: &str, args: Vec<Value>) -> Result<Evaluated, EngineError> {
    let arg = |index: usize| args.get(index).cloned().unwrap_or(Value::Null);
    let value = match name {
        "string" | "string.toString" => Value::String(display_value(&arg(0))),
        "string.lower" => Value::String(display_value(&arg(0)).to_lowercase()),
        "string.upper" => Value::String(display_value(&arg(0)).to_uppercase()),
        "string.trim" => Value::String(display_value(&arg(0)).trim().to_string()),
        "number" => match arg(0) {
            Value::Number(value) => Value::Number(value),
            Value::String(value) => Number::from_f64(value.parse::<f64>().map_err(|_| expression_error("number() could not convert its argument."))?).map(Value::Number).ok_or_else(|| expression_error("number() produced a non-finite value."))?,
            _ => return Err(expression_error("number() accepts a number or numeric string.")),
        },
        "boolean" => Value::Bool(match arg(0) { Value::Bool(value) => value, Value::String(value) if value == "true" => true, Value::String(value) if value == "false" => false, Value::Number(value) => value.as_f64().unwrap_or(0.0) != 0.0, _ => return Err(expression_error("boolean() accepts a boolean, true/false string, or number.")) }),
        "json.parse" => serde_json::from_str(arg(0).as_str().ok_or_else(|| expression_error("json.parse() requires a string."))?).map_err(|error| expression_error(&format!("json.parse() failed: {error}")))?,
        "json.stringify" => Value::String(serde_json::to_string(&arg(0)).map_err(|error| expression_error(&format!("json.stringify() failed: {error}")))?),
        "array.first" => arg(0).as_array().and_then(|value| value.first()).cloned().unwrap_or(Value::Null),
        "array.last" => arg(0).as_array().and_then(|value| value.last()).cloned().unwrap_or(Value::Null),
        "array.length" => Value::Number((arg(0).as_array().ok_or_else(|| expression_error("array.length() requires an array."))?.len() as u64).into()),
        "object.keys" => Value::Array(arg(0).as_object().ok_or_else(|| expression_error("object.keys() requires an object."))?.keys().cloned().map(Value::String).collect()),
        "object.values" => Value::Array(arg(0).as_object().ok_or_else(|| expression_error("object.values() requires an object."))?.values().cloned().collect()),
        "date.iso" => {
            let source = arg(0).as_str().ok_or_else(|| expression_error("date.iso() requires an RFC 3339 string."))?.to_string();
            let parsed = chrono::DateTime::parse_from_rfc3339(&source).map_err(|_| expression_error("date.iso() requires an RFC 3339 string."))?;
            Value::String(parsed.to_rfc3339())
        }
        _ => return Err(expression_error(&format!("Helper '{name}' is not available in expression language v{EXPRESSION_LANGUAGE_VERSION}."))),
    };
    Ok(Evaluated::Value(value))
}

fn valid_helper_name(value: &str) -> bool { !value.is_empty() && value.chars().all(|character| character.is_ascii_alphanumeric() || character == '.' || character == '_') }
fn reject_segment(value: &str) -> Result<(), EngineError> {
    if matches!(value, "__proto__" | "prototype" | "constructor") { Err(expression_error("Prototype and constructor traversal is forbidden.")) } else { Ok(()) }
}
fn read_identifier(source: &str, start: usize) -> Result<(String, usize), EngineError> {
    let mut end = start;
    for character in source[start..].chars() {
        if character.is_ascii_alphanumeric() || character == '_' || character == '-' { end += character.len_utf8(); } else { break; }
    }
    if end == start { return Err(expression_error("Expected a property name.")); }
    let value = source[start..end].to_string();
    reject_segment(&value)?;
    Ok((value, end))
}
fn parse_literal(source: &str) -> Result<Option<Value>, EngineError> {
    if source == "null" { return Ok(Some(Value::Null)); }
    if source == "true" { return Ok(Some(Value::Bool(true))); }
    if source == "false" { return Ok(Some(Value::Bool(false))); }
    if (source.starts_with('"') && source.ends_with('"')) || (source.starts_with('\'') && source.ends_with('\'')) {
        let inner = &source[1..source.len() - 1];
        return Ok(Some(Value::String(inner.replace("\\'", "'").replace("\\\"", "\"").replace("\\n", "\n"))));
    }
    if let Ok(value) = source.parse::<f64>() {
        return Ok(Number::from_f64(value).map(Value::Number));
    }
    Ok(None)
}
fn split_top_level<'a>(source: &'a str, separator: &str) -> Result<Vec<&'a str>, EngineError> {
    let mut parts = Vec::new(); let mut depth = 0i32; let mut quote = None; let mut start = 0; let bytes = source.as_bytes(); let separator = separator.as_bytes(); let mut index = 0;
    while index < bytes.len() {
        let character = bytes[index] as char;
        if let Some(active) = quote { if character == active && (index == 0 || bytes[index - 1] != b'\\') { quote = None; } index += 1; continue; }
        match character { '\'' | '"' => quote = Some(character), '(' | '[' | '{' => depth += 1, ')' | ']' | '}' => { depth -= 1; if depth < 0 { return Err(expression_error("Expression has unbalanced delimiters.")); } }, _ => {} }
        if depth == 0 && bytes[index..].starts_with(separator) { parts.push(&source[start..index]); index += separator.len(); start = index; } else { index += 1; }
    }
    if quote.is_some() || depth != 0 { return Err(expression_error("Expression has an unterminated string or delimiter.")); }
    parts.push(&source[start..]); Ok(parts)
}
fn split_arguments(source: &str) -> Result<Vec<&str>, EngineError> { if source.trim().is_empty() { Ok(vec![]) } else { split_top_level(source, ",") } }
fn find_call_open(source: &str) -> Option<usize> { source.char_indices().find_map(|(index, character)| (character == '(').then_some(index)) }
fn count_openings(value: &str) -> usize { value.match_indices("{{").count() }
fn display_value(value: &Value) -> String { match value { Value::String(value) => value.clone(), Value::Null => String::new(), other => other.to_string() } }
fn truncate(value: &str, maximum: usize) -> String { value.chars().take(maximum).collect() }
fn expression_error(message: &str) -> EngineError { EngineError::Node(format!("Expression error: {message}")) }

#[cfg(test)]
mod tests {
    use super::*;
    fn context<'a>(input: &'a Value, trigger: &'a Value, outputs: &'a HashMap<String, Value>, workflow: &'a Value, execution: &'a Value, environment: &'a Map<String, Value>) -> ExpressionContext<'a> { ExpressionContext { input, items: &[], trigger, outputs, workflow, execution, environment } }
    #[test]
    fn preserves_full_field_types_and_interpolates() {
        let input = json!({"data":{"total":0,"empty":"","nothing":null}}); let trigger=json!({"body":{"email":"a@example.com"}}); let outputs=HashMap::from([("extract".into(),json!({"data":{"heading":"Hello"}}))]); let workflow=json!({"name":"Example"}); let execution=json!({"id":"run-1"}); let env=Map::new(); let ctx=context(&input,&trigger,&outputs,&workflow,&execution,&env);
        assert_eq!(resolve_value(&json!("{{ input.data.total }}"),&ctx).unwrap(),json!(0));
        assert_eq!(resolve_value(&json!("The title is {{ nodes.extract.output.data.heading }}"),&ctx).unwrap(),json!("The title is Hello"));
        assert_eq!(evaluate("input.data.missing ?? 'fallback'",&ctx).unwrap(),json!("fallback"));
        assert_eq!(evaluate("input.data?.missing",&ctx).unwrap(),Value::Null);
    }
    #[test]
    fn supports_arrays_and_helpers() { let input=json!({"rows":[{"name":"  Ada  "}]});let trigger=json!({});let outputs=HashMap::new();let workflow=json!({});let execution=json!({});let env=Map::new();let ctx=context(&input,&trigger,&outputs,&workflow,&execution,&env); assert_eq!(evaluate("string.trim(input.rows[0].name)",&ctx).unwrap(),json!("Ada")); assert_eq!(evaluate("array.length(input.rows)",&ctx).unwrap(),json!(1)); }
    #[test]
    fn blocks_host_and_prototype_access() { let value=json!({});let outputs=HashMap::new();let env=Map::new();let ctx=context(&value,&value,&outputs,&value,&value,&env); assert!(evaluate("process.env.SECRET",&ctx).is_err()); assert!(evaluate("input.constructor.prototype",&ctx).is_err()); assert!(evaluate("eval('1')",&ctx).is_err()); }
    #[test]
    fn static_inspection_rejects_malformed_and_unknown_roots() { assert!(inspect_template("{{ trigger..body }}").is_err());assert!(inspect_template("{{ process.env }}").is_err());assert!(inspect_template("{{ input.value }}").is_ok()); }
}
