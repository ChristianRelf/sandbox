use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{path::PathBuf, sync::Arc};
use tauri::{AppHandle, Manager};
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
    process::{Child, ChildStdin, ChildStdout, Command},
    sync::{Mutex, RwLock},
};
use uuid::Uuid;

const PROTOCOL_VERSION: u32 = 1;
const EXPECTED_SIDECAR_VERSION: &str = "0.2.0";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserEngineStatus {
    pub available: bool,
    pub protocol_version: u32,
    pub sidecar_version: Option<String>,
    pub browser_name: Option<String>,
    pub browser_version: Option<String>,
    pub error: Option<String>,
}

impl Default for BrowserEngineStatus {
    fn default() -> Self {
        Self {
            available: false,
            protocol_version: PROTOCOL_VERSION,
            sidecar_version: None,
            browser_name: None,
            browser_version: None,
            error: Some("The managed browser engine has not started yet.".into()),
        }
    }
}

#[derive(Clone)]
pub struct BrowserSidecar {
    inner: Arc<Mutex<SidecarProcess>>,
    status: Arc<RwLock<BrowserEngineStatus>>,
    root: PathBuf,
    token: String,
}

struct SidecarProcess {
    child: Option<Child>,
    stdin: Option<ChildStdin>,
    stdout: Option<BufReader<ChildStdout>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SidecarRequest<'a> {
    id: String,
    token: &'a str,
    protocol_version: u32,
    operation: &'a str,
    payload: Value,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SidecarResponse {
    id: String,
    protocol_version: u32,
    sidecar_version: String,
    ok: bool,
    result: Option<Value>,
    error: Option<SidecarError>,
}

#[derive(Deserialize)]
struct SidecarError {
    code: String,
    message: String,
    details: Option<Value>,
}

impl BrowserSidecar {
    pub fn new(app: &AppHandle) -> Result<Self, String> {
        let root = if cfg!(debug_assertions) {
            PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .parent()
                .ok_or_else(|| "Could not resolve the browser-sidecar directory.".to_string())?
                .join("browser-sidecar")
        } else {
            app.path()
                .resource_dir()
                .map_err(|error| error.to_string())?
                .join("browser-sidecar")
        };
        Ok(Self {
            inner: Arc::new(Mutex::new(SidecarProcess {
                child: None,
                stdin: None,
                stdout: None,
            })),
            status: Arc::new(RwLock::new(BrowserEngineStatus::default())),
            root,
            token: format!("{}{}", Uuid::new_v4().simple(), Uuid::new_v4().simple()),
        })
    }

    pub async fn verify(&self) -> Result<BrowserEngineStatus, String> {
        match self.request("hello", json!({})).await {
            Ok(result) => {
                let sidecar_version = result
                    .get("sidecarVersion")
                    .and_then(Value::as_str)
                    .unwrap_or_default();
                if sidecar_version != EXPECTED_SIDECAR_VERSION {
                    let error = format!(
                        "Browser sidecar version {sidecar_version} does not match application version {EXPECTED_SIDECAR_VERSION}."
                    );
                    self.set_error(error.clone()).await;
                    return Err(error);
                }
                let status = BrowserEngineStatus {
                    available: true,
                    protocol_version: PROTOCOL_VERSION,
                    sidecar_version: Some(sidecar_version.into()),
                    browser_name: result
                        .get("browserName")
                        .and_then(Value::as_str)
                        .map(str::to_string),
                    browser_version: result
                        .get("browserVersion")
                        .and_then(Value::as_str)
                        .map(str::to_string),
                    error: None,
                };
                *self.status.write().await = status.clone();
                Ok(status)
            }
            Err(error) => {
                self.set_error(error.clone()).await;
                Err(error)
            }
        }
    }

    pub async fn status(&self) -> BrowserEngineStatus {
        self.status.read().await.clone()
    }

    pub async fn request(&self, operation: &str, payload: Value) -> Result<Value, String> {
        let mut process = self.inner.lock().await;
        if process.child.is_none() {
            self.start_locked(&mut process).await?;
        }
        let response = self.send_locked(&mut process, operation, payload).await;
        if response.is_err() {
            self.stop_locked(&mut process).await;
        }
        response
    }

    pub async fn restart(&self) -> Result<BrowserEngineStatus, String> {
        let mut process = self.inner.lock().await;
        self.stop_locked(&mut process).await;
        drop(process);
        self.verify().await
    }

    pub async fn shutdown(&self) {
        let mut process = self.inner.lock().await;
        if process.child.is_some() {
            let _ = self.send_locked(&mut process, "close_all", json!({})).await;
        }
        self.stop_locked(&mut process).await;
    }

    async fn start_locked(&self, process: &mut SidecarProcess) -> Result<(), String> {
        let node = self
            .root
            .join("runtime")
            .join(if cfg!(windows) { "node.exe" } else { "node" });
        let script = self.root.join("dist").join("server.js");
        let browsers = self.root.join("browsers");
        for (label, path) in [
            ("Node runtime", &node),
            ("sidecar script", &script),
            ("managed browser", &browsers),
        ] {
            if !path.exists() {
                return Err(format!("Browser engine unavailable: {label} was not packaged at '{}'. Run npm.cmd run browser:prepare before building.", path.display()));
            }
        }
        let mut child = Command::new(&node)
            .arg(&script)
            .current_dir(&self.root)
            .env("SANDBOX_IPC_TOKEN", &self.token)
            .env("PLAYWRIGHT_BROWSERS_PATH", &browsers)
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .kill_on_drop(true)
            .spawn()
            .map_err(|error| format!("Browser engine could not start: {error}"))?;
        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| "Browser engine stdin was unavailable.".to_string())?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| "Browser engine stdout was unavailable.".to_string())?;
        if let Some(stderr) = child.stderr.take() {
            tauri::async_runtime::spawn(async move {
                let mut lines = BufReader::new(stderr).lines();
                while let Ok(Some(line)) = lines.next_line().await {
                    eprintln!("browser-sidecar: {line}");
                }
            });
        }
        process.child = Some(child);
        process.stdin = Some(stdin);
        process.stdout = Some(BufReader::new(stdout));
        Ok(())
    }

    async fn send_locked(
        &self,
        process: &mut SidecarProcess,
        operation: &str,
        payload: Value,
    ) -> Result<Value, String> {
        let id = Uuid::new_v4().to_string();
        let request = SidecarRequest {
            id: id.clone(),
            token: &self.token,
            protocol_version: PROTOCOL_VERSION,
            operation,
            payload,
        };
        let line = serde_json::to_string(&request).map_err(|error| error.to_string())?;
        let stdin = process
            .stdin
            .as_mut()
            .ok_or_else(|| "Browser engine stdin is closed.".to_string())?;
        stdin
            .write_all(line.as_bytes())
            .await
            .map_err(|error| format!("Browser engine request failed: {error}"))?;
        stdin
            .write_all(b"\n")
            .await
            .map_err(|error| error.to_string())?;
        stdin.flush().await.map_err(|error| error.to_string())?;
        let stdout = process
            .stdout
            .as_mut()
            .ok_or_else(|| "Browser engine stdout is closed.".to_string())?;
        loop {
            let mut line = String::new();
            if stdout
                .read_line(&mut line)
                .await
                .map_err(|error| error.to_string())?
                == 0
            {
                return Err("Browser engine stopped before responding.".into());
            }
            let response: SidecarResponse = serde_json::from_str(&line)
                .map_err(|error| format!("Browser engine returned invalid data: {error}"))?;
            if response.id != id {
                continue;
            }
            if response.protocol_version != PROTOCOL_VERSION
                || response.sidecar_version != EXPECTED_SIDECAR_VERSION
            {
                return Err("Browser engine protocol or version mismatch.".into());
            }
            if response.ok {
                return Ok(response.result.unwrap_or(Value::Null));
            }
            let error = response.error.unwrap_or(SidecarError {
                code: "browser_operation_failed".into(),
                message: "Browser operation failed without details.".into(),
                details: None,
            });
            return Err(serde_json::to_string(
                &json!({"code":error.code,"message":error.message,"details":error.details}),
            )
            .unwrap_or(error.message));
        }
    }

    async fn stop_locked(&self, process: &mut SidecarProcess) {
        process.stdin.take();
        process.stdout.take();
        if let Some(mut child) = process.child.take() {
            let _ = child.kill().await;
            let _ = child.wait().await;
        }
    }

    async fn set_error(&self, error: String) {
        *self.status.write().await = BrowserEngineStatus {
            error: Some(error),
            ..BrowserEngineStatus::default()
        };
    }
}
