use tauri::{Manager, State};
use tauri_plugin_shell::ShellExt;
use tauri_plugin_shell::process::CommandEvent;
use std::time::Duration;

struct AppState {
    backend_port: u16,
}

#[tauri::command]
fn get_backend_url(state: State<'_, AppState>) -> Result<String, String> {
    Ok(format!("http://localhost:{}", state.backend_port))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            // Try to use a fixed port (5000) for OAuth redirect matching, fallback to random if used
            let port = 5000;
            // Note: In production we should ensure 5000 is available, or use deep linking.
            app.manage(AppState { backend_port: port });

            let app_data_dir = app.path().app_data_dir().expect("Failed to resolve app data dir");
            std::fs::create_dir_all(&app_data_dir).ok();

            // Tauri v2 preserves the directory structure. 
            // We'll pass the backend index.js path relative to the runtime resource folder.
            let resource_dir = app.path().resource_dir().unwrap();
            let backend_entry_path = resource_dir.join("_up_").join("_up_").join("backend").join("dist").join("index.js");

            // Spawn the Node sidecar
            let (mut rx, _child) = app
                .shell()
                .sidecar("node")
                .expect("Failed to create sidecar command")
                .args([backend_entry_path.to_string_lossy().to_string()])
                .env("TAURI_PORT", port.to_string())
                .env("TAURI_APP_DATA_DIR", app_data_dir.to_string_lossy().to_string())
                .spawn()
                .expect("Failed to spawn node sidecar");
            
            tauri::async_runtime::spawn(async move {
                while let Some(event) = rx.recv().await {
                    if let CommandEvent::Stdout(line) = event {
                        println!("[Backend] {}", String::from_utf8_lossy(&line));
                    } else if let CommandEvent::Stderr(line) = event {
                        eprintln!("[Backend Errors] {}", String::from_utf8_lossy(&line));
                    }
                }
            });

            // Poll the backend health endpoint before showing UI
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

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![get_backend_url])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
