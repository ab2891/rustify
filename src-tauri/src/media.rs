//! Windows media controls: media keys, the volume flyout and the lock screen
//! show what Rustify is playing and control it. Commands reach the frontend as
//! `media-command` events (the same channel the tray and hotkeys use), or go
//! to `background` while the page is unloaded in the tray.
use serde::Deserialize;
use tauri::{AppHandle, Emitter};

/// What the frontend reports as playing (see `playerSnapshot` in main.js).
#[derive(Clone, Default, Deserialize)]
#[cfg_attr(not(windows), allow(dead_code))]
pub struct NowPlaying {
    pub title: String,
    pub artist: String,
    pub cover: String,
    pub playing: bool,
    pub elapsed: f64,
    pub duration: f64,
}

/// "show" brings the window up natively; everything else goes to the frontend.
pub fn command_or_show(app: &AppHandle, name: &str) {
    if name == "show" {
        crate::background::wake(app, true, None);
    } else {
        command(app, name);
    }
}

/// Sends a command to the main window: play, pause, toggle, next, previous,
/// island, or show.
pub fn command(app: &AppHandle, name: &str) {
    use tauri::Manager;
    if app.get_webview_window("main").is_some() {
        emit(app, name);
    } else {
        crate::background::command(app, name);
    }
}

pub fn emit(app: &AppHandle, name: &str) {
    let _ = app.emit_to("main", "media-command", name);
}

#[cfg(windows)]
mod platform {
    use super::*;
    use souvlaki::{
        MediaControlEvent, MediaControls, MediaMetadata, MediaPlayback, MediaPosition,
        PlatformConfig,
    };
    use std::{cell::RefCell, time::Duration};

    thread_local! {
        // SMTC lives on the main (UI) thread; every call is marshalled there.
        static CONTROLS: RefCell<Option<MediaControls>> = const { RefCell::new(None) };
    }

    pub fn init(app: &AppHandle) -> Result<(), String> {
        // Windows ties media controls to a window. They use a hidden window of
        // their own, so they keep working while the main window is unloaded.
        // Created here on the UI thread, whose message loop serves it.
        use windows_sys::Win32::UI::WindowsAndMessaging::CreateWindowExW;
        let class: Vec<u16> = "STATIC\0".encode_utf16().collect();
        let title: Vec<u16> = "Rustify media controls\0".encode_utf16().collect();
        let hwnd = unsafe {
            CreateWindowExW(
                0,
                class.as_ptr(),
                title.as_ptr(),
                0,
                0,
                0,
                0,
                0,
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                std::ptr::null(),
            )
        };
        if hwnd.is_null() {
            return Err("could not create the media controls window".into());
        }
        let mut controls = MediaControls::new(PlatformConfig {
            display_name: "Rustify",
            dbus_name: "rustify",
            hwnd: Some(hwnd as _),
        })
        .map_err(|e| format!("{e:?}"))?;
        let handle = app.clone();
        controls
            .attach(move |event| {
                let name = match event {
                    MediaControlEvent::Play => "play",
                    MediaControlEvent::Pause => "pause",
                    MediaControlEvent::Toggle => "toggle",
                    MediaControlEvent::Next => "next",
                    MediaControlEvent::Previous => "previous",
                    MediaControlEvent::Raise => "show",
                    _ => return,
                };
                command_or_show(&handle, name);
            })
            .map_err(|e| format!("{e:?}"))?;
        CONTROLS.with(|c| *c.borrow_mut() = Some(controls));
        Ok(())
    }

    pub fn update(app: &AppHandle, now: NowPlaying) {
        let _ = app.run_on_main_thread(move || {
            CONTROLS.with(|c| {
                let mut c = c.borrow_mut();
                let Some(controls) = c.as_mut() else { return };
                if now.title.is_empty() {
                    let _ = controls.set_playback(MediaPlayback::Stopped);
                    return;
                }
                // Windows needs an absolute image URL; bundled art is skipped.
                let cover = now.cover.starts_with("https://").then_some(now.cover.as_str());
                let _ = controls.set_metadata(MediaMetadata {
                    title: Some(&now.title),
                    artist: Some(&now.artist),
                    cover_url: cover,
                    duration: (now.duration > 0.0).then(|| Duration::from_secs_f64(now.duration)),
                    ..Default::default()
                });
                let progress = Some(MediaPosition(Duration::from_secs_f64(now.elapsed.max(0.0))));
                let _ = controls.set_playback(if now.playing {
                    MediaPlayback::Playing { progress }
                } else {
                    MediaPlayback::Paused { progress }
                });
            })
        });
    }
}

#[cfg(not(windows))]
mod platform {
    use super::*;
    pub fn init(_: &AppHandle) -> Result<(), String> {
        Ok(())
    }
    pub fn update(_: &AppHandle, _: NowPlaying) {}
}

pub use platform::{init, update};
