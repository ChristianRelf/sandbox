use crate::{CapabilityBroker, ExecutionContext, HostRequest, PluginError};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    sync::{mpsc, Arc},
    time::{Duration, Instant},
};
use wasmtime::{
    Caller, Config, Engine, ExternType, Linker, Module, Store, StoreLimits, StoreLimitsBuilder,
};

const MAX_INPUT_BYTES: usize = 1024 * 1024;
const MAX_OUTPUT_BYTES: usize = 1024 * 1024;
const MAX_HOST_RESPONSE_BYTES: usize = 2 * 1024 * 1024;

#[derive(Debug, Clone)]
pub struct RuntimeLimits {
    pub memory_bytes: usize,
    pub fuel: u64,
    pub timeout: Duration,
}

impl Default for RuntimeLimits {
    fn default() -> Self {
        Self {
            memory_bytes: 32 * 1024 * 1024,
            fuel: 25_000_000,
            timeout: Duration::from_secs(30),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SandboxDiagnostic {
    pub code: String,
    pub message: String,
}

struct StoreState {
    limits: StoreLimits,
    broker: Arc<CapabilityBroker>,
    context: ExecutionContext,
    diagnostics: Vec<SandboxDiagnostic>,
}

pub struct PluginRuntime {
    engine: Engine,
    limits: RuntimeLimits,
}

impl PluginRuntime {
    pub fn new(limits: RuntimeLimits) -> Result<Self, PluginError> {
        let mut config = Config::new();
        config.consume_fuel(true);
        config.epoch_interruption(true);
        let engine =
            Engine::new(&config).map_err(|error| PluginError::Sandbox(error.to_string()))?;
        Ok(Self { engine, limits })
    }

    pub fn execute(
        &self,
        wasm: &[u8],
        export: &str,
        input: &Value,
        broker: Arc<CapabilityBroker>,
        context: ExecutionContext,
    ) -> Result<(Value, Vec<SandboxDiagnostic>), PluginError> {
        if context
            .cancellation
            .load(std::sync::atomic::Ordering::SeqCst)
        {
            return Err(PluginError::Cancelled);
        }
        let input =
            serde_json::to_vec(input).map_err(|error| PluginError::Sandbox(error.to_string()))?;
        if input.len() > MAX_INPUT_BYTES {
            return Err(PluginError::ResourceLimit("Input exceeds 1 MB.".into()));
        }
        let module = Module::new(&self.engine, wasm).map_err(|error| {
            PluginError::Sandbox(format!("WebAssembly compilation failed: {error}"))
        })?;
        validate_imports(&module)?;
        let state = StoreState {
            limits: StoreLimitsBuilder::new()
                .memory_size(self.limits.memory_bytes)
                .instances(1)
                .memories(1)
                .tables(2)
                .trap_on_grow_failure(true)
                .build(),
            broker,
            context: context.clone(),
            diagnostics: vec![],
        };
        let mut store = Store::new(&self.engine, state);
        store.limiter(|state| &mut state.limits);
        store
            .set_fuel(self.limits.fuel)
            .map_err(|error| PluginError::Sandbox(error.to_string()))?;
        store.set_epoch_deadline(1);
        let mut linker = Linker::new(&self.engine);
        linker
            .func_wrap("sandbox_v1", "host_call", host_call)
            .map_err(|error| PluginError::Sandbox(error.to_string()))?;
        let instance = linker.instantiate(&mut store, &module).map_err(|error| {
            classify_trap("WebAssembly instantiation failed", &format!("{error:?}"))
        })?;
        let memory = instance.get_memory(&mut store, "memory").ok_or_else(|| {
            PluginError::Sandbox("Plugin must export linear memory as 'memory'.".into())
        })?;
        let allocate = instance
            .get_typed_func::<i32, i32>(&mut store, "alloc")
            .map_err(|_| PluginError::Sandbox("Plugin must export alloc(i32) -> i32.".into()))?;
        let execute = instance
            .get_typed_func::<(i32, i32), i64>(&mut store, export)
            .map_err(|_| {
                PluginError::Sandbox(format!("Plugin must export {export}(i32, i32) -> i64."))
            })?;
        let pointer = allocate
            .call(&mut store, input.len() as i32)
            .map_err(|error| {
                classify_trap("Plugin input allocation failed", &format!("{error:?}"))
            })?;
        memory
            .write(&mut store, checked_range(pointer, input.len())?, &input)
            .map_err(|error| {
                PluginError::Sandbox(format!("Plugin input memory is invalid: {error}"))
            })?;

        let (stop_tx, stop_rx) = mpsc::channel();
        let engine = self.engine.clone();
        let timeout = self.limits.timeout;
        let cancelled = context.cancellation.clone();
        let timer = std::thread::spawn(move || {
            let started = Instant::now();
            loop {
                if stop_rx.try_recv().is_ok() {
                    return;
                }
                if cancelled.load(std::sync::atomic::Ordering::SeqCst)
                    || started.elapsed() >= timeout
                {
                    engine.increment_epoch();
                    return;
                }
                std::thread::sleep(Duration::from_millis(5));
            }
        });
        let call_result = execute.call(&mut store, (pointer, input.len() as i32));
        let _ = stop_tx.send(());
        let _ = timer.join();
        let packed = call_result.map_err(|error| {
            if context
                .cancellation
                .load(std::sync::atomic::Ordering::SeqCst)
            {
                PluginError::Cancelled
            } else {
                classify_trap("Plugin execution trapped", &format!("{error:?}"))
            }
        })?;
        let output_pointer = ((packed as u64) >> 32) as i32;
        let output_length = (packed as u64 & 0xffff_ffff) as usize;
        if output_length > MAX_OUTPUT_BYTES {
            return Err(PluginError::ResourceLimit("Output exceeds 1 MB.".into()));
        }
        let mut output = vec![0; output_length];
        memory
            .read(
                &store,
                checked_range(output_pointer, output_length)?,
                &mut output,
            )
            .map_err(|error| {
                PluginError::Sandbox(format!("Plugin output memory is invalid: {error}"))
            })?;
        let value = serde_json::from_slice(&output).map_err(|error| {
            PluginError::Sandbox(format!("Plugin output is not valid JSON: {error}"))
        })?;
        Ok((value, store.data().diagnostics.clone()))
    }
}

fn validate_imports(module: &Module) -> Result<(), PluginError> {
    for import in module.imports() {
        if import.module() != "sandbox_v1"
            || import.name() != "host_call"
            || !matches!(import.ty(), ExternType::Func(_))
        {
            return Err(PluginError::Permission(format!("Ambient import '{}::{}' is denied. Plugins receive no WASI, filesystem, process, environment, socket, or desktop IPC imports.", import.module(), import.name())));
        }
    }
    Ok(())
}

fn host_call(
    mut caller: Caller<'_, StoreState>,
    request_pointer: i32,
    request_length: i32,
    output_pointer: i32,
    output_capacity: i32,
) -> i32 {
    let result = (|| -> Result<Vec<u8>, PluginError> {
        if request_length < 0 || request_length as usize > MAX_INPUT_BYTES || output_capacity < 0 {
            return Err(PluginError::ResourceLimit(
                "Host call buffer exceeds its limit.".into(),
            ));
        }
        let memory = caller
            .get_export("memory")
            .and_then(|value| value.into_memory())
            .ok_or_else(|| {
                PluginError::Sandbox("Plugin memory is unavailable during host call.".into())
            })?;
        let mut request = vec![0; request_length as usize];
        memory
            .read(
                &caller,
                checked_range(request_pointer, request.len())?,
                &mut request,
            )
            .map_err(|error| {
                PluginError::Sandbox(format!("Host call request memory is invalid: {error}"))
            })?;
        let request: HostRequest = serde_json::from_slice(&request)
            .map_err(|error| PluginError::Host(format!("Host request is invalid: {error}")))?;
        let response = caller
            .data()
            .broker
            .invoke(&caller.data().context, request)?;
        caller
            .data_mut()
            .diagnostics
            .extend(
                response
                    .diagnostics
                    .iter()
                    .map(|message| SandboxDiagnostic {
                        code: "host_call".into(),
                        message: message.clone(),
                    }),
            );
        serde_json::to_vec(&json!({"ok":true,"response":response}))
            .map_err(|error| PluginError::Host(error.to_string()))
    })();
    let encoded = match result {
        Ok(encoded) => encoded,
        Err(error) => {
            serde_json::to_vec(&json!({"ok":false,"error":{"message":error.to_string()}}))
                .unwrap_or_default()
        }
    };
    if encoded.len() > MAX_HOST_RESPONSE_BYTES {
        return -1;
    }
    if encoded.len() > output_capacity as usize {
        return -(encoded.len() as i32);
    }
    let Some(memory) = caller
        .get_export("memory")
        .and_then(|value| value.into_memory())
    else {
        return -1;
    };
    if memory
        .write(
            &mut caller,
            match checked_range(output_pointer, encoded.len()) {
                Ok(value) => value,
                Err(_) => return -1,
            },
            &encoded,
        )
        .is_err()
    {
        return -1;
    }
    encoded.len() as i32
}

fn checked_range(pointer: i32, length: usize) -> Result<usize, PluginError> {
    if pointer < 0 || (pointer as usize).checked_add(length).is_none() {
        Err(PluginError::Sandbox(
            "Plugin supplied an invalid memory range.".into(),
        ))
    } else {
        Ok(pointer as usize)
    }
}

fn classify_trap(context: &str, message: &str) -> PluginError {
    let lower = message.to_ascii_lowercase();
    if lower.contains("fuel")
        || lower.contains("epoch")
        || lower.contains("interrupt")
        || lower.contains("resource limit")
        || lower.contains("memory")
    {
        PluginError::ResourceLimit(format!("{context}: {message}"))
    } else {
        PluginError::Sandbox(format!("{context}: {message}"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::manifest::tests::manifest;
    use crate::{
        CredentialOperationBroker, HttpRequest, HttpResponse, InMemoryPluginStorage,
        NetworkTransport,
    };

    struct NoNetwork;
    impl NetworkTransport for NoNetwork {
        fn send(&self, _request: &HttpRequest) -> Result<HttpResponse, PluginError> {
            panic!("network should not be called")
        }
    }
    struct NoCredentials;
    impl CredentialOperationBroker for NoCredentials {
        fn execute(&self, _: &str, _: &str, _: &str, _: &Value) -> Result<Value, PluginError> {
            panic!("credentials should not be called")
        }
    }
    fn broker() -> Arc<CapabilityBroker> {
        Arc::new(CapabilityBroker::new(
            Arc::new(NoNetwork),
            Arc::new(NoCredentials),
            Arc::new(InMemoryPluginStorage::default()),
        ))
    }
    fn context() -> ExecutionContext {
        let mut context = ExecutionContext::from_manifest(&manifest(), "run", "node");
        context.approved_capabilities.insert("time".into());
        context
    }
    fn runtime() -> PluginRuntime {
        PluginRuntime::new(RuntimeLimits {
            memory_bytes: 2 * 1024 * 1024,
            fuel: 100_000,
            timeout: Duration::from_millis(500),
        })
        .unwrap()
    }

    #[test]
    fn executes_json_abi_and_host_call() {
        let request = r#"{"operation":"time"}"#;
        let wat = format!(
            r#"(module
          (import "sandbox_v1" "host_call" (func $host (param i32 i32 i32 i32) (result i32)))
          (memory (export "memory") 2)
          (global $heap (mut i32) (i32.const 8192))
          (data (i32.const 1024) "{}")
          (func (export "alloc") (param $length i32) (result i32)
            (local $pointer i32)
            global.get $heap local.set $pointer
            global.get $heap local.get $length i32.add global.set $heap
            local.get $pointer)
          (func (export "execute") (param i32 i32) (result i64)
            (local $length i32)
            i32.const 1024 i32.const {} i32.const 2048 i32.const 4096 call $host local.set $length
            i32.const 2048 i64.extend_i32_u i64.const 32 i64.shl
            local.get $length i64.extend_i32_u i64.or))"#,
            escape_wat(request),
            request.len()
        );
        let (output, _) = runtime()
            .execute(wat.as_bytes(), "execute", &json!({}), broker(), context())
            .unwrap();
        assert_eq!(output["ok"], true);
        assert!(output["response"]["value"]["unixTimeMs"].as_u64().is_some());
    }

    #[test]
    fn denies_files_processes_sockets_and_environment_by_missing_import() {
        for (module, name) in [
            ("wasi_snapshot_preview1", "fd_read"),
            ("wasi_snapshot_preview1", "proc_exit"),
            ("wasi_snapshot_preview1", "sock_open"),
            ("wasi_snapshot_preview1", "environ_get"),
            ("tauri", "invoke"),
        ] {
            let wat = format!(
                r#"(module (import "{module}" "{name}" (func)) (memory (export "memory") 1) (func (export "alloc") (param i32) (result i32) i32.const 0) (func (export "execute") (param i32 i32) (result i64) i64.const 0))"#
            );
            let error = runtime()
                .execute(wat.as_bytes(), "execute", &json!({}), broker(), context())
                .unwrap_err();
            assert!(error.to_string().contains("Ambient import"), "{error}");
        }
    }

    #[test]
    fn enforces_memory_fuel_timeout_and_cancellation() {
        let memory = r#"(module (memory (export "memory") 64) (func (export "alloc") (param i32) (result i32) i32.const 0) (func (export "execute") (param i32 i32) (result i64) i64.const 0))"#;
        assert!(runtime()
            .execute(
                memory.as_bytes(),
                "execute",
                &json!({}),
                broker(),
                context()
            )
            .unwrap_err()
            .to_string()
            .contains("resource limit"));
        let loop_wat = r#"(module (memory (export "memory") 1) (func (export "alloc") (param i32) (result i32) i32.const 0) (func (export "execute") (param i32 i32) (result i64) (loop $forever br $forever) i64.const 0))"#;
        let exhausted = runtime().execute(
            loop_wat.as_bytes(),
            "execute",
            &json!({}),
            broker(),
            context(),
        );
        assert!(
            matches!(exhausted, Err(PluginError::ResourceLimit(_))),
            "{exhausted:?}"
        );
        let cancelled = context();
        cancelled
            .cancellation
            .store(true, std::sync::atomic::Ordering::SeqCst);
        assert!(matches!(
            runtime().execute(
                loop_wat.as_bytes(),
                "execute",
                &json!({}),
                broker(),
                cancelled
            ),
            Err(PluginError::Cancelled)
        ));
    }

    fn escape_wat(value: &str) -> String {
        value
            .bytes()
            .map(|byte| match byte {
                b'"' => "\\22".into(),
                b'\\' => "\\5c".into(),
                0x20..=0x7e => (byte as char).to_string(),
                _ => format!("\\{byte:02x}"),
            })
            .collect()
    }
}
