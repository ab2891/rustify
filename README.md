# Rustify

A standalone Rust/Tauri desktop music app with a Spotify-style three-panel interface, an authorized Spotify Web API integration, and a local music player.

## Run

Install [Tauri's platform prerequisites](https://v2.tauri.app/start/prerequisites/) and Rust stable first. On Ubuntu/Debian, these include `build-essential libwebkit2gtk-4.1-dev libxdo-dev libssl-dev librsvg2-dev libayatana-appindicator3-dev`.

```sh
cd rustify
npm ci
cp .env.example .env.local
# Put your public Spotify Client ID in .env.local.
npm run desktop
```

Keep your Client ID in `.env.local` with owner-only permissions. Git ignores that file. An env file is plaintext, not encrypted; a Client ID is public and will also be present in the frontend bundle. **Never put a Spotify client secret here.** PKCE requires no secret. Access tokens stay in memory in Rust and are never persisted. The refresh token and public Client ID are saved in the system credential store (macOS Keychain, Windows Credential Manager, Linux Secret Service). WSL uses Windows DPAPI CurrentUser encryption with ciphertext stored in app-owned data outside the repo, permissions 0600. Rustify restores your session at startup without reopening the browser, persists rotated refresh tokens, and removes saved credentials when you disconnect. There is no plaintext fallback. Unlock the system credential store if prompted.

For the frontend/local player in a browser, run `npm run dev` and open `http://127.0.0.1:1420`. Choose **Try local music**. Spotify sign-in and commands require the native desktop app.

`npm run desktop:build` builds the native executable; installer packaging/signing is not configured. `npm run build` builds just the frontend.

## Spotify dashboard

1. Select **Web API** for the Rustify application.
2. Register exactly `http://127.0.0.1:43821/callback` as a redirect URI.
3. In Development Mode, add the Spotify account under **Users and Access**. Current Spotify development access and playback rules require eligible Premium accounts.
4. Connect in Rustify. Set up the built-in player once (below), then press play. No Spotify app or browser tab is needed.

## Built-in Spotify player (Spotify Soloist)

Rustify plays Spotify audio itself through [Spotify Soloist](https://developer.spotify.com/documentation/soloist), Spotify's official headless Spotify Connect client. Rustify starts it as a hidden background process named **Rustify**, then controls it through the Web API like any other device. There is no Spotify app window and no browser tab. In testing it used about 50–60 MB of RAM. Rustify stops it when Rustify closes.

When you press play with no active device, Rustify starts the player automatically. **Devices → Play on this computer** does the same. Other Spotify Connect devices remain selectable.

One-time setup on Windows:

1. **Install Soloist.** Spotify does not allow redistributing it, so it is not bundled. Download the Windows build from [Downloads and updates](https://developer.spotify.com/documentation/soloist/reference/downloads-and-updates) and extract it to `%LOCALAPPDATA%\Rustify\soloist\` so that `soloist.exe` is in that folder.
2. **Add the API key.** Generate a Soloist API key on the Spotify for Developers dashboard (Premium account). Put `SOLOIST_API_KEY=...` in `%LOCALAPPDATA%\Rustify\.env`. Rustify also accepts it from the process environment. For development, keep it in the git-ignored `.env.local`. It is not `VITE_`-prefixed, so it never reaches the frontend bundle. Never commit the key.
3. **Pair once.** Run `soloist.exe --pair -n Rustify -k <key> -D %LOCALAPPDATA%\Rustify\soloist-data`, then choose **Rustify** in a Spotify app on the same network. On an iPhone, Spotify needs **Local Network** permission. Using the Spotify desktop app on the same PC is easiest. Soloist saves the session in `soloist-data`, so the Spotify app is never needed again.

**Maintenance:** Spotify expires each Soloist build 90 days after it was built (exit code 10). Rustify then shows a message with the download link. Extract the new build over the old one; pairing is kept. The current build is 1.3.10, built 2026-11-13, and expires around 2027-02-11.

`RUSTIFY_HOME` overrides the `%LOCALAPPDATA%\Rustify` folder. The Linux/WSL build doesn't use Soloist, so on Linux, play through another Spotify device.

**Why not librespot or a browser tab?** The previous design used the Web Playback SDK in a Chrome/Edge tab, which was heavy and fragile; that design was retired. librespot (unofficial) was tried on 2026-11-14. Its login and device registration worked, but Spotify refused audio decryption keys for the test account (`error audio key 0 1`, [librespot#1649](https://github.com/librespot-org/librespot/issues/1649)).

The integration supports account sign-in, paginated playlists and saved tracks, paginated catalog search, album and playlist tracks, playlist creation/editing/add/remove, saved-song actions, device selection, playback, queueing, seek, volume, shuffle and repeat. API failures, unavailable devices and rate limits surface in the UI. Playlist contents can be restricted to owned/collaborative playlists in Development Mode.

Uses the current [2026 API migration](https://developer.spotify.com/documentation/web-api/tutorials/february-2026-migration-guide): playlist `/items`, generalized `/me/library`, and search pages of at most ten results. Saved status is checked independently of the loaded saved-track page.

**Spotify playback supports Rustify's built-in player as well as other Connect devices.** This is not full Spotify parity: podcasts/audiobooks, social features, downloads/offline catalog playback, billing and account management are not implemented, and Spotify's recommendation service is not available to new apps (playlist suggestions are artist-based instead). Live OAuth, catalog/library reads, playlist pagination, device transfer and start/pause have been verified. Typography and feature coverage differ from the Spotify app. Spotify's [Developer Policy](https://developer.spotify.com/policy) requires prior written permission for a product replacing its core experience; API authorization alone does not grant that permission.

## Local music

Six original ambient WAV recordings and original vector covers are bundled. Import MP3, M4A, WAV, OGG, FLAC, AAC or Opus files; actual codec support depends on the platform WebView. Native imports read the embedded title, artist, album, length and cover; files without tags use the filename. Native imports copy audio into app-owned storage, exposed only through a scoped asset protocol. Browser preview stores imported blobs in IndexedDB. Native libraries are validated and written through a temporary file and rename. On WebKit, custom-scheme media is fetched into WebView-owned blob URLs; only the current imported recording is retained in memory. Corrupt libraries are reported without being overwritten.

Local playback supports playlists, track drag/reorder within a playlist, drag tracks to a library playlist, search, likes, history, manual queue, shuffle, repeat all/one, seeking and volume. Local media is not uploaded to Spotify. Escape closes dialogs; dialogs trap keyboard focus.

## Keyboard and song lists

- **Playback:** Space play/pause, Ctrl+←/→ previous/next, Shift+←/→ seek 5 seconds, Ctrl+↑/↓ volume, Ctrl+S shuffle, Ctrl+R repeat, M mute.
- **Navigation:** Alt+←/→ back/forward, Ctrl+L or Ctrl+K search, Ctrl+N new playlist, Ctrl+, settings, Alt+Shift+S Liked Songs, Alt+Shift+H home, Alt+Shift+Q queue, Alt+Shift+D devices, Alt+Shift+B like.
- **Song lists:** a click selects, Ctrl/Shift-click selects several, double-click or Enter plays. Right-click opens the song menu, which acts on the whole selection (queue, add to playlist, remove). Drag a row onto another to reorder a playlist, or onto a playlist in the library to add it.
- **Search and sort in a list:** every playlist, album and Liked Songs has a search box and a sort menu; a filtered or sorted list plays in the order shown.

## Lyrics

The island's arrow opens a lyrics dropdown. Lyrics come from [lrclib.net](https://lrclib.net), a free public database: **opening the dropdown sends the title, artist, album and length of each song you play to that site**; nothing is sent while it is closed. Timed lyrics follow the song line by line.

You can also add your own lyrics for a song (song menu or the Now Playing panel → Add lyrics). They are kept on this computer and replace the lookup for that song. Untimed lyrics scroll on an estimate (the mouse wheel nudges them); **Sync to song** lets you tap as each line starts, which saves exact timings.

## Skip rules, transitions, stats, suggestions and home

- **Skip rules (Settings):** never play chosen artists, genres or explicit songs. Spotify has no genre per song, so a song's genre is its first artist's genres. Rules also apply while Rustify is in the tray.
- **Transitions (Settings):** fade out/in on pause, resume and skip, on Rustify's own player. Two songs cannot overlap; there is one player.
- **Your stats:** Spotify's top artists and songs (4 weeks, 6 months, all time), recently played, and a play log Rustify keeps on this computer. Top music needs the `user-top-read` and `user-read-recently-played` permissions, so sign in again if you connected before they were added.
- **Playlist suggestions:** under a Spotify playlist, suggests more songs by the artists that appear most in it.
- **Home:** Customize hides and reorders the home page sections.

## Running in the background

- **Media keys and Windows media controls.** Play/pause/next/previous keys work from anywhere. The Windows volume flyout and lock screen show the song, artist and cover, and can control playback (`media.rs`). Chromium's own media-key handling is turned off in WebView2 (`additionalBrowserArgs`) so only one Rustify entry appears.
- **Tray.** By default, closing the window hides Rustify to the tray and the music keeps playing. The tray menu has Play/Pause, Next, Previous, Show Rustify, Show/hide island and Quit. Clicking the tray icon reopens the window. Turn this off in Settings to make closing the window quit (`tray.rs`).
- **Global hotkeys.** These work from any app (`hotkeys.rs`), and can be switched off in Settings. A combination another app already owns is skipped, and Rustify says which one.
  - Ctrl+Alt+Space: play/pause
  - Ctrl+Alt+→: next
  - Ctrl+Alt+←: previous
  - Ctrl+Alt+I: show/hide the island
- **Start with Windows.** Off by default; turn it on in Settings. Rustify then starts in the tray at sign-in (`--minimized`), with no window flash.
- **Single instance.** Launching Rustify while it is already running brings up the existing window. Two copies never compete for the Soloist player.
- **Sleep timer.** In Settings: pause after 15/30/60 minutes or at the end of the current song.
- **Free memory in the tray.** On by default. When the window is closed to the tray and nothing needs the page (no True shuffle, sleep timer, island or local playback), the window is destroyed so WebView2 shuts down; `background.rs` then answers media keys, the tray and hotkeys through the Web API and keeps the Windows media controls current. Opening Rustify again rebuilds the window.
- **Low memory mode.** Off by default; applies after a restart. Runs WebView2 without its graphics process. If a window ever fails to draw, start Rustify with `--no-low-memory`.
- **Soloist lifetime.** Soloist runs in a Windows job object, so it ends whenever Rustify ends (including a crash or Task Manager), and leftovers from an earlier run are cleared at startup.

Media keys, the tray, the hotkeys and the island all send the same `media-command` event to the frontend while its window exists; `src/features/system.js` handles it. While the window is unloaded, `background.rs` handles them.

## Island (floating mini player)

The island is a small pill-shaped player that floats above other windows. Turn it on or off with the island button in the player bar or **Alt+I**. Drag it anywhere on screen. It remembers where you put it, and if that monitor is disconnected it goes back to the top center. It shows the cover, title and artist, previous/play/next and a progress line. Click the title to bring Rustify to the front. Hover and click × to hide it. It closes with Rustify and works for both Spotify and local music. Settings has these island options:

- **Compact:** only the spinning cover; hover it for play/pause.
- **Hide while paused.**
- **Opacity:** 100/85/70/50%.
- **Click-through:** clicks reach the window underneath. Turn it off in Settings.
- **Background:** dark, the playing song's cover (blurred), a colour, or your own picture.
- **Like button and lyrics dropdown** (see Lyrics).

How it works: `src-tauri/src/island.rs` creates a frameless, transparent, always-on-top window that is hidden from the taskbar, and saves its position to `island.json` in the app data folder. `island.html` and `src/island.js` only display what they're sent and send commands back. `src/features/island.js` sends it the `player` snapshot and passes its play/next/previous commands to the normal app actions.

## Adding a feature

Rustify is split so that new features don't have to touch the core.

**Frontend.** Put each feature in its own file in `src/features/`:

1. Copy `src/features/template.js` to `src/features/my-feature.js` and give it a unique `name`.
2. In `setup(ctx)`, return the feature's parts:
   - `actions`: buttons with `data-action="name"` call these.
   - `shortcuts`: keyboard shortcuts.
   - Any other functions you return become available to the app as `features.my-feature.<name>`.
3. Add it to the list in `src/features/index.js`.

Features can also add a Settings section with `settings: () => html`, run code once at startup with `start()`, and listen to app events with `on: { player(snapshot) {} }`. That one fires whenever the player bar updates, with `{ title, artist, cover, playing, elapsed, duration, source }`. `src/features/island.js` uses it. `ctx` is the app's API for features. It includes `api(method, path, body)` for Spotify calls and `spotify` for native IPC. It also has the UI helpers `toast`, `openModal`, `closeModal` and `navigate`, the escaping helpers `h` and `icon`, and live read-only state (`remote`, `mode`, `current`, `library`, `generation`). If a feature needs something else, add it to `featureContext` in `src/main.js`. These files are complete examples:

- `src/features/devices.js`: built-in player and device picker
- `src/features/island.js`: floating mini player
- `src/features/system.js`: media keys, tray and hotkeys
- `src/features/sleep.js`: sleep timer
- `src/features/lyrics.js`: your own lyrics and Sync to song
- `src/features/rules.js`: skip rules
- `src/features/transitions.js`: fades
- `src/features/stats.js`: stats page and play log
- `src/features/home.js`: home page layout
- `src/features/suggestions.js`: playlist suggestions

 The registry is covered by `tests/features.test.mjs`. Duplicate action names fail at startup.

**Rust.** Each concern is its own module, listed in `src-tauri/src/lib.rs`: `library`, `spotify`, `credentials`, `shuffle`, `native_player`, and `desktop`. `desktop` holds the Tauri commands. To add a native capability:

1. Write a module.
2. Expose it through a `#[tauri::command]` in `desktop.rs`, and register the command in `generate_handler!`.
3. Call it from the frontend through `src/bridge.js`.

New Spotify Web API endpoints must also be allow-listed in `allowed_url` in `spotify.rs`.

## Structure and verification

- `src-tauri/src/spotify.rs`: Rust PKCE callback, saved-session restoration, token refresh and fixed-host API proxy. No bearer or refresh tokens reach the Tauri frontend.
- `src-tauri/src/native_player.rs`: launches and supervises the hidden Soloist process, finds its Web API device, handles missing install/key, expiry and pairing errors, and kills it on exit.
- `src-tauri/src/bin/player-probe.rs`: dev probe that plays one track on an already-running Rustify device using the saved login.
- `src-tauri/src/credentials.rs`: platform credential stores and the WSL DPAPI bridge.
- `src-tauri/src/library.rs`: validated local library model and atomic storage.
- `src-tauri/src/desktop.rs`: Tauri commands (native import, Spotify, player, island) and app startup.
- `src-tauri/src/island.rs`, `island.html`, `src/island.js`: the floating island window.
- `src-tauri/src/media.rs`, `tray.rs`, `hotkeys.rs`: Windows media controls, tray icon and global hotkeys.
- `src-tauri/src/background.rs`: runs without the page while closed to the tray; skip rules in the tray.
- `src-tauri/src/lyrics.rs`: lyrics lookup (lrclib.net).
- `src/features/`: self-contained frontend features and the feature registry.
- `src/`: vanilla frontend and local-file playback. Local files use the WebView's audio decoder; Spotify audio is played by Soloist.
- `public/`: original artwork, demo recordings and library seed.
- `tests/`: playback ordering and browser interaction tests, including explicitly mocked native IPC for Spotify contracts.

```sh
npm test
npm run test:ui
npm run build
cargo test --manifest-path src-tauri/Cargo.toml
cargo check --manifest-path src-tauri/Cargo.toml --features desktop
```

Playwright requires its Chromium install and Linux dependencies. For an existing compatible browser, set `CHROMIUM_PATH` to its executable. Browser Spotify tests use synthetic IPC responses; they do not verify live OAuth, Spotify service permissions or DRM playback.


On WSL with the WebKitGTK prerequisites installed, native startup, Rust IPC, persisted library round trips, bundled WAV decoding/seek/pause/next, and app-owned audio after a reload have been verified. The OS file-picker interaction and persisted audio across a complete process restart have not been automated.

For the real Linux WebKit smoke check, install `tauri-driver` (`cargo install tauri-driver --locked`) and the distribution's WebKit WebDriver package (`webkitgtk-webdriver` on this Ubuntu version; some distributions name it `webkit2gtk-driver`). Start `tauri-driver --native-driver /path/to/WebKitWebDriver` and run `node tests/native-smoke.mjs` from this directory. The script uses an existing native debug executable, temporarily changes the local library, restores the saved library in cleanup, and captures a screenshot. It tests a managed media file directly; it does not drive the OS picker.

Live Spotify control verification found and fixed two integration defects: bodyless mutation requests now send explicit zero Content-Length, and successful player/library acknowledgements are handled without requiring JSON. JSON-returning catalog and playlist endpoints still require valid JSON.

Saved-login verification: 13 core Rust tests and 12 browser interaction tests passed, plus the explicit WSL DPAPI encryption/decryption/deletion test (`cargo test --manifest-path src-tauri/Cargo.toml --features desktop credentials::tests::wsl_encrypted_round_trip_and_delete -- --ignored`). A live Spotify login restored successfully across two complete native process restarts and refreshed credentials before calling the profile API; neither restart opened browser authorization. System credential-store backends outside WSL remain untested here.


## True shuffle and artist profiles

Global search defaults to All: artists, songs, albums and playlists. The artist Top result and artist cards open a profile with paginated albums/singles. Track artist names also open that profile. Artist top tracks and monthly listeners are not fabricated when unavailable through the authorized API.

True shuffle fetches every page of the selected playlist, album or Liked Songs, deduplicates track URIs, skips unavailable items and creates a Fisher–Yates permutation in Rust using the operating system RNG. Every remaining track has equal odds; automatic traversal has no repeat until the pool ends. Browser/local preview uses cryptographic rejection sampling. Search playback uses its loaded results as a separate pool. Browsing another playlist does not change the active pool; explicitly playing it starts that playlist's pool.

Reshuffle remaining preserves the current track and excludes played tracks. Repeat One and manual queue additions can intentionally repeat. Spotify Repeat All repeats the submitted order; use Reshuffle for a new order. Distinct releases with different track URIs are separate entries; if Spotify collapses them into an ambiguous recording identity, Rustify reports that it cannot verify the order.

Remote playback submits the complete URI list with an explicit position-zero offset and disables native Spotify shuffle. It confirms the current recording and up to 20 queued recordings before reporting success. Regional substitutions are accepted only with matching Spotify ISRC metadata, never a name comparison. A failed confirmation attempts to pause that request's device. The API exposes only a queue prefix: this verifies startup, not uninterrupted playback of the entire collection. External device/context changes invalidate the tracked plan; reconnecting mid-plan does not reconstruct previous listening history.

Saved albums now have their own library view and save/remove actions. Library and Now Playing panels support mouse and keyboard resizing with persisted widths. See the [current media and verification record](../../docs/design/reviews/rustify-shuffle-2026-11-13/README.md) and [feature coverage](FEATURES.md).


## Windows build from WSL

The Windows executable is cross-compiled with `cargo-xwin`. It needs the MSVC SDK (`cargo-xwin` downloads it into its cache), plus clang-cl, lld-link and `llvm-rc` on `PATH`.

```sh
npm run build
cd src-tauri
cargo xwin build --release --target x86_64-pc-windows-msvc --features desktop,custom-protocol --bin spotify-rust
# -> target/x86_64-pc-windows-msvc/release/spotify-rust.exe (rename to Rustify.exe)
```

Soloist verification (2026-11-14): pairing completed, then a track played on the Rustify device through the Web API with no Spotify app or browser open. The new Windows build was driven through UI Automation: Devices → Play on this computer started a windowless Soloist and showed "Listening on Rustify". Closing Rustify also stopped Soloist. Unit tests 22/22, Playwright 37/37 and Rust 17/17 passed. The island was checked on Windows through UI Automation: it opened top-center showing the current Spotify track, closed with its own button, and reopened at the position it was moved to.

Background features were checked on Windows on 2026-11-14:

- Rustify appears in Windows media controls with title, artist and cover.
- The media play/pause key paused and resumed playback, and Ctrl+Alt+→ skipped the track.
- Ctrl+Alt+I opened the island. Compact mode resized it to 68×68, and hide-while-paused hid and re-showed it.
- Click-through set WS_EX_TRANSPARENT, and 50% opacity rendered translucent.
- Closing the window kept Rustify and the music running hidden. A second launch reused the running copy.
- With tray mode off, closing the window exited Rustify and Soloist.
- Not automated: the tray menu items (Windows 11 doesn't expose them to UI Automation) and Start with Windows (it writes the HKCU Run key, so it was left for the user to enable). Run Playwright with `LD_LIBRARY_PATH` pointing at NSS/NSPR libraries when the system lacks them.


## License

MIT. See [LICENSE](LICENSE).
