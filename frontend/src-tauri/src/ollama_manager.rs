use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Duration;
use serde::{Deserialize, Serialize};
use tauri::Manager; 

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/// Which Ollama binary we ended up using.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum OllamaSource {
    System,
    Bundled,
    None,
}

/// Current runtime status of the Ollama process.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum OllamaStatus {
    Running,
    Starting,
    Stopped,
    Failed(String),
}

/// Snapshot exposed to the frontend via Tauri commands.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OllamaState {
    pub source: OllamaSource,
    pub status: OllamaStatus,
    pub origin: String,
    pub port: u16,
    pub model: String,
    pub model_present: bool,
    pub selected_model: String,
    pub embedding_model_present: bool,
    pub inference_model_present: bool,
    pub provisioning_status: String,
    pub last_error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelTier {
    pub model_name: String,
    pub display_name: String,
    pub size: String,
    pub ram_required: u64,
    pub recommended_for: String,
    pub accuracy_rating: String,
    pub speed_rating: String,
}

pub fn get_model_for_specs(ram_gb: u64, has_gpu: bool) -> ModelTier {
   
        ModelTier {
            model_name: "qwen2.5:1.5b".to_string(),
            display_name: "Qwen 2.5 (1.5B) - Basic".to_string(),
            size: "1.2GB".to_string(),
            ram_required: 2,
            recommended_for: "Low-spec devices".to_string(),
            accuracy_rating: "Good (75%)".to_string(),
            speed_rating: "Fast".to_string(),
        }
    
    
}

/// Persisted to `{app_data_dir}/ollama_state.json` for fast subsequent boots.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PersistedState {
    pub last_healthy_at: Option<String>,
    pub source: OllamaSource,
    pub binary_path: Option<String>,
    pub port: u16,
    pub model: String,
    pub model_present: bool,
}

// ---------------------------------------------------------------------------
// Manager
// ---------------------------------------------------------------------------

pub struct OllamaManager {
    /// Process PID -- only set when WE started Ollama.
    managed_pid: Mutex<Option<u32>>,
    /// Resolved source (System | Bundled | None).
    source: Mutex<OllamaSource>,
    /// The base URL we talk to, e.g. `http://127.0.0.1:11434`.
    origin: Mutex<String>,
    /// Which port Ollama is on.
    port: Mutex<u16>,
    /// Path to the binary we resolved (system or bundled).
    binary_path: Mutex<Option<PathBuf>>,
    /// App data directory root.
    app_data_dir: PathBuf,
    pub selected_model: Mutex<String>,
    pub embedding_model_present: Mutex<bool>,
    pub inference_model_present: Mutex<bool>,
    pub provisioning_status: Mutex<String>,
    pub last_error: Mutex<Option<String>>,
}

impl OllamaManager {
    pub fn new(app_data_dir: PathBuf, ram_gb: u64, has_gpu: bool) -> Self {
        let tier = get_model_for_specs(ram_gb, has_gpu);
        let selected_model = tier.model_name;
        Self {
            managed_pid: Mutex::new(None),
            source: Mutex::new(OllamaSource::None),
            origin: Mutex::new(String::new()),
            port: Mutex::new(11434),
            binary_path: Mutex::new(None),
            app_data_dir,
            selected_model: Mutex::new(selected_model),
            embedding_model_present: Mutex::new(false),
            inference_model_present: Mutex::new(false),
            provisioning_status: Mutex::new("Pending initialization".to_string()),
            last_error: Mutex::new(None),
        }
    }

    // -- Accessors ----------------------------------------------------------

    pub fn get_state(&self) -> OllamaState {
        let source = self.source.lock().unwrap().clone();
        let origin = self.origin.lock().unwrap().clone();
        let port = *self.port.lock().unwrap();
        let has_managed = self.managed_pid.lock().unwrap().is_some();
        let selected_model = self.selected_model.lock().unwrap().clone();

        let status = if source == OllamaSource::None {
            OllamaStatus::Stopped
        } else if has_managed || !origin.is_empty() {
            OllamaStatus::Running
        } else {
            OllamaStatus::Stopped
        };

        let embedding_model_present = *self.embedding_model_present.lock().unwrap();
        let inference_model_present = *self.inference_model_present.lock().unwrap();
        let provisioning_status = self.provisioning_status.lock().unwrap().clone();
        let last_error = self.last_error.lock().unwrap().clone();

        OllamaState {
            source,
            status,
            origin,
            port,
            model: selected_model.clone(),
            model_present: inference_model_present,
            selected_model,
            embedding_model_present,
            inference_model_present,
            provisioning_status,
            last_error,
        }
    }

    pub fn origin(&self) -> String {
        self.origin.lock().unwrap().clone()
    }

    pub fn models_dir(&self) -> PathBuf {
        self.app_data_dir.join("ollama").join("models")
    }

    // -- Resolution ---------------------------------------------------------

    /// Find system-installed Ollama binary.
    pub fn find_system_ollama() -> Option<PathBuf> {
        // 1. Try PATH lookup
        let cmd = if cfg!(target_os = "windows") { "where" } else { "which" };
        if let Ok(output) = std::process::Command::new(cmd).arg("ollama").output() {
            if output.status.success() {
                let path_str = String::from_utf8_lossy(&output.stdout)
                    .lines()
                    .next()
                    .unwrap_or("")
                    .trim()
                    .to_string();
                if !path_str.is_empty() {
                    let p = PathBuf::from(&path_str);
                    if p.exists() {
                        log::info!("Found system Ollama via PATH: {}", path_str);
                        return Some(p);
                    }
                }
            }
        }

        // 2. Check well-known locations
        let candidates: Vec<PathBuf> = if cfg!(target_os = "windows") {
            let local_app = std::env::var("LOCALAPPDATA").unwrap_or_default();
            vec![PathBuf::from(local_app).join("Ollama").join("ollama.exe")]
        } else if cfg!(target_os = "macos") {
            vec![
                PathBuf::from("/usr/local/bin/ollama"),
                PathBuf::from("/opt/homebrew/bin/ollama"),
            ]
        } else {
            let home = std::env::var("HOME").unwrap_or_default();
            vec![
                PathBuf::from("/usr/local/bin/ollama"),
                PathBuf::from(format!("{}/.local/bin/ollama", home)),
            ]
        };

        for candidate in candidates {
            if candidate.exists() {
                log::info!("Found system Ollama at known location: {:?}", candidate);
                return Some(candidate);
            }
        }

        log::info!("No system Ollama found");
        None
    }

    // -- Health checks ------------------------------------------------------

    /// Quick ping: GET /api/tags with a short timeout.
    pub async fn quick_check(origin: &str, timeout_secs: u64) -> bool {
        let url = format!("{}/api/tags", origin);
        let client = reqwest::Client::new();
        match client
            .get(&url)
            .timeout(Duration::from_secs(timeout_secs))
            .send()
            .await
        {
            Ok(res) => res.status().is_success(),
            Err(_) => false,
        }
    }

    /// Check whether a specific model is available.
    pub async fn check_model(origin: &str, model_name: &str) -> bool {
        let url = format!("{}/api/tags", origin);
        let client = reqwest::Client::new();
        match client
            .get(&url)
            .timeout(Duration::from_secs(5))
            .send()
            .await
        {
            Ok(res) if res.status().is_success() => {
                if let Ok(body) = res.text().await {
                    // Ollama returns { "models": [ { "name": "llama2:latest", ... } ] }
                    // Simple substring check -- good enough for detecting presence.
                    let base_name = model_name.split(':').next().unwrap_or(model_name);
                    body.contains(base_name)
                } else {
                    false
                }
            }
            _ => false,
        }
    }

    /// Poll health endpoint with retries.
    pub async fn wait_until_healthy(origin: &str, max_attempts: u32, interval_ms: u64) -> bool {
        for i in 0..max_attempts {
            if Self::quick_check(origin, 2).await {
                log::info!("Ollama healthy after {} attempts", i + 1);
                return true;
            }
            tokio::time::sleep(Duration::from_millis(interval_ms)).await;
        }
        false
    }

    pub async fn pull_model(origin: &str, model_name: &str) -> bool {
        log::info!("Pulling model {} from {}", model_name, origin);
        let url = format!("{}/api/pull", origin);
        let client = reqwest::Client::new();
        let payload = serde_json::json!({
            "name": model_name,
            "stream": false
        });

        match client.post(&url)
            .json(&payload)
            .timeout(Duration::from_secs(3600 * 2))
            .send()
            .await 
        {
            Ok(res) => {
                let status = res.status();
                if !status.is_success() {
                    log::warn!("Pull failed with status: {}", status);
                }
                status.is_success()
            },
            Err(e) => {
                log::error!("Pull error: {}", e);
                false
            }
        }
    }

    pub async fn provision_models(&self, origin: &str) {
        *self.provisioning_status.lock().unwrap() = "Checking models".to_string();
        let target_inference = { self.selected_model.lock().unwrap().clone() };
        let embed_model = "nomic-embed-text";
        
        let has_embed = Self::check_model(origin, embed_model).await;
        let has_inf = Self::check_model(origin, &target_inference).await;
        
        *self.embedding_model_present.lock().unwrap() = has_embed;
        *self.inference_model_present.lock().unwrap() = has_inf;

        if !has_embed {
            *self.provisioning_status.lock().unwrap() = format!("Pulling {}", embed_model);
            let ok = Self::pull_model(origin, embed_model).await;
            if ok {
                *self.embedding_model_present.lock().unwrap() = true;
            } else {
                *self.last_error.lock().unwrap() = Some(format!("Failed to pull {}", embed_model));
                *self.provisioning_status.lock().unwrap() = format!("Error pulling {}", embed_model);
                // Continue despite missing embeddings, but mark error
            }
        }

        if !has_inf {
            *self.provisioning_status.lock().unwrap() = format!("Pulling target inference model ({})", target_inference);
            let ok = Self::pull_model(origin, &target_inference).await;
            if ok {
                *self.inference_model_present.lock().unwrap() = true;
            } else {
                log::warn!("Failed to pull target inference model {}, falling back to qwen2.5:3b", target_inference);
                *self.provisioning_status.lock().unwrap() = "Falling back to qwen2.5:3b".to_string();
                let fallback = "qwen2.5:3b";
                let fallback_ok = Self::pull_model(origin, fallback).await;
                if fallback_ok {
                    *self.selected_model.lock().unwrap() = fallback.to_string();
                    *self.inference_model_present.lock().unwrap() = true;
                } else {
                    *self.last_error.lock().unwrap() = Some(format!("Failed to pull fallback {}", fallback));
                    *self.provisioning_status.lock().unwrap() = format!("Error pulling fallback {}", fallback);
                    return;
                }
            }
        }

        *self.provisioning_status.lock().unwrap() = "Ready".to_string();
    }

    // -- Lifecycle ----------------------------------------------------------

    /// Full resolution + start flow. Call once during app setup.
    pub async fn resolve_and_start(&self, app_handle: &tauri::AppHandle) {
        // Load persisted state to help classify correctly
        let persisted_state = self.load_persisted_state();

        // 1. Check if Ollama is already running on default port
        let default_origin = "http://127.0.0.1:11434".to_string();
        if Self::quick_check(&default_origin, 2).await {
            log::info!("Ollama already running on port 11434, identifying source...");
            
            let mut resolved_source = OllamaSource::System; // Default assumption
            
            // Priority 1: Persisted state mapping
            if let Some(state) = &persisted_state {
                if state.port == 11434 {
                    log::info!("Found persisted state matching port 11434, reusing source: {:?}", state.source);
                    resolved_source = state.source.clone();
                }
            } else {
                // Priority 2: PID file means we probably backgrounded a bundled instance earlier
                let pid_path = self.app_data_dir.join("ollama.pid");
                if pid_path.exists() {
                     log::info!("PID file exists, assuming this is a backgrounded Bundled process");
                     resolved_source = OllamaSource::Bundled;
                }
            }

            *self.source.lock().unwrap() = resolved_source;
            *self.origin.lock().unwrap() = default_origin.clone();
            *self.port.lock().unwrap() = 11434;
            self.provision_models(&default_origin).await;
            self.persist_state();
            return;
        }

        // 2. Try system-installed binary
        if let Some(sys_path) = Self::find_system_ollama() {
            log::info!("Attempting to start system Ollama: {:?}", sys_path);
            *self.binary_path.lock().unwrap() = Some(sys_path.clone());

            let port = self.find_available_port(11434);
            if self.start_process(app_handle, &sys_path, port).await {
                *self.source.lock().unwrap() = OllamaSource::System;
                let origin = format!("http://127.0.0.1:{}", port);
                *self.origin.lock().unwrap() = origin.clone();
                *self.port.lock().unwrap() = port;
                log::info!("System Ollama started on port {}", port);
                self.provision_models(&origin).await;
                self.persist_state();
                return;
            }
            log::warn!("Failed to start system Ollama, falling through to bundled");
        }

        // 3. Try bundled binary
        let bundled_path = self.resolve_bundled_path(app_handle);
        if let Some(bundled) = bundled_path {
            if bundled.exists() {
                log::info!("Attempting to start bundled Ollama: {:?}", bundled);
                *self.binary_path.lock().unwrap() = Some(bundled.clone());

                let port = self.find_available_port(11434);
                if self.start_process(app_handle, &bundled, port).await {
                    *self.source.lock().unwrap() = OllamaSource::Bundled;
                    let origin = format!("http://127.0.0.1:{}", port);
                    *self.origin.lock().unwrap() = origin.clone();
                    *self.port.lock().unwrap() = port;
                    log::info!("Bundled Ollama started on port {}", port);
                    self.provision_models(&origin).await;
                    self.persist_state();
                    return;
                }
                log::warn!("Failed to start bundled Ollama");
            } else {
                log::warn!("Bundled Ollama binary not found at {:?}", bundled);
            }
        }

        // 4. Degraded mode
        log::warn!("No Ollama available -- entering degraded mode (AI features disabled)");
        *self.source.lock().unwrap() = OllamaSource::None;
        *self.origin.lock().unwrap() = String::new();
        *self.provisioning_status.lock().unwrap() = "Ollama not available".to_string();
    }

    /// Start Ollama `serve` as a child process.
    async fn start_process(
        &self,
        app_handle: &tauri::AppHandle,
        binary_path: &PathBuf,
        port: u16,
    ) -> bool {
        // Ensure models directory exists
        let models_dir = self.models_dir();
        std::fs::create_dir_all(&models_dir).ok();

        // Ensure the binary is executable on Unix
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            if let Ok(meta) = std::fs::metadata(binary_path) {
                let mut perms = meta.permissions();
                perms.set_mode(0o755);
                std::fs::set_permissions(binary_path, perms).ok();
            }
        }

        let host = format!("127.0.0.1:{}", port);

        // Spawn as a raw OS process (not a Tauri sidecar) since the binary
        // path may be a system-installed location outside the bundle.
        let child_result = std::process::Command::new(binary_path)
            .arg("serve")
            .env("OLLAMA_HOST", &host)
            .env("OLLAMA_MODELS", models_dir.to_string_lossy().to_string())
            .env("OLLAMA_KEEP_ALIVE", "-1")
            .env("OLLAMA_NUM_PARALLEL", "1")
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn();

        match child_result {
            Ok(mut proc) => {
                // Spawn a background thread to drain stdout/stderr so the pipe
                // buffer does not fill up and stall the child.
                if let Some(stdout) = proc.stdout.take() {
                    std::thread::spawn(move || {
                        use std::io::BufRead;
                        let reader = std::io::BufReader::new(stdout);
                        for line in reader.lines() {
                            if let Ok(l) = line {
                                log::info!("[Ollama] {}", l);
                            }
                        }
                    });
                }
                if let Some(stderr) = proc.stderr.take() {
                    std::thread::spawn(move || {
                        use std::io::BufRead;
                        let reader = std::io::BufReader::new(stderr);
                        for line in reader.lines() {
                            if let Ok(l) = line {
                                log::warn!("[Ollama stderr] {}", l);
                            }
                        }
                    });
                }

                // Store the raw process handle for cleanup. We wrap it in our
                // own type inside the Mutex so we can kill it on shutdown.
                // NOTE: We cannot store std::process::Child in a
                //       tauri_plugin_shell CommandChild, so we store it
                //       separately. We reuse the existing Mutex<Option<CommandChild>>
                //       for the Tauri sidecar path only. For the raw process we
                //       need a different holder -- but to keep the diff small we
                //       will convert once we confirm sidecar vs raw. For now we
                //       store the PID and kill via PID on shutdown.
                let pid = proc.id();
                log::info!("Ollama process spawned with PID {}", pid);

                // Wait for it to become healthy
                let origin = format!("http://127.0.0.1:{}", port);
                let healthy = Self::wait_until_healthy(&origin, 20, 500).await;
                if healthy {
                    // We intentionally leak the child handle here. The process
                    // keeps running in the background. On app exit, the OS-level
                    // cleanup or our explicit `stop()` via PID will terminate it.
                    // Store the PID so `stop()` can kill it.
                    *self.managed_pid.lock().unwrap() = Some(pid);
                    // Also store PID to file so stop() can find it after restart.
                    let pid_path = self.app_data_dir.join("ollama.pid");
                    std::fs::write(&pid_path, pid.to_string()).ok();
                    // Keep the process alive by forgetting the handle.
                    std::mem::forget(proc);
                    return true;
                } else {
                    log::warn!("Ollama failed to become healthy within timeout");
                    let _ = proc.kill();
                    let _ = proc.wait();
                    return false;
                }
            }
            Err(e) => {
                log::error!("Failed to spawn Ollama process: {}", e);
                false
            }
        }
    }

    /// Resolve the bundled Ollama binary path using Tauri sidecar conventions.
    fn resolve_bundled_path(&self, app_handle: &tauri::AppHandle) -> Option<PathBuf> {
        // Tauri sidecar resolution: the binary is placed alongside the app.
        // We use the shell plugin sidecar mechanism to locate it.
        // However, since we need to manage env vars and run it manually,
        // we resolve the path and spawn directly.
        let resource_dir = app_handle.path().resource_dir().ok()?;

        let binary_name = if cfg!(target_os = "windows") {
            "ollama.exe"
        } else {
            "ollama"
        };

        // Look in the binaries directory relative to the resource dir
        let path = resource_dir.join("binaries").join(binary_name);
        if path.exists() {
            return Some(path);
        }

        // Also check for Tauri sidecar naming convention
        let target = if cfg!(target_os = "windows") {
            "x86_64-pc-windows-msvc"
        } else if cfg!(target_os = "macos") {
            if cfg!(target_arch = "aarch64") {
                "aarch64-apple-darwin"
            } else {
                "x86_64-apple-darwin"
            }
        } else {
            "x86_64-unknown-linux-gnu"
        };
        let ext = if cfg!(target_os = "windows") { ".exe" } else { "" };
        let sidecar_name = format!("ollama-{}{}", target, ext);
        let sidecar_path = resource_dir.join("binaries").join(&sidecar_name);
        if sidecar_path.exists() {
            return Some(sidecar_path);
        }

        log::warn!("Bundled Ollama not found in {:?}", resource_dir.join("binaries"));
        None
    }

    /// Find an available port starting from the preferred one.
    fn find_available_port(&self, preferred: u16) -> u16 {
        for offset in 0..7 {
            let port = preferred + offset;
            if std::net::TcpListener::bind(format!("127.0.0.1:{}", port)).is_ok() {
                return port;
            }
        }
        // Fallback: let the OS choose
        if let Ok(listener) = std::net::TcpListener::bind("127.0.0.1:0") {
            if let Ok(addr) = listener.local_addr() {
                return addr.port();
            }
        }
        preferred // last resort
    }

    /// Kill the Ollama process if we started it.
    pub fn stop(&self) {
        // Try in-memory PID first
        let pid = self.managed_pid.lock().unwrap().take();

        // Fallback to PID file
        let pid_path = self.app_data_dir.join("ollama.pid");
        let pid = pid.or_else(|| {
            std::fs::read_to_string(&pid_path)
                .ok()
                .and_then(|s| s.trim().parse::<u32>().ok())
        });

        if let Some(pid) = pid {
            log::info!("Stopping Ollama process (PID {})", pid);
            #[cfg(target_os = "windows")]
            {
                let _ = std::process::Command::new("taskkill")
                    .args(["/PID", &pid.to_string(), "/F"])
                    .output();
            }
            #[cfg(not(target_os = "windows"))]
            {
                let _ = std::process::Command::new("kill")
                    .arg(pid.to_string())
                    .output();
            }
        }
        std::fs::remove_file(&pid_path).ok();
    }

    // -- Persistence --------------------------------------------------------

    fn state_file_path(&self) -> PathBuf {
        self.app_data_dir.join("ollama_state.json")
    }

    fn persist_state(&self) {
        let state = PersistedState {
            last_healthy_at: Some(chrono_now_iso()),
            source: self.source.lock().unwrap().clone(),
            binary_path: self.binary_path.lock().unwrap().as_ref().map(|p| p.to_string_lossy().to_string()),
            port: *self.port.lock().unwrap(),
            model: self.selected_model.lock().unwrap().clone(),
            model_present: *self.inference_model_present.lock().unwrap(),
        };
        if let Ok(json) = serde_json::to_string_pretty(&state) {
            std::fs::write(self.state_file_path(), json).ok();
        }
    }

    pub fn load_persisted_state(&self) -> Option<PersistedState> {
        let path = self.state_file_path();
        if path.exists() {
            if let Ok(data) = std::fs::read_to_string(&path) {
                return serde_json::from_str(&data).ok();
            }
        }
        None
    }
}

/// Simple ISO timestamp without pulling in the `chrono` crate.
fn chrono_now_iso() -> String {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    // Good enough for cache invalidation -- not locale-sensitive.
    format!("{}", now)
}
