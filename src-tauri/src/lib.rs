//! Rustify core. Each concern lives in its own module:
//! - `library`: local library model and storage
//! - `spotify`: Spotify sign-in and the allow-listed Web API proxy
//! - `credentials`: OS credential storage for saved logins
//! - `shuffle`: True shuffle ordering
//! - `lyrics`: song lyrics from LRCLIB
//! - `native_player`: the built-in Spotify Soloist player (desktop only)
//! - `island`: the floating always-on-top mini player (desktop only)
//! - `media`, `tray`, `hotkeys`: Windows media controls, tray icon, global hotkeys (desktop only)
//! - `background`: runs without the page while closed to the tray (desktop only)
//! - `desktop`: Tauri commands and app startup (desktop only)
pub mod credentials;
#[cfg(feature = "desktop")]
mod background;
#[cfg(feature = "desktop")]
mod desktop;
#[cfg(feature = "desktop")]
mod hotkeys;
#[cfg(feature = "desktop")]
pub mod island;
#[cfg(feature = "desktop")]
mod media;
#[cfg(feature = "desktop")]
mod tray;
pub mod library;
pub mod lyrics;
#[cfg(feature = "desktop")]
pub mod native_player;
pub mod shuffle;
pub mod spotify;

#[cfg(feature = "desktop")]
pub use desktop::run;
pub use library::{load_library, save_library, Library, Playlist, Track};
