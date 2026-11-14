//! Refresh credentials never cross IPC or enter the library/frontend storage.
use serde::{Deserialize, Serialize};
use std::sync::Arc;

#[derive(Clone, Serialize, Deserialize)]
pub struct SavedSession {
    pub version: u8,
    pub client_id: String,
    pub refresh_token: String,
}
pub trait Vault: Send + Sync {
    fn load(&self) -> Result<Option<SavedSession>, String>;
    fn save(&self, session: &SavedSession) -> Result<(), String>;
    fn delete(&self) -> Result<(), String>;
}
pub async fn load(vault: Arc<dyn Vault>) -> Result<Option<SavedSession>, String> {
    tokio::task::spawn_blocking(move || vault.load())
        .await
        .map_err(|_| "Credential storage could not be opened.".to_string())?
}
pub async fn save(vault: Arc<dyn Vault>, session: SavedSession) -> Result<(), String> {
    tokio::task::spawn_blocking(move || vault.save(&session))
        .await
        .map_err(|_| "Your login could not be saved securely.".to_string())?
}
pub async fn delete(vault: Arc<dyn Vault>) -> Result<(), String> {
    tokio::task::spawn_blocking(move || vault.delete())
        .await
        .map_err(|_| "Your saved login could not be removed.".to_string())?
}
pub fn decode(value: &str) -> Result<SavedSession, String> {
    let saved: SavedSession = serde_json::from_str(value)
        .map_err(|_| "Your saved login could not be read. Disconnect and sign in again.")?;
    if saved.version != 1
        || saved.client_id.len() != 32
        || !saved.client_id.chars().all(|c| c.is_ascii_hexdigit())
        || saved.refresh_token.is_empty()
    {
        return Err("Your saved login is invalid. Disconnect and sign in again.".into());
    }
    Ok(saved)
}

#[cfg(feature = "desktop")]
pub struct NativeVault {
    directory: std::path::PathBuf,
    name: &'static str,
    wsl: bool,
}
#[cfg(feature = "desktop")]
impl NativeVault {
    pub fn new(directory: std::path::PathBuf) -> Self {
        Self::named(directory, "spotify-session")
    }
    /// A separately stored secret (e.g. the built-in player's reusable credentials).
    pub fn named(directory: std::path::PathBuf, name: &'static str) -> Self {
        let wsl = cfg!(target_os = "linux")
            && std::fs::read_to_string("/proc/sys/kernel/osrelease")
                .unwrap_or_default()
                .to_ascii_lowercase()
                .contains("microsoft");
        Self {
            directory,
            name,
            wsl,
        }
    }
    fn entry(&self) -> Result<keyring::Entry, String> {
        keyring::Entry::new("dev.local.spotify-rust", self.name).map_err(|_| {
            "The system credential store is unavailable. Unlock your keychain and retry.".into()
        })
    }
    fn file(&self) -> std::path::PathBuf {
        self.directory.join(format!("{}.dpapi", self.name))
    }
    fn protect(&self, value: &str, decrypt: bool) -> Result<String, String> {
        use std::{
            io::Write,
            process::{Command, Stdio},
        };
        // Fixed code only. Secret material travels through stdin/stdout, never arguments.
        // DPAPI keys belong to the signed-in Windows user; no encryption key is stored beside this file.
        const ENCRYPT: &str = r#"$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.Security; $s=[Console]::In.ReadToEnd(); $b=[Text.Encoding]::UTF8.GetBytes($s); $p=[Security.Cryptography.ProtectedData]::Protect($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Out.Write([Convert]::ToBase64String($p))"#;
        const DECRYPT: &str = r#"$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.Security; $s=[Console]::In.ReadToEnd(); $b=[Convert]::FromBase64String($s); $p=[Security.Cryptography.ProtectedData]::Unprotect($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Out.Write([Text.Encoding]::UTF8.GetString($p))"#;
        let mut child = Command::new("powershell.exe")
            .args([
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                if decrypt { DECRYPT } else { ENCRYPT },
            ])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|_| {
                "Windows secure credential storage is unavailable. Check WSL Windows integration."
            })?;
        let sent = child
            .stdin
            .take()
            .ok_or("Secure credential input is unavailable.")?
            .write_all(value.as_bytes());
        let output = child
            .wait_with_output()
            .map_err(|_| "Windows credential encryption failed.")?;
        if sent.is_err() || !output.status.success() {
            return Err("Your Windows account could not unlock the saved login. Disconnect and sign in again.".into());
        }
        String::from_utf8(output.stdout)
            .map_err(|_| "Secure credential storage returned an invalid response.".into())
    }
}
#[cfg(feature = "desktop")]
impl NativeVault {
    pub fn load_secret(&self) -> Result<Option<String>, String> {
        let value = if self.wsl {
            let encrypted = match std::fs::read_to_string(self.file()) {
                Ok(value) => value,
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
                Err(_) => return Err("Your encrypted login could not be opened.".into()),
            };
            self.protect(&encrypted, true)?
        } else {
            match self.entry()?.get_password() {
                Ok(value) => value,
                Err(keyring::Error::NoEntry) => return Ok(None),
                Err(_) => {
                    return Err("Unlock your system credential store to restore Spotify.".into())
                }
            }
        };
        Ok(Some(value))
    }
    pub fn save_secret(&self, value: &str) -> Result<(), String> {
        if self.wsl {
            let encrypted = self.protect(value, false)?;
            std::fs::create_dir_all(&self.directory)
                .map_err(|_| "Secure credential storage could not be created.")?;
            let temporary = self.directory.join(format!("{}.dpapi.tmp", self.name));
            let mut options = std::fs::OpenOptions::new();
            options.write(true).create(true).truncate(true);
            #[cfg(unix)]
            {
                use std::os::unix::fs::OpenOptionsExt;
                options.mode(0o600);
            }
            let mut file = options
                .open(&temporary)
                .map_err(|_| "Your encrypted login could not be written.")?;
            use std::io::Write;
            file.write_all(encrypted.as_bytes())
                .and_then(|_| file.sync_all())
                .map_err(|_| "Your encrypted login could not be written.")?;
            std::fs::rename(temporary, self.file())
                .map_err(|_| "Your encrypted login could not be saved.".to_string())
        } else {
            self.entry()?
                .set_password(value)
                .map_err(|_| "Unlock your system credential store to save Spotify login.".into())
        }
    }
    pub fn delete_secret(&self) -> Result<(), String> {
        if self.wsl {
            match std::fs::remove_file(self.file()) {
                Ok(()) => Ok(()),
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
                Err(_) => Err("Your encrypted login could not be removed.".into()),
            }
        } else {
            match self.entry()?.delete_credential() {
                Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
                Err(_) => {
                    Err("Unlock your system credential store to remove Spotify login.".into())
                }
            }
        }
    }
}
#[cfg(feature = "desktop")]
impl Vault for NativeVault {
    fn load(&self) -> Result<Option<SavedSession>, String> {
        self.load_secret()?.map(|value| decode(&value)).transpose()
    }
    fn save(&self, session: &SavedSession) -> Result<(), String> {
        let value = serde_json::to_string(session).map_err(|_| "Your login could not be saved.")?;
        self.save_secret(&value)
    }
    fn delete(&self) -> Result<(), String> {
        self.delete_secret()
    }
}
#[cfg(test)]
pub struct MemoryVault(pub std::sync::Mutex<Option<SavedSession>>);
#[cfg(test)]
impl Vault for MemoryVault {
    fn load(&self) -> Result<Option<SavedSession>, String> {
        Ok(self.0.lock().unwrap().clone())
    }
    fn save(&self, saved: &SavedSession) -> Result<(), String> {
        *self.0.lock().unwrap() = Some(saved.clone());
        Ok(())
    }
    fn delete(&self) -> Result<(), String> {
        *self.0.lock().unwrap() = None;
        Ok(())
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_invalid_saved_credentials() {
        assert!(decode(
            r#"{"version":2,"client_id":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","refresh_token":"test"}"#
        )
        .is_err());
        assert!(decode(r#"{"version":1,"client_id":"not-an-id","refresh_token":""}"#).is_err());
        assert!(decode("broken").is_err());
    }
    #[cfg(feature = "desktop")]
    #[test]
    #[ignore = "Uses the current Windows user's DPAPI; explicitly run on WSL."]
    fn wsl_encrypted_round_trip_and_delete() {
        let root = std::env::temp_dir().join(format!(
            "rustify-vault-test-{:032x}",
            rand::random::<u128>()
        ));
        let vault = NativeVault::new(root.clone());
        assert!(vault.wsl);
        let saved = SavedSession {
            version: 1,
            client_id: "a".repeat(32),
            refresh_token: "synthetic-refresh-token-for-test".into(),
        };
        assert!(vault.load().unwrap().is_none());
        vault.save(&saved).unwrap();
        let ciphertext = std::fs::read_to_string(vault.file()).unwrap();
        assert!(!ciphertext.contains(&saved.refresh_token));
        assert!(serde_json::from_str::<serde_json::Value>(&ciphertext).is_err());
        assert_eq!(
            vault.load().unwrap().unwrap().refresh_token,
            saved.refresh_token
        );
        vault.delete().unwrap();
        assert!(vault.load().unwrap().is_none());
        std::fs::remove_dir_all(root).unwrap();
    }
}
