use serde_json::{json, Value};

#[link(wasm_import_module = "sandbox_v1")]
extern "C" {
    fn host_call(
        request_pointer: i32,
        request_length: i32,
        output_pointer: i32,
        output_capacity: i32,
    ) -> i32;
}

#[no_mangle]
pub extern "C" fn alloc(length: i32) -> i32 {
    let mut value = Vec::<u8>::with_capacity(length.max(0) as usize);
    let pointer = value.as_mut_ptr();
    std::mem::forget(value);
    pointer as i32
}

#[no_mangle]
pub unsafe extern "C" fn execute(pointer: i32, length: i32) -> i64 {
    let bytes = std::slice::from_raw_parts(pointer as *const u8, length.max(0) as usize);
    let invocation: Value = match serde_json::from_slice(bytes) {
        Ok(value) => value,
        Err(error) => return envelope_error("invalid_input", &error.to_string()),
    };
    let Some(node_type) = invocation.get("nodeType").and_then(Value::as_str) else {
        return envelope_error("invalid_invocation", "The host did not provide nodeType.");
    };
    let Some(_connection_id) = invocation
        .get("configuration")
        .and_then(|value| value.get("connectionId"))
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
    else {
        return envelope_error("connection_required", "Select a connection before running this node.");
    };
    let provider = match node_type.split('.').next().unwrap_or_default() {
        "google" => "google_workspace",
        "slack" => "slack_oauth",
        "notion" => "notion",
        "github" => "github_app",
        _ => return envelope_error("unsupported_provider", "The first-party provider is not supported."),
    };
    let request = json!({
        "operation": "provider_request",
        "connectionReference": "connection",
        "provider": provider,
        "action": node_type,
        "arguments": {
            "configuration": invocation.get("configuration").cloned().unwrap_or_else(|| json!({})),
            "input": invocation.get("input").cloned().unwrap_or(Value::Null),
            "idempotencyKey": invocation.get("idempotencyKey").cloned().unwrap_or(Value::Null)
        },
        "fileGrants": invocation.get("fileGrants").cloned().unwrap_or_else(|| json!([]))
    });
    match call_host(request) {
        Ok(response) => return_json(json!({
            "ok": true,
            "output": response.pointer("/response/value").cloned().unwrap_or(Value::Null)
        })),
        Err(error) => envelope_error("provider_request_failed", &error),
    }
}

fn call_host(request: Value) -> Result<Value, String> {
    let request = serde_json::to_vec(&request).map_err(|error| error.to_string())?;
    let mut output = vec![0_u8; 2 * 1024 * 1024];
    let length = unsafe {
        host_call(
            request.as_ptr() as i32,
            request.len() as i32,
            output.as_mut_ptr() as i32,
            output.len() as i32,
        )
    };
    if length <= 0 {
        return Err("The provider host response exceeded its buffer.".into());
    }
    output.truncate(length as usize);
    let response: Value = serde_json::from_slice(&output).map_err(|error| error.to_string())?;
    if response.get("ok").and_then(Value::as_bool) != Some(true) {
        return Err(response
            .pointer("/error/message")
            .and_then(Value::as_str)
            .unwrap_or("The provider host rejected the operation.")
            .to_string());
    }
    Ok(response)
}

fn envelope_error(code: &str, message: &str) -> i64 {
    return_json(json!({"ok": false, "error": {"code": code, "message": message}}))
}

fn return_json(value: Value) -> i64 {
    let mut output = serde_json::to_vec(&value).unwrap_or_else(|_| b"null".to_vec());
    let pointer = output.as_mut_ptr() as u32;
    let length = output.len() as u32;
    std::mem::forget(output);
    ((pointer as i64) << 32) | length as i64
}
