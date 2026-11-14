//! Tauri commands and app startup. To add a feature: write a `#[tauri::command]`
//! here (or in a new module) and register it in `run()`'s `generate_handler!`.
use crate::{
    credentials, hotkeys, island,
    library::{load_library, save_library, Library, Track},
    media, native_player, shuffle, spotify, tray,
};
use std::{fs, path::PathBuf};
use tauri::{Manager, State};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;
struct Store(std::sync::Mutex<()>);
fn root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path().app_data_dir().map_err(|e| e.to_string())
}
#[tauri::command]
fn get_library(app: tauri::AppHandle) -> Result<Library, String> {
    load_library(&root(&app)?)
}
#[tauri::command]
fn persist_library(
    app: tauri::AppHandle,
    store: State<Store>,
    library: Library,
) -> Result<(), String> {
    let _guard = store.0.lock().map_err(|_| "Library busy.")?;
    save_library(&root(&app)?, &library)
}
#[tauri::command]
async fn import_tracks(app: tauri::AppHandle) -> Result<Vec<Track>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let picked = app
            .dialog()
            .file()
            .add_filter(
                "Audio",
                &["mp3", "m4a", "wav", "ogg", "flac", "aac", "opus"],
            )
            .blocking_pick_files();
        let Some(files) = picked else {
            return Ok(vec![]);
        };
        let media = root(&app)?.join("media");
        fs::create_dir_all(&media).map_err(|e| e.to_string())?;
        let mut tracks = Vec::new();
        for selection in files {
            let source = selection
                .into_path()
                .map_err(|_| "Select a local audio file.")?;
            let ext = source
                .extension()
                .and_then(|s| s.to_str())
                .unwrap_or("")
                .to_lowercase();
            if !["mp3", "m4a", "wav", "ogg", "flac", "aac", "opus"].contains(&ext.as_str()) {
                return Err("Unsupported audio file.".into());
            }
            let metadata = fs::metadata(&source).map_err(|_| "Cannot read selected audio.")?;
            if !metadata.is_file() || metadata.len() > 512 * 1024 * 1024 {
                return Err("Choose audio files smaller than 512 MB.".into());
            }
            let id = format!("local-{:032x}", rand::random::<u128>());
            let dest = media.join(format!("{id}.{ext}"));
            fs::copy(&source, &dest).map_err(|e| e.to_string())?;
            tracks.push(Track {
                id,
                title: source
                    .file_stem()
                    .unwrap_or_default()
                    .to_string_lossy()
                    .into_owned(),
                artist: "Local artist".into(),
                album: "Local files".into(),
                duration: 0.,
                src: dest.to_string_lossy().into_owned(),
                cover: "/art/local.svg".into(),
                imported: true,
            });
        }
        Ok(tracks)
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
fn shuffle_tracks(ids: Vec<String>, keep_first: Option<String>) -> Result<Vec<String>, String> {
    shuffle::tracks(ids, keep_first)
}
#[tauri::command]
async fn spotify_connect(
    app: tauri::AppHandle,
    spotify: State<'_, std::sync::Arc<spotify::Spotify>>,
    client_id: String,
) -> Result<serde_json::Value, String> {
    let authorization = spotify::Authorization::begin(&client_id)?;
    app.opener()
        .open_url(&authorization.url, None::<&str>)
        .map_err(|_| "Could not open your browser.")?;
    let (code, verifier) = tauri::async_runtime::spawn_blocking(move || authorization.receive())
        .await
        .map_err(|e| e.to_string())??;
    spotify.complete(client_id, code, verifier).await?;
    spotify.request("GET", "/me", None).await
}
#[tauri::command]
async fn spotify_restore(
    spotify: State<'_, std::sync::Arc<spotify::Spotify>>,
) -> Result<Option<serde_json::Value>, String> {
    if !spotify.restore().await? {
        return Ok(None);
    }
    spotify.request("GET", "/me", None).await.map(Some)
}
#[tauri::command]
async fn spotify_request(
    spotify: State<'_, std::sync::Arc<spotify::Spotify>>,
    method: String,
    path: String,
    body: Option<serde_json::Value>,
) -> Result<serde_json::Value, String> {
    spotify.request(&method, &path, body).await
}
#[tauri::command]
async fn spotify_disconnect(
    player: State<'_, native_player::NativePlayer>,
    spotify: State<'_, std::sync::Arc<spotify::Spotify>>,
) -> Result<(), String> {
    player.stop().await;
    spotify.disconnect().await
}
/// Starts Rustify's built-in Spotify device and returns its Web API id.
#[tauri::command]
async fn spotify_player_start(
    spotify: State<'_, std::sync::Arc<spotify::Spotify>>,
    player: State<'_, native_player::NativePlayer>,
) -> Result<String, String> {
    player.start(spotify.inner().clone()).await
}
#[tauri::command]
fn spotify_player_status(player: State<'_, native_player::NativePlayer>) -> native_player::Status {
    player.status()
}
#[tauri::command]
async fn spotify_player_stop(player: State<'_, native_player::NativePlayer>) -> Result<(), String> {
    player.stop().await;
    Ok(())
}
/// Shows or hides the floating island; returns whether it is now open.
// Must be async: creating a window from a sync command deadlocks on Windows.
#[tauri::command]
async fn island_toggle(app: tauri::AppHandle) -> Result<bool, String> {
    island::toggle(&app, root(&app)?)
}
#[tauri::command]
async fn island_show_main(app: tauri::AppHandle) -> Result<(), String> {
    island::show_main(&app)
}
#[tauri::command]
fn island_configure(app: tauri::AppHandle, options: island::Options) {
    island::configure(&app, options);
}
#[tauri::command]
fn island_set_visible(app: tauri::AppHandle, visible: bool) {
    island::set_visible(&app, visible);
}
/// Now-playing for Windows media controls and the tray tooltip.
#[tauri::command]
fn media_update(app: tauri::AppHandle, now: media::NowPlaying) {
    tray::set_tooltip(
        &app,
        &if now.title.is_empty() {
            "Rustify".to_string()
        } else {
            // Windows truncates tray tooltips at 127 characters.
            format!("{} · {}", now.title, now.artist).chars().take(120).collect()
        },
    );
    media::update(&app, now);
}
#[tauri::command]
fn set_close_to_tray(enabled: bool) {
    tray::CLOSE_TO_TRAY.store(enabled, std::sync::atomic::Ordering::Relaxed);
}
/// Returns the hotkeys that could not be registered.
#[tauri::command]
fn set_hotkeys(app: tauri::AppHandle, enabled: bool) -> Vec<String> {
    hotkeys::set_enabled(&app, enabled)
}
/// Start with Windows (hidden in the tray). Returns the new state.
#[tauri::command]
fn set_autostart(app: tauri::AppHandle, enabled: bool) -> Result<bool, String> {
    use tauri_plugin_autostart::ManagerExt;
    let launcher = app.autolaunch();
    let result = if enabled { launcher.enable() } else { launcher.disable() };
    result.map_err(|e| format!("Could not change start-up setting: {e}"))?;
    launcher.is_enabled().map_err(|e| e.to_string())
}
#[tauri::command]
fn get_autostart(app: tauri::AppHandle) -> bool {
    use tauri_plugin_autostart::ManagerExt;
    app.autolaunch().is_enabled().unwrap_or(false)
}
/// Started by Windows at sign-in: stay in the tray instead of showing the window.
const MINIMIZED: &str = "--minimized";
pub fn run() {
    tauri::Builder::default()
        // Must be first: a second launch just shows the running Rustify, so two
        // copies never fight over the Soloist player.
        .plugin(tauri_plugin_single_instance::init(|app, _, _| tray::show_main(app)))
        .plugin(
            tauri_plugin_autostart::Builder::new()
                .args([MINIMIZED])
                .build(),
        )
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(hotkeys::plugin())
        .manage(Store(std::sync::Mutex::new(())))
        .manage(native_player::NativePlayer::default())
        .setup(|app| {
            let vault = credentials::NativeVault::new(app.path().app_data_dir()?);
            app.manage(std::sync::Arc::new(spotify::Spotify::with_vault(
                std::sync::Arc::new(vault),
            )));
            let handle = app.handle();
            if let Err(e) = tray::init(handle) {
                eprintln!("tray unavailable: {e}");
            }
            if let Err(e) = media::init(handle) {
                eprintln!("media controls unavailable: {e}");
            }
            // Default on; the frontend re-applies the saved setting at startup.
            hotkeys::set_enabled(handle, true);
            // The window starts hidden (tauri.conf.json) to avoid a flash when
            // launched at sign-in; show it unless that is the case.
            if !std::env::args().any(|a| a == MINIMIZED) {
                tray::show_main(handle);
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            // Closing the window keeps Rustify playing in the tray (if enabled).
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" && tray::close_to_tray() {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
            // The island mirrors the main window; close it with the app.
            if window.label() == "main" && matches!(event, tauri::WindowEvent::Destroyed) {
                if let Some(island) = window.app_handle().get_webview_window(island::LABEL) {
                    let _ = island.close();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            get_library,
            shuffle_tracks,
            persist_library,
            import_tracks,
            spotify_connect,
            spotify_restore,
            spotify_request,
            spotify_disconnect,
            spotify_player_start,
            spotify_player_status,
            spotify_player_stop,
            island_toggle,
            island_show_main,
            island_configure,
            island_set_visible,
            media_update,
            set_close_to_tray,
            set_hotkeys,
            set_autostart,
            get_autostart
        ])
        .build(tauri::generate_context!())
        .expect("Could not launch desktop app")
        .run(|app, event| {
            // Never leave the hidden Spotify player running after Rustify closes.
            if let tauri::RunEvent::Exit = event {
                app.state::<native_player::NativePlayer>().kill_now();
            }
        });
}
