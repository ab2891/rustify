//! Dev probe: with a paired Soloist already running as "Rustify", move playback
//! to it and play one track via the Web API, using the saved Rustify login.
use spotify_rust::{credentials::NativeVault, native_player::DEVICE_NAME, spotify::Spotify};
use std::{path::PathBuf, sync::Arc, time::Duration};

#[tokio::main]
async fn main() -> Result<(), String> {
    let dir = PathBuf::from(std::env::args().nth(1).ok_or("usage: player-probe <app-data-dir> [track-uri]")?);
    let track = std::env::args().nth(2).unwrap_or("spotify:track:4cOdK2wGLETKBW3PvgPWqT".into());
    let spotify = Arc::new(Spotify::with_vault(Arc::new(NativeVault::new(dir))));
    if !spotify.restore().await? {
        return Err("No saved Spotify login in that directory.".into());
    }
    let devices = spotify.request("GET", "/me/player/devices", None).await?;
    let device = devices["devices"]
        .as_array()
        .and_then(|d| d.iter().find(|d| d["name"] == DEVICE_NAME))
        .and_then(|d| d["id"].as_str())
        .ok_or("Rustify device not listed")?
        .to_string();
    println!("device: {device}");
    spotify.request("PUT", "/me/player", Some(serde_json::json!({ "device_ids": [device], "play": false }))).await?;
    tokio::time::sleep(Duration::from_secs(1)).await;
    spotify
        .request("PUT", &format!("/me/player/play?device_id={device}"), Some(serde_json::json!({ "uris": [track] })))
        .await?;
    for _ in 0..3 {
        tokio::time::sleep(Duration::from_secs(4)).await;
        let s = spotify.request("GET", "/me/player", None).await?;
        println!("playing={} device={} progress_ms={} track={}", s["is_playing"], s["device"]["name"], s["progress_ms"], s["item"]["name"]);
    }
    let _ = spotify.request("PUT", "/me/player/pause", None).await;
    Ok(())
}
