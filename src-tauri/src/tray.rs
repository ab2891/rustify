//! System tray: Rustify keeps running there when its window is closed (if
//! enabled), with playback controls. Quit from the tray menu to exit.
use crate::media;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager,
};

const ID: &str = "rustify";

/// Whether closing the main window hides it to the tray instead of quitting.
pub static CLOSE_TO_TRAY: AtomicBool = AtomicBool::new(true);

pub fn close_to_tray() -> bool {
    CLOSE_TO_TRAY.load(Ordering::Relaxed)
}

pub fn init(app: &AppHandle) -> tauri::Result<()> {
    let item = |id: &str, text: &str| MenuItem::with_id(app, id, text, true, None::<&str>);
    let menu = Menu::with_items(
        app,
        &[
            &item("toggle", "Play / Pause")?,
            &item("next", "Next")?,
            &item("previous", "Previous")?,
            &PredefinedMenuItem::separator(app)?,
            &item("show", "Show Rustify")?,
            &item("island", "Show / hide island")?,
            &PredefinedMenuItem::separator(app)?,
            &item("quit", "Quit Rustify")?,
        ],
    )?;
    let mut builder = TrayIconBuilder::with_id(ID)
        .tooltip("Rustify")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "quit" => app.exit(0),
            other => media::command_or_show(app, other),
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(app)?;
    Ok(())
}

pub fn set_tooltip(app: &AppHandle, text: &str) {
    if let Some(tray) = app.tray_by_id(ID) {
        let _ = tray.set_tooltip(Some(text));
    }
}

pub fn show_main(app: &AppHandle) {
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.unminimize();
        let _ = main.show();
        let _ = main.set_focus();
    }
}
