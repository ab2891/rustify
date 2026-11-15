//! Background mode: when Rustify is closed to the tray and nothing needs the
//! page, the main window is destroyed so WebView2 (most of Rustify's memory)
//! shuts down. Soloist keeps playing. This module then answers media keys, the
//! tray menu and global hotkeys through the Web API and keeps the Windows
//! media controls up to date. Anything it cannot do itself (the island, a
//! failed command) reopens the page, hidden, and hands the command over.
use crate::{island, media, spotify::Spotify, tray};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};
use std::time::Duration;
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

/// Set by the page: true when it holds nothing that needs it alive (Spotify
/// mode, signed in, no True shuffle, no sleep timer, no island, setting on).
pub static CAN_UNLOAD: AtomicBool = AtomicBool::new(false);
/// True while the main window is gone and this module is in charge.
pub static HEADLESS: AtomicBool = AtomicBool::new(false);
static OPENING: AtomicBool = AtomicBool::new(false);

/// What should never play (Settings > Skip rules). The page skips these while
/// it is loaded; this copy lets the tray keep doing it.
#[derive(Clone, Default, serde::Deserialize)]
pub struct SkipRules {
    #[serde(default)]
    pub explicit: bool,
    /// Spotify artist ids.
    #[serde(default)]
    pub artists: Vec<String>,
    /// Lower-case genre words; an artist genre containing one is blocked.
    #[serde(default)]
    pub genres: Vec<String>,
}
pub static RULES: Mutex<Option<SkipRules>> = Mutex::new(None);
/// Genres per artist id, looked up once.
static GENRES: Mutex<Option<std::collections::HashMap<String, Vec<String>>>> = Mutex::new(None);
/// The song the rules were last checked for, and how many were skipped in a row.
static CHECKED: Mutex<(String, u8)> = Mutex::new((String::new(), 0));

fn genre_blocked(genres: &[String], blocked: &[String]) -> bool {
    genres.iter().any(|g| blocked.iter().any(|b| !b.is_empty() && g.to_lowercase().contains(b.as_str())))
}

/// True when the playing song breaks a rule. Checks each song once.
async fn breaks_rules(spotify: &Spotify, state: &serde_json::Value) -> bool {
    let Some(rules) = RULES.lock().unwrap().clone() else { return false };
    let item = &state["item"];
    let Some(id) = item["id"].as_str() else { return false };
    if !state["is_playing"].as_bool().unwrap_or(false) {
        return false;
    }
    {
        let mut checked = CHECKED.lock().unwrap();
        if checked.0 == id {
            return false;
        }
        checked.0 = id.to_string();
    }
    let artists: Vec<String> = item["artists"]
        .as_array()
        .map(|a| a.iter().filter_map(|x| x["id"].as_str().map(str::to_string)).collect())
        .unwrap_or_default();
    if rules.explicit && item["explicit"].as_bool().unwrap_or(false) {
        return true;
    }
    if artists.iter().any(|a| rules.artists.contains(a)) {
        return true;
    }
    if rules.genres.is_empty() {
        return false;
    }
    // Songs carry no genre; their first artist does.
    let Some(artist) = artists.first() else { return false };
    let known = GENRES.lock().unwrap().as_ref().and_then(|m| m.get(artist).cloned());
    let genres = match known {
        Some(genres) => genres,
        None => {
            let Ok(found) = spotify.request("GET", &format!("/artists/{artist}"), None).await else {
                return false;
            };
            let genres: Vec<String> = found["genres"]
                .as_array()
                .map(|g| g.iter().filter_map(|x| x.as_str().map(str::to_string)).collect())
                .unwrap_or_default();
            GENRES.lock().unwrap().get_or_insert_with(Default::default).insert(artist.clone(), genres.clone());
            genres
        }
    };
    genre_blocked(&genres, &rules.genres)
}
/// A command for the page to run once it has loaded again.
static PENDING: Mutex<Option<String>> = Mutex::new(None);

pub fn take_pending() -> Option<String> {
    PENDING.lock().unwrap().take()
}

/// Builds the main window. Call from `setup` or a non-UI thread only: building
/// a window from an event handler on the UI thread deadlocks on Windows.
pub fn build_main(app: &AppHandle, visible: bool) -> tauri::Result<()> {
    if app.get_webview_window("main").is_some() {
        return Ok(());
    }
    WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
        .title("Rustify")
        .inner_size(1440.0, 950.0)
        .min_inner_size(820.0, 600.0)
        .visible(visible)
        .additional_browser_args(&island::browser_args())
        .build()?;
    HEADLESS.store(false, Ordering::Relaxed);
    Ok(())
}

/// Brings the page back (if it was unloaded), optionally with a command for
/// it to run, and optionally showing the window.
pub fn wake(app: &AppHandle, show: bool, command: Option<&str>) {
    if let Some(main) = app.get_webview_window("main") {
        if let Some(command) = command {
            media::emit(app, command);
        }
        if show {
            let _ = main.unminimize();
            let _ = main.show();
            let _ = main.set_focus();
        }
        return;
    }
    if let Some(command) = command {
        *PENDING.lock().unwrap() = Some(command.to_string());
    }
    if OPENING.swap(true, Ordering::SeqCst) {
        return;
    }
    let app = app.clone();
    std::thread::spawn(move || {
        if let Err(e) = build_main(&app, show) {
            eprintln!("could not reopen Rustify: {e}");
        }
        OPENING.store(false, Ordering::SeqCst);
    });
}

/// Called when the main window has been destroyed on the way to the tray.
pub fn start(app: &AppHandle) {
    HEADLESS.store(true, Ordering::Relaxed);
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        while HEADLESS.load(Ordering::Relaxed) {
            refresh(&app).await;
            tokio::time::sleep(Duration::from_secs(5)).await;
        }
    });
}

/// Reads what Spotify is playing and shows it in the Windows media controls
/// and the tray tooltip.
async fn refresh(app: &AppHandle) {
    let spotify = app.state::<Arc<Spotify>>().inner().clone();
    let Ok(state) = spotify.request("GET", "/me/player", None).await else {
        return;
    };
    if !HEADLESS.load(Ordering::Relaxed) {
        return;
    }
    if breaks_rules(&spotify, &state).await {
        // Stop after a few in a row, so a blocked playlist cannot loop forever.
        let skipped = {
            let mut checked = CHECKED.lock().unwrap();
            checked.1 += 1;
            checked.1
        };
        if skipped <= 8 {
            let _ = spotify.request("POST", "/me/player/next", None).await;
            return;
        }
    } else if state["is_playing"].as_bool().unwrap_or(false) {
        CHECKED.lock().unwrap().1 = 0;
    }
    let now = now_playing(&state);
    tray::set_tooltip(app, &tray::tooltip(&now));
    media::update(app, now);
}

fn now_playing(state: &serde_json::Value) -> media::NowPlaying {
    let item = &state["item"];
    let images = &item["album"]["images"];
    media::NowPlaying {
        title: item["name"].as_str().unwrap_or_default().to_string(),
        artist: item["artists"]
            .as_array()
            .map(|a| a.iter().filter_map(|x| x["name"].as_str()).collect::<Vec<_>>().join(", "))
            .unwrap_or_default(),
        cover: images[1]["url"]
            .as_str()
            .or(images[0]["url"].as_str())
            .unwrap_or_default()
            .to_string(),
        playing: state["is_playing"].as_bool().unwrap_or(false),
        elapsed: state["progress_ms"].as_f64().unwrap_or(0.) / 1000.,
        duration: item["duration_ms"].as_f64().unwrap_or(0.) / 1000.,
    }
}

/// Runs a media command without the page. Falls back to waking the page when
/// the Web API refuses (for example no active device).
pub fn command(app: &AppHandle, name: &str) {
    if name == "island" {
        // The island mirrors the page, so the page has to come back (hidden).
        wake(app, false, Some(name));
        return;
    }
    let app = app.clone();
    let name = name.to_string();
    tauri::async_runtime::spawn(async move {
        let spotify = app.state::<Arc<Spotify>>().inner().clone();
        if run(&spotify, &name).await.is_err() {
            wake(&app, false, Some(&name));
            return;
        }
        // Spotify needs a moment before it reports the new state.
        tokio::time::sleep(Duration::from_millis(500)).await;
        refresh(&app).await;
    });
}

async fn run(spotify: &Spotify, name: &str) -> Result<(), String> {
    let (method, path) = match name {
        "next" => ("POST", "/me/player/next"),
        "previous" => ("POST", "/me/player/previous"),
        "play" => ("PUT", "/me/player/play"),
        "pause" => ("PUT", "/me/player/pause"),
        "toggle" => {
            let state = spotify.request("GET", "/me/player", None).await?;
            if state["is_playing"].as_bool().unwrap_or(false) {
                ("PUT", "/me/player/pause")
            } else {
                ("PUT", "/me/player/play")
            }
        }
        _ => return Ok(()),
    };
    spotify.request(method, path, None).await.map(|_| ())
}

#[cfg(test)]
mod tests {
    #[test]
    fn blocked_genres_match_inside_artist_genres() {
        let genres = vec!["Melodic Death Metal".to_string(), "swedish metal".to_string()];
        assert!(super::genre_blocked(&genres, &["metal".to_string()]));
        assert!(!super::genre_blocked(&genres, &["jazz".to_string()]));
        assert!(!super::genre_blocked(&genres, &[String::new()]));
    }
    #[test]
    fn player_state_becomes_now_playing() {
        let state = serde_json::json!({
            "is_playing": true, "progress_ms": 42000,
            "item": { "name": "Song", "duration_ms": 180000,
                "artists": [{ "name": "A" }, { "name": "B" }],
                "album": { "images": [{ "url": "https://i.scdn.co/big" }, { "url": "https://i.scdn.co/mid" }] } }
        });
        let now = super::now_playing(&state);
        assert_eq!((now.title.as_str(), now.artist.as_str(), now.cover.as_str()), ("Song", "A, B", "https://i.scdn.co/mid"));
        assert!(now.playing);
        assert_eq!((now.elapsed, now.duration), (42., 180.));
        assert_eq!(super::now_playing(&serde_json::Value::Null).title, "");
    }
}
