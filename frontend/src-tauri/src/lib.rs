mod gpu_detector;
mod ollama_manager;
mod sync_timer;

use tauri::{Emitter, Manager, State};
use tauri_plugin_shell::ShellExt;
use tauri_plugin_shell::process::CommandEvent;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri_plugin_deep_link::DeepLinkExt;

// Helper: parse and emit a deep link URL to the main window
fn handle_deep_link_url(app: &tauri::AppHandle, url_str: &str) {
    log::info!("Deep link received: {}", url_str);
    if let Ok(parsed) = url::Url::parse(url_str) {
        let token = parsed
            .query_pairs()
            .find(|(k, _)| k == "desktop_login_token")
            .map(|(_, v)| v.to_string());
        let error_param = parsed
            .query_pairs()
            .find(|(k, _)| k == "error")
            .map(|(_, v)| v.to_string());

        if token.is_some() || error_param.is_some() {
            if let Some(win) = app.get_webview_window("main") {
                let _ = win.show();
                let _ = win.set_focus();
                let _ = win.emit(
                    "deep-link-received",
                    serde_json::json!({ "token": token, "error": error_param }),
                );
            }
        }
    }
}

use gpu_detector::{GpuDetector, GpuInfo};
use ollama_manager::{OllamaManager, OllamaState};

// ---------------------------------------------------------------------------
// App State
// ---------------------------------------------------------------------------

struct AppState {
    backend_port: u16,
    ollama: Arc<OllamaManager>,
    gpu_info: GpuInfo,
    node_child: Mutex<Option<tauri_plugin_shell::process::CommandChild>>,
}

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

#[tauri::command]
fn get_backend_url(state: State<'_, AppState>) -> Result<String, String> {
    Ok(format!("http://localhost:{}", state.backend_port))
}

#[tauri::command]
fn get_ollama_status(state: State<'_, AppState>) -> Result<OllamaState, String> {
    Ok(state.ollama.get_state())
}

#[tauri::command]
fn get_gpu_info(state: State<'_, AppState>) -> Result<GpuInfo, String> {
    Ok(state.gpu_info.clone())
}

#[tauri::command]
async fn restart_ollama(
    state: State<'_, AppState>,
    app_handle: tauri::AppHandle,
) -> Result<OllamaState, String> {
    state.ollama.stop();
    state.ollama.resolve_and_start(&app_handle).await;
    Ok(state.ollama.get_state())
}

#[tauri::command]
async fn set_active_account(state: State<'_, AppState>, account_id: String) -> Result<(), String> {
    let port = state.backend_port;
    let client = reqwest::Client::new();
    let _ = client.post(format!("http://localhost:{}/api/sync/active", port))
        .json(&serde_json::json!({ "accountId": account_id }))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn open_main_window(app_handle: tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app_handle.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
    }
    Ok(())
}

/// Open a URL in the default system browser (not the Tauri webview).
/// Used for the Google OAuth flow so the emty:// redirect is handled
/// by the OS, which can route it back to the Tauri app.
#[tauri::command]
async fn open_in_browser(app_handle: tauri::AppHandle, url: String) -> Result<(), String> {
    app_handle
        .shell()
        .open(&url, None)
        .map_err(|e| e.to_string())
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Single-instance must be registered BEFORE deep-link so Windows deep link
        // clicks are forwarded to the already-running process instead of spawning
        // a new blank window.
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            // Bring the existing main window to front immediately
            if let Some(win) = app.get_webview_window("main") {
                let _ = win.show();
                let _ = win.set_focus();
            }
            // Look for the emty:// URL in the argv passed from the second instance
            for arg in args.iter().skip(1) {
                if arg.starts_with("emty://") {
                    handle_deep_link_url(app, arg);
                    break;
                }
            }
        }))
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            // Register the emty:// URI scheme in the Windows registry so the OS
            // knows to route emty://... URLs back to this app. This is needed in
            // dev mode because the NSIS installer (which normally does this) has
            // not run yet.
            if let Err(e) = app.deep_link().register_all() {
                log::warn!("Failed to register deep link schemes: {}", e);
            }

            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            // ---------------------------------------------------------------
            // Resolve directories
            // ---------------------------------------------------------------
            let app_data_dir = app
                .path()
                .app_data_dir()
                .expect("Failed to resolve app data dir");
            std::fs::create_dir_all(&app_data_dir).ok();

            // Try to use a fixed port (5000) for OAuth redirect matching, fallback to random if used
            let port = 5000;
            // Note: In production we should ensure 5000 is available, or use deep linking.

            // ---------------------------------------------------------------
            // GPU detection (fast, synchronous, informational only)
            // ---------------------------------------------------------------
            let gpu_info = GpuDetector::detect();
            log::info!(
                "GPU detection result: detected={}, name={:?}",
                gpu_info.detected,
                gpu_info.name
            );

            // Fetch RAM size
            let mut sys = sysinfo::System::new_all();
            sys.refresh_memory();
            let ram_gb = sys.total_memory() / (1024 * 1024 * 1024);

            // ---------------------------------------------------------------
            // Ollama Manager -- resolve and start
            // ---------------------------------------------------------------
            let ollama_manager =
                Arc::new(OllamaManager::new(app_data_dir.clone(), ram_gb, gpu_info.acceleration_likely));

            // Start Ollama asynchronously. It runs in parallel with the Node
            // sidecar startup so there is no additional delay.
            let ollama_for_setup = ollama_manager.clone();
            let app_handle_for_ollama = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                ollama_for_setup
                    .resolve_and_start(&app_handle_for_ollama)
                    .await;
            });

            // ---------------------------------------------------------------
            // Spawn the Node sidecar (existing logic, now with OLLAMA_URL)
            // ---------------------------------------------------------------
            // Tauri v2 preserves the directory structure.
            // We'll pass the backend index.js path relative to the runtime resource folder.
            let resource_dir = app.path().resource_dir().unwrap();
            let backend_entry_path = resource_dir
                .join("_up_")
                .join("_up_")
                .join("backend")
                .join("dist")
                .join("index.js");

            // Determine the Ollama URL to pass to the Node backend.
            // On first launch the manager may still be starting, so we use the
            // expected origin. The backend has its own retry logic for Ollama.
            let ollama_url_for_node = {
                let origin = ollama_manager.origin();
                if origin.is_empty() {
                    // Fallback: default Ollama address. The backend already
                    // defaults to this in aiService.ts / embeddingService.ts.
                    "http://127.0.0.1:11434".to_string()
                } else {
                    origin
                }
            };

            let target_model = ollama_manager.selected_model.lock().unwrap().clone();

            let (mut rx, child) = app
                .shell()
                .sidecar("node")
                .expect("Failed to create sidecar command")
                .args([backend_entry_path.to_string_lossy().to_string()])
                .env("TAURI_PORT", port.to_string())
                .env(
                    "TAURI_APP_DATA_DIR",
                    app_data_dir.to_string_lossy().to_string(),
                )
                .env("OLLAMA_URL", &ollama_url_for_node)
                .env("OLLAMA_MODEL", &target_model)
                .spawn()
                .expect("Failed to spawn node sidecar");

            // ---------------------------------------------------------------
            // Manage state
            // ---------------------------------------------------------------
            app.manage(AppState {
                backend_port: port,
                ollama: ollama_manager.clone(),
                gpu_info,
                node_child: Mutex::new(Some(child)),
            });

            tauri::async_runtime::spawn(async move {
                while let Some(event) = rx.recv().await {
                    if let CommandEvent::Stdout(line) = event {
                        println!("[Backend] {}", String::from_utf8_lossy(&line));
                    } else if let CommandEvent::Stderr(line) = event {
                        eprintln!("[Backend Errors] {}", String::from_utf8_lossy(&line));
                    }
                }
            });

            // ---------------------------------------------------------------
            // Poll the backend health endpoint before showing UI
            // ---------------------------------------------------------------
            let client = reqwest::blocking::Client::new();
            let health_url = format!("http://localhost:{}/health", port);

            for _ in 0..30 {
                if let Ok(res) = client.get(&health_url).send() {
                    if res.status().is_success() {
                        log::info!("Backend health check successful.");
                        break;
                    }
                }
                std::thread::sleep(Duration::from_millis(500));
            }

            // ---------------------------------------------------------------
            // Position the widget in the bottom-right corner on startup
            // ---------------------------------------------------------------
            if let Some(widget_win) = app.get_webview_window("widget") {
                if let Ok(Some(monitor)) = widget_win.current_monitor() {
                    let size = monitor.size();
                    let scale = monitor.scale_factor();
                    let physical_width = (340.0 * scale) as u32;
                    let physical_height = (380.0 * scale) as u32;
                    let y = size.height.saturating_sub(physical_height + (60.0 * scale) as u32);
                    let x = size.width.saturating_sub(physical_width + (20.0 * scale) as u32);
                    let _ = widget_win.set_position(tauri::PhysicalPosition::new(x as i32, y as i32));
                }
            }

            // ---------------------------------------------------------------
            // Tray Setup
            // ---------------------------------------------------------------
            let quit_i = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let sync_i = MenuItem::with_id(app, "sync", "Sync Now", true, None::<&str>)?;
            let status_i = MenuItem::with_id(app, "status", "Last synced: —", false, None::<&str>)?;
            let toggle_widget_i = MenuItem::with_id(app, "toggle_widget", "Toggle Widget", true, None::<&str>)?;
            let open_i = MenuItem::with_id(app, "open", "Open Emty", true, None::<&str>)?;
            
            let menu = Menu::with_items(app, &[&open_i, &toggle_widget_i, &status_i, &sync_i, &quit_i])?;
            
            let _tray = TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "quit" => {
                        let state: tauri::State<AppState> = app.state();
                        if let Some(child) = state.node_child.lock().unwrap().take() {
                            let _ = child.kill();
                        }
                        state.ollama.stop();
                        app.exit(0);
                    }
                    "sync" => {
                        let state: tauri::State<AppState> = app.state();
                        let port = state.backend_port;
                        tauri::async_runtime::spawn(async move {
                            let client = reqwest::Client::new();
                            // Use "active" keyword which the backend now resolves via DB
                            let _ = client.post(format!("http://localhost:{}/api/sync/trigger", port))
                                .json(&serde_json::json!({ "accountId": "active", "mode": "urgent" }))
                                .send()
                                .await;
                        });
                    }
                    "open" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    "toggle_widget" => {
                        if let Some(window) = app.get_webview_window("widget") {
                            if window.is_visible().unwrap_or(false) {
                                let _ = window.hide();
                            } else {
                                if let Ok(Some(monitor)) = window.current_monitor() {
                                    let size = monitor.size();
                                    let scale = monitor.scale_factor();
                                    let physical_width = (340.0 * scale) as u32;
                                    let physical_height = (380.0 * scale) as u32;
                                    let y = size.height.saturating_sub(physical_height + (50.0 * scale) as u32);
                                    let x = size.width.saturating_sub(physical_width + (20.0 * scale) as u32);
                                    let _ = window.set_position(tauri::PhysicalPosition::new(x as i32, y as i32));
                                }
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                        }
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                })
                .build(app)?;

            // ---------------------------------------------------------------
            // Deep Link handler — cold start: the app was not running when
            // emty://auth?... was clicked. For the hot path (app already open),
            // the single-instance callback above handles it instead.
            // ---------------------------------------------------------------
            let deep_link_handle = app.handle().clone();
            app.deep_link().on_open_url(move |event| {
                for url in event.urls() {
                    handle_deep_link_url(&deep_link_handle, &url.to_string());
                }
            });

            // ---------------------------------------------------------------
            // Background Sync Timer & Launch Check
            // ---------------------------------------------------------------
            let app_handle = app.handle().clone();
            sync_timer::check_on_launch(app_handle.clone(), port);
            sync_timer::start_sync_timer(app_handle, port);

            Ok(())
        })
        .on_window_event(|window, event| {
            match event {
                tauri::WindowEvent::CloseRequested { api, .. } => {
                    api.prevent_close();
                    let _ = window.hide();
                }
                tauri::WindowEvent::Destroyed => {
                    if let Some(state) = window.try_state::<AppState>() {
                        log::info!("App window closing - stopping managed Ollama process");
                        state.ollama.stop();
                    }
                }
                _ => {}
            }
        })
        .invoke_handler(tauri::generate_handler![
            get_backend_url,
            get_ollama_status,
            get_gpu_info,
            restart_ollama,
            set_active_account,
            open_main_window,
            open_in_browser
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| match event {
            tauri::RunEvent::Exit => {
                let state: tauri::State<AppState> = app_handle.state();
                if let Some(child) = state.node_child.lock().unwrap().take() {
                    let _ = child.kill();
                }
                state.ollama.stop();
            }
            _ => {}
        });
}
