use serde_json::{json, Value};

#[link(wasm_import_module = "sandbox_v1")]
extern "C" {
    fn host_call(request_pointer: i32, request_length: i32, output_pointer: i32, output_capacity: i32) -> i32;
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
    let input = parse(pointer, length);
    let configuration = input.get("configuration").unwrap_or(&input);
    let subject = configuration.get("subject").and_then(Value::as_str).or_else(|| configuration.get("message").and_then(Value::as_str)).unwrap_or("Approval request");
    let details = configuration.get("details").and_then(Value::as_str).unwrap_or(subject);
    let credential_reference = configuration.get("credentialReference").and_then(Value::as_str).unwrap_or("internal-approval");
    let idempotency_key = input.get("idempotencyKey").and_then(Value::as_str).or_else(|| input.pointer("/input/idempotencyKey").and_then(Value::as_str));
    let Some(idempotency_key) = idempotency_key else {
        return return_json(json!({"ok":false,"error":{"code":"idempotency_required","message":"An idempotency key is required before creating an external approval."}}));
    };
    let response = call_host(json!({
        "operation":"credential_operation",
        "credentialReference":credential_reference,
        "credentialType":"internal_approval",
        "action":"approval.requests.create",
        "input":{"subject":subject,"details":details,"idempotencyKey":idempotency_key}
    }));
    match response {
        Ok(value) => return_json(json!({"ok":true,"output":value.pointer("/response/value").cloned().unwrap_or(Value::Null)})),
        Err(error) => return_json(json!({"ok":false,"error":{"code":"approval_request_failed","message":error}})),
    }
}

#[no_mangle]
pub unsafe extern "C" fn migrate_v1_to_v2(pointer: i32, length: i32) -> i64 {
    let input = parse(pointer, length);
    let configuration = input.get("configuration").unwrap_or(&input);
    let message = configuration.get("message").and_then(Value::as_str).unwrap_or("Approval request");
    return_json(json!({"configuration":{"subject":message,"details":message,"credentialReference":"internal-approval"},"nodeVersion":2,"migration":"approval-request-v1-v2"}))
}

unsafe fn parse(pointer: i32, length: i32) -> Value {
    let input = std::slice::from_raw_parts(pointer as *const u8, length.max(0) as usize);
    serde_json::from_slice(input).unwrap_or(Value::Null)
}

fn call_host(request: Value) -> Result<Value, String> {
    let request = serde_json::to_vec(&request).map_err(|error| error.to_string())?;
    let mut output = vec![0_u8; 128 * 1024];
    let length = unsafe { host_call(request.as_ptr() as i32, request.len() as i32, output.as_mut_ptr() as i32, output.len() as i32) };
    if length <= 0 { return Err("Host response buffer failed.".into()); }
    output.truncate(length as usize);
    let response: Value = serde_json::from_slice(&output).map_err(|error| error.to_string())?;
    if response.get("ok").and_then(Value::as_bool) != Some(true) {
        return Err(response.pointer("/error/message").and_then(Value::as_str).unwrap_or("Host operation was rejected.").into());
    }
    Ok(response)
}

fn return_json(value: Value) -> i64 {
    let mut output = serde_json::to_vec(&value).unwrap_or_else(|_| b"null".to_vec());
    let pointer = output.as_mut_ptr() as u32;
    let length = output.len() as u32;
    std::mem::forget(output);
    ((pointer as i64) << 32) | length as i64
}
