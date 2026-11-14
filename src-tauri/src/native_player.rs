//! Rustify's built-in Spotify speaker: Spotify's official headless client
//! (Spotify Soloist) runs as a hidden child process and appears as the
//! "Rustify" Spotify Connect device. No Spotify app window, no browser tab.
//! The Web API keeps controlling it like any other device.
//!
//! Soloist may not be redistributed, so it is installed by the user under
//! `%LOCALAPPDATA%\Rustify\soloist\`. The API key is read from the local env
//! file `%LOCALAPPDATA%\Rustify\.env` (or `SOLOIST_API_KEY` in the environment).
use crate::spotify::Spotify;
use serde::Serialize;
use std::{
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

pub const DEVICE_NAME: &str = "Rustify";
pub const DOWNLOAD_URL: &str =
    "https://developer.spotify.com/documentation/soloist/reference/downloads-and-updates";

#[derive(Clone, Default, Serialize)]
pub struct Status {
    /// Web API device id, set once Spotify lists the device.
    pub device_id: Option<String>,
    pub starting: bool,
    pub error: Option<String>,
}

#[derive(Default)]
pub struct NativePlayer {
    child: tokio::sync::Mutex<Option<Child>>,
    status: Arc<Mutex<Status>>,
}

/// Where Rustify keeps Soloist and its key: `%LOCALAPPDATA%\Rustify` on Windows.
pub fn home() -> Option<PathBuf> {
    if let Some(dir) = std::env::var_os("RUSTIFY_HOME") {
        return Some(dir.into());
    }
    std::env::var_os("LOCALAPPDATA").map(|d| PathBuf::from(d).join("Rustify"))
}

fn executable(home: &Path) -> PathBuf {
    home.join("soloist").join(if cfg!(windows) {
        "soloist.exe"
    } else {
        "soloist"
    })
}

/// `SOLOIST_API_KEY` from the process environment or the local `.env` file.
fn api_key(home: &Path) -> Option<String> {
    if let Ok(key) = std::env::var("SOLOIST_API_KEY") {
        return Some(key.trim().to_string()).filter(|k| !k.is_empty());
    }
    let text = std::fs::read_to_string(home.join(".env")).ok()?;
    text.lines()
        .filter_map(|l| l.trim().strip_prefix("SOLOIST_API_KEY="))
        .map(|v| v.trim().trim_matches('"').to_string())
        .find(|v| !v.is_empty())
}

impl NativePlayer {
    pub fn status(&self) -> Status {
        self.status.lock().unwrap().clone()
    }

    fn set(&self, status: Status) {
        *self.status.lock().unwrap() = status;
    }

    pub async fn stop(&self) {
        if let Some(mut child) = self.child.lock().await.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
        self.set(Status::default());
    }

    /// Synchronous variant for app shutdown, so no orphan player keeps running.
    pub fn kill_now(&self) {
        if let Ok(mut guard) = self.child.try_lock() {
            if let Some(mut child) = guard.take() {
                let _ = child.kill();
                let _ = child.wait();
            }
        }
    }

    /// Starts (or reuses) the device and waits until the Web API can target it.
    pub async fn start(&self, spotify: Arc<Spotify>) -> Result<String, String> {
        let mut guard = self.child.lock().await;
        let alive = match guard.as_mut() {
            Some(child) => match child.try_wait() {
                Ok(None) => true,
                Ok(Some(code)) => {
                    guard.take();
                    if code.code() == Some(10) {
                        let e = expired();
                        self.set(Status {
                            error: Some(e.clone()),
                            ..Status::default()
                        });
                        return Err(e);
                    }
                    false
                }
                Err(_) => false,
            },
            None => false,
        };
        if alive {
            if let Some(id) = self.status().device_id {
                return Ok(id);
            }
        } else {
            self.set(Status {
                starting: true,
                ..Status::default()
            });
            match launch() {
                Ok(child) => *guard = Some(child),
                Err(e) => {
                    self.set(Status {
                        error: Some(e.clone()),
                        ..Status::default()
                    });
                    return Err(e);
                }
            }
        }
        let result = find_device(&spotify, guard.as_mut().unwrap()).await;
        match result {
            Ok(id) => {
                self.set(Status {
                    device_id: Some(id.clone()),
                    ..Status::default()
                });
                Ok(id)
            }
            Err(e) => {
                if let Some(mut child) = guard.take() {
                    let _ = child.kill();
                    let _ = child.wait();
                }
                self.set(Status {
                    error: Some(e.clone()),
                    ..Status::default()
                });
                Err(e)
            }
        }
    }
}

fn expired() -> String {
    format!("Rustify's Spotify player (Spotify Soloist) has expired. Download the latest build from {DOWNLOAD_URL} into the Rustify\\soloist folder.")
}

fn launch() -> Result<Child, String> {
    let home = home().ok_or("Could not find the Rustify data folder.")?;
    let exe = executable(&home);
    if !exe.is_file() {
        return Err(format!(
            "Rustify's Spotify player is not installed. Download Spotify Soloist from {DOWNLOAD_URL} and extract it to {}.",
            exe.parent().unwrap().display()
        ));
    }
    let key = api_key(&home).ok_or_else(|| {
        format!(
            "Add SOLOIST_API_KEY=... to {} to enable Spotify playback.",
            home.join(".env").display()
        )
    })?;
    let mut command = Command::new(&exe);
    command
        .args(["--device-name", DEVICE_NAME, "--api-key", &key])
        .arg("--data-dir")
        .arg(home.join("soloist-data"))
        .arg("--cache-dir")
        .arg(home.join("soloist-cache"))
        .args(["--cache-size", "200"])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    command
        .spawn()
        .map_err(|e| format!("Could not start Rustify's Spotify player: {e}"))
}

async fn find_device(spotify: &Spotify, child: &mut Child) -> Result<String, String> {
    let deadline = Instant::now() + Duration::from_secs(20);
    while Instant::now() < deadline {
        if let Ok(Some(code)) = child.try_wait() {
            return Err(match code.code() {
                Some(10) => expired(),
                _ => "Rustify's Spotify player stopped while starting. If this is the first run, open Spotify on your phone (same Wi-Fi) and choose \"Rustify\" once to pair it.".into(),
            });
        }
        let result = spotify.request("GET", "/me/player/devices", None).await?;
        let devices = result["devices"].as_array().cloned().unwrap_or_default();
        if let Some(id) = devices
            .iter()
            .find(|d| d["name"].as_str() == Some(DEVICE_NAME))
            .and_then(|d| d["id"].as_str())
        {
            return Ok(id.to_string());
        }
        tokio::time::sleep(Duration::from_millis(700)).await;
    }
    Err("Rustify's Spotify player is running but not signed in. Open Spotify on your phone (same Wi-Fi), tap the devices icon and choose \"Rustify\" once to pair it.".into())
}
