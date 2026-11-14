//! Rustify core. Each concern lives in its own module:
//! - `library`: local library model and storage
//! - `spotify`: Spotify sign-in and the allow-listed Web API proxy
//! - `credentials`: OS credential storage for saved logins
//! - `shuffle`: True shuffle ordering
//! - `native_player`: the built-in Spotify Soloist player (desktop only)
//! - `island`: the floating always-on-top mini player (desktop only)
//! - `desktop`: Tauri commands and app startup (desktop only)
pub mod credentials;
#[cfg(feature = "desktop")]
mod desktop;
#[cfg(feature = "desktop")]
pub mod island;
pub mod library;
#[cfg(feature = "desktop")]
pub mod native_player;
pub mod shuffle;
pub mod spotify;

#[cfg(feature = "desktop")]
pub use desktop::run;
pub use library::{load_library, save_library, Library, Playlist, Track};
