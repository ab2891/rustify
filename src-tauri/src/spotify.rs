use crate::credentials::{self, SavedSession, Vault};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use reqwest::{Client, Method, Url};
use serde::Deserialize;
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::sync::Arc;
use std::{
    io::{Read, Write},
    net::TcpListener,
    time::{Duration, Instant},
};
use tokio::sync::Mutex;

pub const REDIRECT: &str = "http://127.0.0.1:43821/callback";
pub const SCOPES: &str = "streaming user-read-email user-read-private playlist-read-private playlist-read-collaborative playlist-modify-private playlist-modify-public user-library-read user-library-modify user-read-playback-state user-read-currently-playing user-modify-playback-state";
#[derive(Deserialize)]
struct TokenResponse {
    access_token: String,
    refresh_token: Option<String>,
    expires_in: u64,
}
struct Session {
    client_id: String,
    access: String,
    refresh: String,
    expires: Instant,
    dirty: bool,
}
pub struct Spotify {
    session: Mutex<Option<Session>>,
    client: Client,
    vault: Option<Arc<dyn Vault>>,
}
impl Default for Spotify {
    fn default() -> Self {
        Self {
            session: Mutex::new(None),
            vault: None,
            client: Client::builder()
                .timeout(Duration::from_secs(25))
                .redirect(reqwest::redirect::Policy::none())
                .build()
                .expect("HTTP client"),
        }
    }
}

pub struct Authorization {
    pub url: String,
    verifier: String,
    state: String,
    listener: TcpListener,
}
impl Authorization {
    pub fn begin(client_id: &str) -> Result<Self, String> {
        if client_id.len() != 32 || !client_id.chars().all(|c| c.is_ascii_hexdigit()) {
            return Err("Enter the 32-character public Spotify Client ID.".into());
        }
        let listener = TcpListener::bind("127.0.0.1:43821").map_err(|_| {
            "The sign-in callback port 43821 is busy. Close the other sign-in attempt and retry."
        })?;
        listener.set_nonblocking(true).map_err(|e| e.to_string())?;
        let verifier = URL_SAFE_NO_PAD.encode(rand::random::<[u8; 32]>());
        let state = URL_SAFE_NO_PAD.encode(rand::random::<[u8; 32]>());
        let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
        let mut url = Url::parse("https://accounts.spotify.com/authorize").unwrap();
        url.query_pairs_mut().extend_pairs([
            ("client_id", client_id),
            ("response_type", "code"),
            ("redirect_uri", REDIRECT),
            ("scope", SCOPES),
            ("state", &state),
            ("code_challenge_method", "S256"),
            ("code_challenge", &challenge),
        ]);
        Ok(Self {
            url: url.into(),
            verifier,
            state,
            listener,
        })
    }
    pub fn receive(self) -> Result<(String, String), String> {
        let start = Instant::now();
        while start.elapsed() < Duration::from_secs(180) {
            match self.listener.accept() {
                Ok((mut stream, _)) => {
                    let _ = stream.set_read_timeout(Some(Duration::from_secs(2)));
                    let mut bytes = [0; 8192];
                    let mut read = 0;
                    while read < bytes.len() {
                        match stream.read(&mut bytes[read..]) {
                            Ok(0) => break,
                            Ok(n) => {
                                read += n;
                                if bytes[..read].windows(2).any(|w| w == b"\r\n") {
                                    break;
                                }
                            }
                            Err(_) => break,
                        }
                    }
                    let request = String::from_utf8_lossy(&bytes[..read]);
                    let target = request
                        .lines()
                        .next()
                        .and_then(|s| s.strip_prefix("GET "))
                        .and_then(|s| s.split_whitespace().next())
                        .unwrap_or("");
                    let result = parse_callback(target, &self.state);
                    let (status, message) = if result.is_ok() {
                        (
                            "200 OK",
                            "Signed in. You can close this tab and return to Rustify.",
                        )
                    } else {
                        (
                            "400 Bad Request",
                            "Sign-in was not completed. Return to the app and try again.",
                        )
                    };
                    let response=format!("HTTP/1.1 {status}\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{message}",message.len());
                    let _ = stream.write_all(response.as_bytes());
                    // Ignore unrelated requests; a state mismatch never consumes the legitimate callback.
                    if target.starts_with("/callback?") && result.is_ok() {
                        return Ok((result?, self.verifier));
                    }
                    if matches!(result,Err(ref error) if error=="Spotify sign-in was declined. Try again when ready.")
                    {
                        return result.map(|code| (code, self.verifier));
                    }
                }
                Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                    std::thread::sleep(Duration::from_millis(100))
                }
                Err(_) => return Err("Sign-in callback failed.".into()),
            }
        }
        Err("Sign-in timed out after three minutes. Try connecting again.".into())
    }
}
pub fn parse_callback(target: &str, state: &str) -> Result<String, String> {
    if !target.starts_with("/callback?") {
        return Err("Unexpected callback path.".into());
    }
    let url = Url::parse(&format!("http://127.0.0.1{target}")).map_err(|_| "Invalid callback.")?;
    let params: std::collections::HashMap<_, _> = url.query_pairs().into_owned().collect();
    if params.get("state").map(String::as_str) != Some(state) {
        return Err("Sign-in state did not match.".into());
    }
    if params.contains_key("error") {
        return Err("Spotify sign-in was declined. Try again when ready.".into());
    }
    params
        .get("code")
        .filter(|s| !s.is_empty())
        .cloned()
        .ok_or("No authorization code received.".into())
}
impl Spotify {
    pub fn with_vault(vault: Arc<dyn Vault>) -> Self {
        Self {
            vault: Some(vault),
            ..Self::default()
        }
    }
    async fn persist_session(&self, session: &Session) -> Result<(), String> {
        if let Some(vault) = &self.vault {
            credentials::save(
                vault.clone(),
                SavedSession {
                    version: 1,
                    client_id: session.client_id.clone(),
                    refresh_token: session.refresh.clone(),
                },
            )
            .await?;
        }
        Ok(())
    }
    pub async fn restore(&self) -> Result<bool, String> {
        let mut guard = self.session.lock().await;
        if guard.is_some() {
            return Ok(true);
        }
        let Some(vault) = &self.vault else {
            return Ok(false);
        };
        let Some(saved) = credentials::load(vault.clone()).await? else {
            return Ok(false);
        };
        *guard = Some(Session {
            client_id: saved.client_id,
            refresh: saved.refresh_token,
            access: String::new(),
            expires: Instant::now(),
            dirty: false,
        });
        Ok(true)
    }
    pub async fn complete(
        &self,
        client_id: String,
        code: String,
        verifier: String,
    ) -> Result<(), String> {
        let response = self
            .client
            .post("https://accounts.spotify.com/api/token")
            .form(&[
                ("grant_type", "authorization_code"),
                ("client_id", &client_id),
                ("code", &code),
                ("redirect_uri", REDIRECT),
                ("code_verifier", &verifier),
            ])
            .send()
            .await
            .map_err(|_| "Could not reach Spotify sign-in.")?;
        if !response.status().is_success() {
            return Err("Spotify rejected sign-in. Check the Client ID, redirect URI and allowlisted account.".into());
        }
        let token: TokenResponse = response
            .json()
            .await
            .map_err(|_| "Invalid sign-in response.")?;
        let refresh = token
            .refresh_token
            .ok_or("Spotify did not return a refresh token.")?;
        let mut guard = self.session.lock().await;
        let session = Session {
            client_id,
            access: token.access_token,
            refresh,
            expires: Instant::now() + Duration::from_secs(token.expires_in.saturating_sub(60)),
            dirty: false,
        };
        self.persist_session(&session).await?;
        *guard = Some(session);
        Ok(())
    }
    pub async fn disconnect(&self) -> Result<(), String> {
        let mut guard = self.session.lock().await;
        if let Some(vault) = &self.vault {
            credentials::delete(vault.clone()).await?;
        }
        *guard = None;
        Ok(())
    }
    // Only the capability-protected loopback SDK host may expose this token.
    pub async fn playback_token(&self) -> Result<String, String> {
        let mut guard = self.session.lock().await;
        let session = guard
            .as_mut()
            .ok_or("Connect your Spotify account first.")?;
        if Instant::now() >= session.expires {
            let response = self
                .client
                .post("https://accounts.spotify.com/api/token")
                .form(&[
                    ("grant_type", "refresh_token"),
                    ("client_id", &session.client_id),
                    ("refresh_token", &session.refresh),
                ])
                .send()
                .await
                .map_err(|_| "Could not refresh Spotify sign-in.")?;
            if !response.status().is_success() {
                let revoked = response
                    .json::<Value>()
                    .await
                    .ok()
                    .and_then(|v| {
                        v.get("error")
                            .and_then(Value::as_str)
                            .map(|e| e == "invalid_grant")
                    })
                    .unwrap_or(false);
                if revoked {
                    if let Some(vault) = &self.vault {
                        credentials::delete(vault.clone()).await?;
                    }
                    *guard = None;
                    return Err("Your Spotify session expired. Sign in again.".into());
                }
                return Err(
                    "Could not refresh your Spotify login. Check your connection and retry.".into(),
                );
            }
            let token: TokenResponse = response
                .json()
                .await
                .map_err(|_| "Invalid refresh response.")?;
            session.access = token.access_token;
            if let Some(refresh) = token.refresh_token {
                session.refresh = refresh;
                session.dirty = true;
            }
            session.expires =
                Instant::now() + Duration::from_secs(token.expires_in.saturating_sub(60));
        }
        if session.dirty {
            self.persist_session(session).await?;
            session.dirty = false;
        }
        Ok(session.access.clone())
    }
    pub async fn request(
        &self,
        method: &str,
        path: &str,
        body: Option<Value>,
    ) -> Result<Value, String> {
        let url = allowed_url(method, path)?;
        let access = self.playback_token().await?;
        let request = prepare_api_request(&self.client, method, url, &access, body)?;
        let response = request
            .send()
            .await
            .map_err(|_| "Could not reach Spotify. Check your connection and retry.")?;
        let status = response.status().as_u16();
        if status == 204 {
            return Ok(Value::Null);
        }
        if status == 429 {
            let wait = response
                .headers()
                .get("retry-after")
                .and_then(|v| v.to_str().ok())
                .unwrap_or("a few");
            return Err(format!(
                "Spotify rate limit reached. Retry in {wait} seconds."
            ));
        }
        if status == 401 {
            return Err("Spotify authorization expired. Disconnect and sign in again.".into());
        }
        if status == 403 {
            return Err("Spotify denied this action. Check account access, Premium playback eligibility and app permissions.".into());
        }
        if status == 404 {
            return Err("No active Spotify device or this item is unavailable. Press play to use Rustify on this computer, or select another device.".into());
        }
        if !(200..300).contains(&status) {
            return Err(format!(
                "Spotify could not complete this action (HTTP {status})."
            ));
        }
        let bytes = response
            .bytes()
            .await
            .map_err(|_| "Could not read Spotify response.")?;
        decode_success(method, path, &bytes)
    }
}
fn prepare_api_request(
    client: &Client,
    method: &str,
    url: Url,
    access: &str,
    body: Option<Value>,
) -> Result<reqwest::RequestBuilder, String> {
    let mut request = client
        .request(
            Method::from_bytes(method.as_bytes()).map_err(|_| "Invalid method.")?,
            url,
        )
        .bearer_auth(access);
    if let Some(body) = body {
        request = request.json(&body);
    } else if matches!(method, "PUT" | "POST" | "DELETE") {
        // Some Spotify gateways reject empty mutation requests without explicit framing.
        request = request.header(reqwest::header::CONTENT_LENGTH, "0");
    }
    Ok(request)
}
fn decode_success(method: &str, path: &str, bytes: &[u8]) -> Result<Value, String> {
    let path = path.split('?').next().unwrap_or(path);
    let no_payload = method != "GET"
        && (path == "/me/library" || path == "/me/player" || path.starts_with("/me/player/"));
    let playlist_metadata = method == "PUT"
        && path
            .strip_prefix("/playlists/")
            .is_some_and(|id| !id.is_empty() && !id.contains('/'));
    if no_payload || playlist_metadata {
        return Ok(Value::Null);
    }
    serde_json::from_slice(bytes).map_err(|_| "Spotify returned an unreadable response.".into())
}
pub fn allowed_url(method: &str, path: &str) -> Result<Url, String> {
    if !path.starts_with('/')
        || path.starts_with("//")
        || path.contains('\\')
        || path.contains("..")
        || path.contains('#')
    {
        return Err("Unsupported Spotify endpoint.".into());
    }
    let url = Url::parse(&format!("https://api.spotify.com/v1{path}"))
        .map_err(|_| "Invalid endpoint.")?;
    if url.host_str() != Some("api.spotify.com") {
        return Err("Invalid API host.".into());
    }
    let p = url.path().strip_prefix("/v1").unwrap_or("");
    let segments: Vec<_> = p.split('/').filter(|s| !s.is_empty()).collect();
    let read = matches!(
        p,
        "/me"
            | "/me/playlists"
            | "/me/tracks"
            | "/me/albums"
            | "/me/library/contains"
            | "/search"
            | "/me/player"
            | "/me/player/devices"
            | "/me/player/queue"
    ) || matches!(
        segments.as_slice(),
        ["playlists", _, "items"]
            | ["albums", _, "tracks"]
            | ["albums", _]
            | ["tracks", _]
            | ["artists", _]
            | ["artists", _, "albums"]
    );
    let write = match method {
        "PUT" => {
            matches!(
                p,
                "/me/library"
                    | "/me/player"
                    | "/me/player/play"
                    | "/me/player/pause"
                    | "/me/player/seek"
                    | "/me/player/repeat"
                    | "/me/player/shuffle"
                    | "/me/player/volume"
            ) || matches!(
                segments.as_slice(),
                ["playlists", _] | ["playlists", _, "items"]
            )
        }
        "POST" => {
            matches!(
                p,
                "/me/playlists" | "/me/player/next" | "/me/player/previous" | "/me/player/queue"
            ) || matches!(segments.as_slice(), ["playlists", _, "items"])
        }
        "DELETE" => p == "/me/library" || matches!(segments.as_slice(), ["playlists", _, "items"]),
        _ => false,
    };
    if (method == "GET" && read) || write {
        Ok(url)
    } else {
        Err("Unsupported Spotify endpoint.".into())
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn restores_only_refresh_credentials_and_disconnect_removes_them() {
        let saved = SavedSession {
            version: 1,
            client_id: "a".repeat(32),
            refresh_token: "synthetic-refresh".into(),
        };
        let vault = Arc::new(crate::credentials::MemoryVault(std::sync::Mutex::new(
            Some(saved),
        )));
        let first = Spotify::with_vault(vault.clone());
        assert!(first.restore().await.unwrap());
        {
            let guard = first.session.lock().await;
            let session = guard.as_ref().unwrap();
            assert!(session.access.is_empty());
            assert!(session.expires <= Instant::now());
            assert_eq!(session.refresh, "synthetic-refresh");
        }
        first.disconnect().await.unwrap();
        let restarted = Spotify::with_vault(vault);
        assert!(!restarted.restore().await.unwrap());
    }
    #[tokio::test]
    async fn locked_store_does_not_discard_session_on_failed_disconnect() {
        struct Locked;
        impl Vault for Locked {
            fn load(&self) -> Result<Option<SavedSession>, String> {
                Err("locked".into())
            }
            fn save(&self, _: &SavedSession) -> Result<(), String> {
                Err("locked".into())
            }
            fn delete(&self) -> Result<(), String> {
                Err("locked".into())
            }
        }
        let spotify = Spotify::with_vault(Arc::new(Locked));
        assert!(spotify.restore().await.is_err());
        *spotify.session.lock().await = Some(Session {
            client_id: "a".repeat(32),
            access: "memory-access".into(),
            refresh: "memory-refresh".into(),
            expires: Instant::now(),
            dirty: false,
        });
        assert!(spotify.disconnect().await.is_err());
        assert!(spotify.session.lock().await.is_some());
    }
    #[test]
    fn empty_mutations_have_explicit_content_length() {
        let client = Client::new();
        for method in ["PUT", "POST", "DELETE"] {
            let request = prepare_api_request(
                &client,
                method,
                Url::parse("https://api.spotify.com/v1/me/player/pause").unwrap(),
                "test-token",
                None,
            )
            .unwrap()
            .build()
            .unwrap();
            assert_eq!(request.headers()[reqwest::header::CONTENT_LENGTH], "0");
        }
        let get = prepare_api_request(
            &client,
            "GET",
            Url::parse("https://api.spotify.com/v1/me").unwrap(),
            "test-token",
            None,
        )
        .unwrap()
        .build()
        .unwrap();
        assert!(!get.headers().contains_key(reqwest::header::CONTENT_LENGTH));
    }
    #[test]
    fn no_content_acknowledgements_do_not_mask_json_contracts() {
        assert_eq!(
            decode_success("PUT", "/me/player/pause", b"Accepted").unwrap(),
            Value::Null
        );
        assert_eq!(
            decode_success("POST", "/me/player/next?device_id=x", b"OK").unwrap(),
            Value::Null
        );
        assert_eq!(
            decode_success("DELETE", "/me/library?uris=x", b"OK").unwrap(),
            Value::Null
        );
        assert_eq!(
            decode_success("POST", "/me/playlists", br#"{"id":"new"}"#).unwrap()["id"],
            "new"
        );
        assert!(decode_success("GET", "/me/player", b"not json").is_err());
        assert!(decode_success("GET", "/me", b"").is_err());
        assert!(decode_success("GET", "/search?q=x", b" \n").is_err());
        assert!(decode_success("POST", "/me/playlists", b"").is_err());
        assert!(decode_success("POST", "/me/playlists", b"not json").is_err());
        assert!(decode_success("POST", "/playlists/x/items", b"not json").is_err());
        assert_eq!(
            decode_success("PUT", "/playlists/x", b" \n").unwrap(),
            Value::Null
        );
    }
    #[test]
    fn callback_requires_state_and_path() {
        assert_eq!(
            parse_callback("/callback?code=abc&state=correct", "correct").unwrap(),
            "abc"
        );
        assert!(parse_callback("/callback?code=abc&state=wrong", "correct").is_err());
        assert!(parse_callback("/other?code=abc&state=correct", "correct").is_err());
        assert!(parse_callback("/callback?error=access_denied&state=correct", "correct").is_err());
    }
    #[test]
    fn denial_must_match_state() {
        assert_eq!(
            parse_callback("/callback?error=access_denied&state=wrong", "correct").unwrap_err(),
            "Sign-in state did not match."
        );
        assert_eq!(
            parse_callback("/callback?error=access_denied&state=correct", "correct").unwrap_err(),
            "Spotify sign-in was declined. Try again when ready."
        );
    }
    #[test]
    fn pkce_is_s256_and_secret_free() {
        let auth = Authorization::begin("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa").unwrap();
        let url = Url::parse(&auth.url).unwrap();
        let query: std::collections::HashMap<_, _> = url.query_pairs().into_owned().collect();
        assert_eq!(auth.verifier.len(), 43);
        assert_eq!(
            query["code_challenge"],
            URL_SAFE_NO_PAD.encode(Sha256::digest(auth.verifier.as_bytes()))
        );
        assert_eq!(query["redirect_uri"], REDIRECT);
        assert!(!query.contains_key("client_secret"));
    }
    #[test]
    fn listener_ignores_forged_denial_and_accepts_fragmented_callback() {
        use std::net::TcpStream;
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        listener.set_nonblocking(true).unwrap();
        let authorization = Authorization {
            url: String::new(),
            verifier: "verifier".into(),
            state: "expected".into(),
            listener,
        };
        let receiver = std::thread::spawn(move || authorization.receive());
        let mut forged = TcpStream::connect(address).unwrap();
        forged
            .set_read_timeout(Some(Duration::from_secs(3)))
            .unwrap();
        forged
            .write_all(b"GET /callback?error=access_denied&state=wrong HTTP/1.1\r\n\r\n")
            .unwrap();
        let mut reply = String::new();
        forged.read_to_string(&mut reply).unwrap();
        assert!(reply.starts_with("HTTP/1.1 400"));
        let mut legitimate = TcpStream::connect(address).unwrap();
        legitimate.write_all(b"GET /call").unwrap();
        std::thread::sleep(Duration::from_millis(10));
        legitimate
            .write_all(b"back?code=accepted&state=expected HTTP/1.1\r\n\r\n")
            .unwrap();
        assert_eq!(
            receiver.join().unwrap().unwrap(),
            ("accepted".into(), "verifier".into())
        );
    }
    #[test]
    fn proxy_cannot_send_tokens_to_arbitrary_host() {
        for path in [
            "//evil.test/",
            "https://evil.test/",
            "/../token",
            "/me#fragment",
            "/me\\@evil.test",
        ] {
            assert!(allowed_url("GET", path).is_err());
        }
        assert!(allowed_url("GET", "/search?q=ambient&type=track&limit=10").is_ok());
        assert!(allowed_url("DELETE", "/me/player").is_err());
        assert!(allowed_url("PUT", "/me/library?uris=spotify%3Atrack%3A123").is_ok());
        assert!(allowed_url("GET", "/playlists/123/items?limit=50&offset=50").is_ok());
    }
}
