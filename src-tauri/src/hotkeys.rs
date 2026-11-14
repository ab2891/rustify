//! Global hotkeys that work from any app:
//! Ctrl+Alt+Space play/pause, Ctrl+Alt+Right next, Ctrl+Alt+Left previous,
//! Ctrl+Alt+I island. A combination another app already owns is skipped.
use crate::media;
use tauri::AppHandle;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

pub const BINDINGS: [(&str, &str); 4] = [
    ("ctrl+alt+space", "toggle"),
    ("ctrl+alt+right", "next"),
    ("ctrl+alt+left", "previous"),
    ("ctrl+alt+i", "island"),
];

pub fn plugin() -> tauri::plugin::TauriPlugin<tauri::Wry> {
    tauri_plugin_global_shortcut::Builder::new()
        .with_handler(|app, shortcut, event| {
            if event.state() != ShortcutState::Pressed {
                return;
            }
            if let Some((_, command)) = BINDINGS
                .iter()
                .find(|(keys, _)| keys.parse::<Shortcut>().ok().as_ref() == Some(shortcut))
            {
                media::command(app, command);
            }
        })
        .build()
}

/// Turns the hotkeys on or off. Returns the combinations that could not be
/// registered (usually because another app uses them).
pub fn set_enabled(app: &AppHandle, enabled: bool) -> Vec<String> {
    let shortcuts = app.global_shortcut();
    let _ = shortcuts.unregister_all();
    if !enabled {
        return vec![];
    }
    BINDINGS
        .iter()
        .filter(|(keys, _)| shortcuts.register(*keys).is_err())
        .map(|(keys, _)| keys.to_string())
        .collect()
}
