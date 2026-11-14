//! Local music library model and validated, atomic storage.
use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
};
#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct Track {
    pub id: String,
    pub title: String,
    pub artist: String,
    pub album: String,
    pub duration: f64,
    pub src: String,
    pub cover: String,
    #[serde(default)]
    pub imported: bool,
}
#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct Playlist {
    pub id: String,
    pub title: String,
    pub description: String,
    pub cover: String,
    pub track_ids: Vec<String>,
}
#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct Library {
    pub version: u8,
    pub tracks: Vec<Track>,
    pub playlists: Vec<Playlist>,
    pub liked: Vec<String>,
    pub recent: Vec<String>,
}
impl Default for Library {
    fn default() -> Self {
        serde_json::from_str(include_str!("../../public/catalog.json"))
            .expect("Bundled library is valid")
    }
}
impl Library {
    pub fn validate(&self) -> Result<(), String> {
        if self.version != 1 {
            return Err("This library version is unsupported.".into());
        }
        let ids: std::collections::HashSet<_> = self.tracks.iter().map(|t| t.id.as_str()).collect();
        if ids.len() != self.tracks.len() {
            return Err("Duplicate track IDs.".into());
        }
        for p in &self.playlists {
            if p.title.trim().is_empty() || p.title.chars().count() > 100 {
                return Err("Playlist names must contain 1–100 characters.".into());
            }
            if p.track_ids.iter().any(|id| !ids.contains(id.as_str())) {
                return Err("Playlist contains an unknown track.".into());
            }
        }
        if self
            .liked
            .iter()
            .chain(&self.recent)
            .any(|id| !ids.contains(id.as_str()))
        {
            return Err("Library contains an unknown track.".into());
        }
        Ok(())
    }
}
pub fn load_library(root: &Path) -> Result<Library, String> {
    let path = root.join("library.json");
    if !path.exists() {
        return Ok(Library::default());
    }
    let library: Library = serde_json::from_slice(&fs::read(path).map_err(|e| e.to_string())?)
        .map_err(|_| {
            "The saved library could not be read. Your files have been preserved.".to_string()
        })?;
    library.validate()?;
    Ok(library)
}
pub fn save_library(root: &Path, library: &Library) -> Result<(), String> {
    library.validate()?;
    // An IPC caller cannot persist an asset pointing outside app-owned media.
    for track in library.tracks.iter().filter(|t| t.imported) {
        let path = PathBuf::from(&track.src);
        let media = root
            .join("media")
            .canonicalize()
            .map_err(|_| "Imported media directory is unavailable.")?;
        let owned = path
            .canonicalize()
            .map_err(|_| "An imported file is missing.")?;
        if !owned.starts_with(media) {
            return Err("Media must be imported through the picker.".into());
        }
    }
    fs::create_dir_all(root).map_err(|e| e.to_string())?;
    let temp = root.join("library.json.tmp");
    let bytes = serde_json::to_vec_pretty(library).map_err(|e| e.to_string())?;
    let mut file = fs::File::create(&temp).map_err(|e| e.to_string())?;
    std::io::Write::write_all(&mut file, &bytes).map_err(|e| e.to_string())?;
    file.sync_all().map_err(|e| e.to_string())?;
    fs::rename(&temp, root.join("library.json")).map_err(|e| e.to_string())
}
#[cfg(test)]
mod tests {
    use super::*;
    fn dir() -> PathBuf {
        std::env::temp_dir().join(format!("spotify-rust-test-{:032x}", rand::random::<u128>()))
    }
    #[test]
    fn library_round_trip_and_corruption_preserves_file() {
        let root = dir();
        let mut library = Library::default();
        library.liked.push(library.tracks[0].id.clone());
        save_library(&root, &library).unwrap();
        assert_eq!(load_library(&root).unwrap().liked, library.liked);
        fs::write(root.join("library.json"), b"broken").unwrap();
        assert!(load_library(&root).is_err());
        assert_eq!(fs::read(root.join("library.json")).unwrap(), b"broken");
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn unknown_tracks_rejected() {
        let mut library = Library::default();
        library.playlists[0].track_ids.push("unknown".into());
        assert!(library.validate().is_err());
    }
    #[test]
    fn external_media_rejected() {
        let root = dir();
        fs::create_dir_all(root.join("media")).unwrap();
        let mut library = Library::default();
        library.tracks[0].imported = true;
        library.tracks[0].src = "/etc/passwd".into();
        assert!(save_library(&root, &library).is_err());
        assert!(!root.join("library.json").exists());
        fs::remove_dir_all(root).unwrap();
    }
}
