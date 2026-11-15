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
    /// `volume` (0-100) is what a newly launched player starts at; Soloist
    /// itself always starts at 40 and forgets the last volume.
    pub async fn start(&self, spotify: Arc<Spotify>, volume: Option<u8>) -> Result<String, String> {
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
            match launch(volume) {
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

/// The installed Soloist's build date as `YYYYMMDD`, read from `--version`
/// (e.g. `soloist 1.3.10.71 build 1794592912 (20261113) ...`). Spotify stops
/// each build 90 days after this date.
pub fn build_date() -> Option<String> {
    let exe = executable(&home()?);
    if !exe.is_file() {
        return None;
    }
    let mut command = Command::new(exe);
    command.arg("--version").stdin(Stdio::null()).stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000);
    }
    parse_build_date(&String::from_utf8_lossy(&command.output().ok()?.stdout))
}

fn parse_build_date(version: &str) -> Option<String> {
    version
        .split(|c| c == '(' || c == ')')
        .find(|part| part.len() == 8 && part.starts_with("20") && part.bytes().all(|b| b.is_ascii_digit()))
        .map(str::to_string)
}

static STARTING: Mutex<()> = Mutex::new(());

/// Run once when Rustify starts: no player of ours exists yet, so any Soloist
/// still running from Rustify's folder was left behind by a copy of Rustify
/// that was ended from Task Manager or crashed. Without this it would keep
/// playing with Rustify closed, and the new Rustify would silently reuse it.
pub fn stop_leftovers() {
    let _starting = STARTING.lock().unwrap();
    if let Some(home) = home() {
        stop_stale(&executable(&home));
    }
}

fn expired() -> String {
    format!("Rustify's Spotify player (Spotify Soloist) has expired. Download the latest build from {DOWNLOAD_URL} into the Rustify\\soloist folder.")
}

fn launch(volume: Option<u8>) -> Result<Child, String> {
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
        .args(["--initial-volume", &volume.unwrap_or(40).min(100).to_string()])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    // Not while the start-up cleanup is still looking for leftovers: it would
    // end the player started here.
    let _starting = STARTING.lock().unwrap();
    stop_stale(&exe);
    let child = command
        .spawn()
        .map_err(|e| format!("Could not start Rustify's Spotify player: {e}"))?;
    tie_to_rustify(&child);
    Ok(child)
}

/// Ends Soloist copies left behind by an earlier Rustify that was killed, so
/// two players never share the same "Rustify" device and data folder.
#[cfg(windows)]
fn stop_stale(exe: &Path) {
    use std::os::windows::process::CommandExt;
    let script = format!(
        "Get-CimInstance Win32_Process -Filter \"Name='soloist.exe'\" | Where-Object {{ $_.ExecutablePath -eq '{}' }} | ForEach-Object {{ Stop-Process -Id $_.ProcessId -Force }}",
        exe.display().to_string().replace('\'', "''")
    );
    let _ = Command::new("powershell")
        .args(["-NoProfile", "-NonInteractive", "-Command", &script])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .creation_flags(0x0800_0000)
        .status();
}
#[cfg(not(windows))]
fn stop_stale(_: &Path) {}

/// Puts Soloist in a Windows job that ends it whenever Rustify ends, even if
/// Rustify crashes or is killed and never gets to stop it itself.
#[cfg(windows)]
fn tie_to_rustify(child: &Child) {
    use std::os::windows::io::AsRawHandle;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use windows_sys::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
        SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
        JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    };
    // One job for the life of Rustify; its handle closes when Rustify exits.
    static JOB: AtomicUsize = AtomicUsize::new(0);
    unsafe {
        let mut job = JOB.load(Ordering::SeqCst);
        if job == 0 {
            let handle = CreateJobObjectW(std::ptr::null(), std::ptr::null());
            if handle.is_null() {
                return;
            }
            let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
            info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            SetInformationJobObject(
                handle,
                JobObjectExtendedLimitInformation,
                &info as *const _ as *const _,
                std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
            );
            job = handle as usize;
            JOB.store(job, Ordering::SeqCst);
        }
        AssignProcessToJobObject(job as _, child.as_raw_handle() as _);
    }
}
#[cfg(not(windows))]
fn tie_to_rustify(_: &Child) {}

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

#[cfg(test)]
mod tests {
    #[test]
    fn build_date_is_read_from_version_output() {
        let line = "soloist 1.3.10.71 build 1794592912 (20261113) (g19412df6ea) (windows/x86_64)";
        assert_eq!(super::parse_build_date(line).as_deref(), Some("20261113"));
        assert_eq!(super::parse_build_date("soloist 1.0 (windows/x86_64)"), None);
    }
}
