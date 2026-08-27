use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
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
    let input = std::slice::from_raw_parts(pointer as *const u8, length.max(0) as usize);
    let input: Value = match serde_json::from_slice(input) {
        Ok(value) => value,
        Err(error) => return return_json(json!({"ok":false,"error":{"code":"invalid_input","message":error.to_string()}})),
    };
    let configuration = input.get("configuration").unwrap_or(&input);
    let Some(latitude) = configuration.get("latitude").and_then(Value::as_f64) else {
        return return_json(json!({"ok":false,"error":{"code":"invalid_configuration","message":"latitude is required"}}));
    };
    let Some(longitude) = configuration.get("longitude").and_then(Value::as_f64) else {
        return return_json(json!({"ok":false,"error":{"code":"invalid_configuration","message":"longitude is required"}}));
    };
    let units = configuration.get("units").and_then(Value::as_str).unwrap_or("celsius");
    let url = format!("https://api.open-meteo.com/v1/forecast?latitude={latitude}&longitude={longitude}&current_weather=true&temperature_unit={units}");
    let response = match call_host(json!({"operation":"http_request","url":url,"method":"get","headers":{},"timeoutMs":10000})) {
        Ok(value) => value,
        Err(error) => return return_json(json!({"ok":false,"error":{"code":"weather_request_failed","message":error}})),
    };
    let body = response.pointer("/response/value/bodyBase64").and_then(Value::as_str).and_then(|value| BASE64.decode(value).ok());
    let weather: Value = match body.and_then(|value| serde_json::from_slice(&value).ok()) {
        Some(value) => value,
        None => return return_json(json!({"ok":false,"error":{"code":"invalid_provider_response","message":"Weather provider returned invalid JSON"}})),
    };
    let current = weather.get("current_weather").cloned().unwrap_or(Value::Null);
    return_json(json!({"ok":true,"output":{"temperature":current.get("temperature"),"windspeed":current.get("windspeed"),"weathercode":current.get("weathercode"),"units":units}}))
}

fn call_host(request: Value) -> Result<Value, String> {
    let request = serde_json::to_vec(&request).map_err(|error| error.to_string())?;
    let mut output = vec![0_u8; 128 * 1024];
    let length = unsafe { host_call(request.as_ptr() as i32, request.len() as i32, output.as_mut_ptr() as i32, output.len() as i32) };
    if length <= 0 { return Err("Host response buffer failed.".into()); }
    output.truncate(length as usize);
    let response: Value = serde_json::from_slice(&output).map_err(|error| error.to_string())?;
    if response.get("ok").and_then(Value::as_bool) != Some(true) {
        return Err(response.pointer("/error/message").and_then(Value::as_str).unwrap_or("Host request was rejected.").into());
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
