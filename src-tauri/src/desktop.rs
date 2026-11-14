//! Tauri commands and app startup. To add a feature: write a `#[tauri::command]`
//! here (or in a new module) and register it in `run()`'s `generate_handler!`.
use crate::{
    credentials,
    library::{load_library, save_library, Library, Track},
    native_player, shuffle, spotify,
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
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(Store(std::sync::Mutex::new(())))
        .manage(native_player::NativePlayer::default())
        .setup(|app| {
            let vault = credentials::NativeVault::new(app.path().app_data_dir()?);
            app.manage(std::sync::Arc::new(spotify::Spotify::with_vault(
                std::sync::Arc::new(vault),
            )));
            Ok(())
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
            spotify_player_stop
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
