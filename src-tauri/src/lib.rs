pub mod credentials;
#[cfg(feature = "desktop")]
pub mod native_player;
pub mod shuffle;
pub mod spotify;
use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
};
#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct Track {
    pub id: String,
    pub title: String,
    pub artist: String,
    pub album: String,
    pub duration: f64,
    pub src: String,
    pub cover: String,
    #[serde(default)]
    pub imported: bool,
}
#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct Playlist {
    pub id: String,
    pub title: String,
    pub description: String,
    pub cover: String,
    pub track_ids: Vec<String>,
}
#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct Library {
    pub version: u8,
    pub tracks: Vec<Track>,
    pub playlists: Vec<Playlist>,
    pub liked: Vec<String>,
    pub recent: Vec<String>,
}
impl Default for Library {
    fn default() -> Self {
        serde_json::from_str(include_str!("../../public/catalog.json"))
            .expect("Bundled library is valid")
    }
}
impl Library {
    pub fn validate(&self) -> Result<(), String> {
        if self.version != 1 {
            return Err("This library version is unsupported.".into());
        }
        let ids: std::collections::HashSet<_> = self.tracks.iter().map(|t| t.id.as_str()).collect();
        if ids.len() != self.tracks.len() {
            return Err("Duplicate track IDs.".into());
        }
        for p in &self.playlists {
            if p.title.trim().is_empty() || p.title.chars().count() > 100 {
                return Err("Playlist names must contain 1–100 characters.".into());
            }
            if p.track_ids.iter().any(|id| !ids.contains(id.as_str())) {
                return Err("Playlist contains an unknown track.".into());
            }
        }
        if self
            .liked
            .iter()
            .chain(&self.recent)
            .any(|id| !ids.contains(id.as_str()))
        {
            return Err("Library contains an unknown track.".into());
        }
        Ok(())
    }
}
pub fn load_library(root: &Path) -> Result<Library, String> {
    let path = root.join("library.json");
    if !path.exists() {
        return Ok(Library::default());
    }
    let library: Library = serde_json::from_slice(&fs::read(path).map_err(|e| e.to_string())?)
        .map_err(|_| {
            "The saved library could not be read. Your files have been preserved.".to_string()
        })?;
    library.validate()?;
    Ok(library)
}
pub fn save_library(root: &Path, library: &Library) -> Result<(), String> {
    library.validate()?;
    // An IPC caller cannot persist an asset pointing outside app-owned media.
    for track in library.tracks.iter().filter(|t| t.imported) {
        let path = PathBuf::from(&track.src);
        let media = root
            .join("media")
            .canonicalize()
            .map_err(|_| "Imported media directory is unavailable.")?;
        let owned = path
            .canonicalize()
            .map_err(|_| "An imported file is missing.")?;
        if !owned.starts_with(media) {
            return Err("Media must be imported through the picker.".into());
        }
    }
    fs::create_dir_all(root).map_err(|e| e.to_string())?;
    let temp = root.join("library.json.tmp");
    let bytes = serde_json::to_vec_pretty(library).map_err(|e| e.to_string())?;
    let mut file = fs::File::create(&temp).map_err(|e| e.to_string())?;
    std::io::Write::write_all(&mut file, &bytes).map_err(|e| e.to_string())?;
    file.sync_all().map_err(|e| e.to_string())?;
    fs::rename(&temp, root.join("library.json")).map_err(|e| e.to_string())
}
#[cfg(feature = "desktop")]
mod desktop {
    use super::*;
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
        let (code, verifier) =
            tauri::async_runtime::spawn_blocking(move || authorization.receive())
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
}
#[cfg(feature = "desktop")]
pub use desktop::run;
#[cfg(test)]
mod tests {
    use super::*;
    fn dir() -> PathBuf {
        std::env::temp_dir().join(format!("spotify-rust-test-{:032x}", rand::random::<u128>()))
    }
    #[test]
    fn library_round_trip_and_corruption_preserves_file() {
        let root = dir();
        let mut library = Library::default();
        library.liked.push(library.tracks[0].id.clone());
        save_library(&root, &library).unwrap();
        assert_eq!(load_library(&root).unwrap().liked, library.liked);
        fs::write(root.join("library.json"), b"broken").unwrap();
        assert!(load_library(&root).is_err());
        assert_eq!(fs::read(root.join("library.json")).unwrap(), b"broken");
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn unknown_tracks_rejected() {
        let mut library = Library::default();
        library.playlists[0].track_ids.push("unknown".into());
        assert!(library.validate().is_err());
    }
    #[test]
    fn external_media_rejected() {
        let root = dir();
        fs::create_dir_all(root.join("media")).unwrap();
        let mut library = Library::default();
        library.tracks[0].imported = true;
        library.tracks[0].src = "/etc/passwd".into();
        assert!(save_library(&root, &library).is_err());
        assert!(!root.join("library.json").exists());
        fs::remove_dir_all(root).unwrap();
    }
}
