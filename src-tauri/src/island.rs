//! The island: a small always-on-top, frameless mini player that can be
//! dragged anywhere and remembers its position. Its page is `island.html`; it
//! talks to the main window through events (`island-ready`, `island-command`,
//! `island-state`, `island-closed`).
use std::{
    path::PathBuf,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};
use tauri::{
    AppHandle, Emitter, Manager, PhysicalPosition, WebviewUrl, WebviewWindow, WebviewWindowBuilder,
    WindowEvent,
};

pub const LABEL: &str = "island";
const WIDTH: f64 = 380.0;
const HEIGHT: f64 = 68.0;

/// Opens the island, or closes it if open. Returns whether it is now open.
pub fn toggle(app: &AppHandle, data_dir: PathBuf) -> Result<bool, String> {
    if let Some(window) = app.get_webview_window(LABEL) {
        window.close().map_err(|e| e.to_string())?;
        return Ok(false);
    }
    let window = WebviewWindowBuilder::new(app, LABEL, WebviewUrl::App("island.html".into()))
        .title("Rustify island")
        .inner_size(WIDTH, HEIGHT)
        .resizable(false)
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .visible(false)
        .build()
        .map_err(|e| format!("Could not open the island: {e}"))?;
    let file = data_dir.join("island.json");
    let position = saved(&file)
        .filter(|p| on_screen(&window, *p))
        .or_else(|| top_center(&window));
    if let Some(position) = position {
        let _ = window.set_position(position);
    }
    window.show().map_err(|e| e.to_string())?;

    let last_write = Arc::new(Mutex::new((None::<PhysicalPosition<i32>>, Instant::now())));
    let handle = app.clone();
    window.on_window_event(move |event| match event {
        WindowEvent::Moved(position) => {
            let mut state = last_write.lock().unwrap();
            state.0 = Some(*position);
            // Throttle writes while dragging; the final spot is saved on close.
            if state.1.elapsed() > Duration::from_millis(400) {
                save(&file, *position);
                state.1 = Instant::now();
            }
        }
        WindowEvent::Destroyed => {
            if let Some(position) = last_write.lock().unwrap().0 {
                save(&file, position);
            }
            let _ = handle.emit("island-closed", ());
        }
        _ => {}
    });
    Ok(true)
}

/// Brings the main Rustify window to the front.
pub fn show_main(app: &AppHandle) -> Result<(), String> {
    let main = app
        .get_webview_window("main")
        .ok_or("Main window not found.")?;
    let _ = main.unminimize();
    main.show()
        .and_then(|_| main.set_focus())
        .map_err(|e| e.to_string())
}

fn saved(file: &PathBuf) -> Option<PhysicalPosition<i32>> {
    let (x, y): (i32, i32) = serde_json::from_slice(&std::fs::read(file).ok()?).ok()?;
    Some(PhysicalPosition::new(x, y))
}

fn save(file: &PathBuf, position: PhysicalPosition<i32>) {
    if let (Some(dir), Ok(bytes)) = (file.parent(), serde_json::to_vec(&(position.x, position.y))) {
        let _ = std::fs::create_dir_all(dir);
        let _ = std::fs::write(file, bytes);
    }
}

/// A saved spot is only reused if it is still on a connected monitor.
fn on_screen(window: &WebviewWindow, p: PhysicalPosition<i32>) -> bool {
    window
        .available_monitors()
        .unwrap_or_default()
        .iter()
        .any(|m| {
            let (pos, size) = (m.position(), m.size());
            p.x >= pos.x - 40
                && p.y >= pos.y
                && p.x < pos.x + size.width as i32 - 40
                && p.y < pos.y + size.height as i32 - 20
        })
}

fn top_center(window: &WebviewWindow) -> Option<PhysicalPosition<i32>> {
    let monitor = window.primary_monitor().ok()??;
    let scale = monitor.scale_factor();
    let (pos, size) = (monitor.position(), monitor.size());
    Some(PhysicalPosition::new(
        pos.x + ((size.width as f64 - WIDTH * scale) / 2.0) as i32,
        pos.y + (14.0 * scale) as i32,
    ))
}
