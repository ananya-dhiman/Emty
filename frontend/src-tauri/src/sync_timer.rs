use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::sync::{Arc, Mutex};
use std::fs;
use tauri_plugin_notification::NotificationExt;
use tauri::Manager;

#[derive(Deserialize, Debug)]
struct PendingNotificationsResponse {
    success: bool,
    notifications: Vec<NotificationItem>,
}

#[derive(Deserialize, Debug)]
struct NotificationItem {
    id: String,
    title: String,
    body: String,
}
#[derive(Deserialize, Debug)]
pub struct SyncState {
    pub sync_state: String,
    pub last_sync_timestamp: Option<u64>,
    pub sync_interval_minutes: Option<u64>,
    pub account_id: Option<String>,
}

#[derive(Serialize, Clone)]
struct CatchupPayload {
    gap_days: u64,
    account_id: String,
}

fn unix_now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis() as u64
}

fn format_gap(gap_ms: u64) -> String {
    let secs = gap_ms / 1000;
    if secs < 60 {
        return "Just now".to_string();
    }
    let mins = secs / 60;
    if mins < 60 {
        return format!("{}m ago", mins);
    }
    let hours = mins / 60;
    if hours < 24 {
        return format!("{}h ago", hours);
    }
    let days = hours / 24;
    format!("{}d ago", days)
}

async fn fetch_active_sync_state(port: u16) -> Option<SyncState> {
    let client = reqwest::Client::new();
    let res = client
        .get(format!("http://localhost:{}/api/sync/state/active", port))
        .send()
        .await
        .ok()?;

    if res.status().is_success() {
        res.json::<SyncState>().await.ok()
    } else {
        None
    }
}

async fn trigger_sync(port: u16, account_id: &str, mode: &str) {
    let client = reqwest::Client::new();
    let _ = client
        .post(format!("http://localhost:{}/api/sync/trigger", port))
        .json(&serde_json::json!({ "accountId": account_id, "mode": mode }))
        .send()
        .await;
}

fn update_tray_tooltip(app_handle: &AppHandle, gap_ms: u64) {
    let gap_human = format_gap(gap_ms);
    let _ = app_handle.tray_by_id("main").map(|tray| {
        let _ = tray.set_tooltip(Some(format!("Last synced: {}", gap_human)));
    });
}

pub fn check_on_launch(app_handle: AppHandle, port: u16) {
    tauri::async_runtime::spawn(async move {
        // Query the backend for the persistently active account
        if let Some(state) = fetch_active_sync_state(port).await {
            if let (Some(last_sync), Some(aid)) = (state.last_sync_timestamp, state.account_id) {
                let gap_ms = unix_now_ms().saturating_sub(last_sync);
                let gap_days = gap_ms / (24 * 60 * 60 * 1000);

                // Update tray tooltip immediately on launch
                update_tray_tooltip(&app_handle, gap_ms);

                if gap_days >= 7 {
                    let _ = app_handle.emit("show_catchup_dialog", CatchupPayload {
                        gap_days,
                        account_id: aid.clone(),
                    });
                } else {
                    let interval_minutes = state.sync_interval_minutes.unwrap_or(180);
                    let interval_ms = interval_minutes * 60 * 1000;

                    if gap_ms > interval_ms || state.sync_state == "error" {
                        trigger_sync(port, &aid, "urgent").await;
                    }
                }
            }
        }
    });
}

pub fn start_sync_timer(app_handle: AppHandle, port: u16) {
    tauri::async_runtime::spawn(async move {
        let mut ticker = tokio::time::interval(std::time::Duration::from_secs(600)); // 10 minutes

        loop {
            ticker.tick().await;

            if let Some(state) = fetch_active_sync_state(port).await {
                if state.sync_state == "in_progress" || state.sync_state == "syncing" {
                    continue;
                }

                if let (Some(last_sync), Some(aid)) = (state.last_sync_timestamp, state.account_id) {
                    let gap_ms = unix_now_ms().saturating_sub(last_sync);
                    let interval_ms = state.sync_interval_minutes.unwrap_or(180) * 60 * 1000;

                    update_tray_tooltip(&app_handle, gap_ms);

                    if gap_ms >= interval_ms {
                        trigger_sync(port, &aid, "scheduled").await;
                    }
                }
            }
        }
    });
}

pub fn start_notification_poller(app_handle: AppHandle, port: u16) {
    let app_data_dir = app_handle.path().app_data_dir().expect("Failed to get app_data_dir");
    let file_path = app_data_dir.join("notifications.json");
    
    let initial_set: HashSet<String> = if let Ok(data) = fs::read_to_string(&file_path) {
        serde_json::from_str(&data).unwrap_or_default()
    } else {
        HashSet::new()
    };
    
    let seen_ids = Arc::new(Mutex::new(initial_set));
    let path_clone = file_path.clone();
    
    tauri::async_runtime::spawn(async move {
        let mut ticker = tokio::time::interval(std::time::Duration::from_secs(30));
        let client = reqwest::Client::new();
        
        loop {
            ticker.tick().await;
            
            let res = client
                .get(format!("http://localhost:{}/api/sync/notifications/pending", port))
                .send()
                .await;
                
            if let Ok(response) = res {
                if let Ok(data) = response.json::<PendingNotificationsResponse>().await {
                    if data.success {
                        let mut state = seen_ids.lock().unwrap();
                        let mut changed = false;
                        
                        for notif in data.notifications {
                            if !state.contains(&notif.id) {
                                state.insert(notif.id.clone());
                                changed = true;
                                
                                let _ = app_handle.notification()
                                    .builder()
                                    .title(notif.title)
                                    .body(notif.body)
                                    .show();
                            }
                        }
                        
                        if changed {
                            if let Ok(json) = serde_json::to_string(&*state) {
                                let _ = fs::write(&path_clone, json);
                            }
                        }
                    }
                }
            }
        }
    });
}
