//! Song lyrics from LRCLIB (https://lrclib.net), a free public lyrics database.
//! Spotify's Web API has no lyrics. A lookup sends the song's title, artist,
//! album and length to lrclib.net, so it only runs when the user opens lyrics.
use serde::Serialize;
use std::time::Duration;

#[derive(Serialize, Default, Debug, PartialEq)]
pub struct Lyrics {
    /// LRC text with `[mm:ss.xx]` time tags, when LRCLIB has timed lyrics.
    pub synced: Option<String>,
    pub plain: Option<String>,
    pub instrumental: bool,
}

fn pick(entry: &serde_json::Value) -> Option<Lyrics> {
    let text = |key: &str| {
        entry[key]
            .as_str()
            .map(str::trim)
            .filter(|t| !t.is_empty())
            .map(str::to_string)
    };
    let lyrics = Lyrics {
        synced: text("syncedLyrics"),
        plain: text("plainLyrics"),
        instrumental: entry["instrumental"].as_bool().unwrap_or(false),
    };
    (lyrics.synced.is_some() || lyrics.plain.is_some() || lyrics.instrumental).then_some(lyrics)
}

/// `Ok(None)` when LRCLIB has nothing for the song.
pub async fn fetch(
    title: &str,
    artist: &str,
    album: &str,
    duration: f64,
) -> Result<Option<Lyrics>, String> {
    let client = reqwest::Client::builder()
        .user_agent("desktop-music-player/0.1")
        .timeout(Duration::from_secs(10))
        .build()
        .map_err(|e| e.to_string())?;
    let failed = |_| "Could not reach the lyrics service.".to_string();
    let seconds = (duration.round() as i64).to_string();
    // Exact match on title/artist/album/length first.
    let exact = client
        .get("https://lrclib.net/api/get")
        .query(&[
            ("track_name", title),
            ("artist_name", artist),
            ("album_name", album),
            ("duration", &seconds),
        ])
        .send()
        .await
        .map_err(failed)?;
    if exact.status().is_success() {
        let entry: serde_json::Value = exact.json().await.map_err(failed)?;
        if let Some(lyrics) = pick(&entry) {
            return Ok(Some(lyrics));
        }
    }
    // Otherwise the closest search hit of about the same length, timed first.
    let found = client
        .get("https://lrclib.net/api/search")
        .query(&[("track_name", title), ("artist_name", artist)])
        .send()
        .await
        .map_err(failed)?;
    if !found.status().is_success() {
        return Ok(None);
    }
    let entries: Vec<serde_json::Value> = found.json().await.map_err(failed)?;
    let close = |e: &&serde_json::Value| {
        duration <= 0. || (e["duration"].as_f64().unwrap_or(0.) - duration).abs() <= 3.
    };
    Ok(entries
        .iter()
        .filter(close)
        .find(|e| e["syncedLyrics"].as_str().is_some_and(|t| !t.trim().is_empty()))
        .or_else(|| entries.iter().find(close))
        .and_then(pick))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn picks_timed_and_plain_text() {
        let entry = serde_json::json!({"syncedLyrics": "[00:01.00] Hi", "plainLyrics": "Hi", "instrumental": false});
        let lyrics = pick(&entry).unwrap();
        assert_eq!(lyrics.synced.as_deref(), Some("[00:01.00] Hi"));
        assert_eq!(lyrics.plain.as_deref(), Some("Hi"));
        assert_eq!(pick(&serde_json::json!({"syncedLyrics": null, "plainLyrics": " "})), None);
        assert!(pick(&serde_json::json!({"instrumental": true})).unwrap().instrumental);
    }
}
