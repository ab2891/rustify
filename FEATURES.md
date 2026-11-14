# Rustify coverage

| Area | Implemented | Remaining limits |
| --- | --- | --- |
| Authorization | PKCE, encrypted saved refresh credentials, restore, disconnect | Non-WSL credential backends need platform testing |
| Search | All / songs / artists / albums / playlists; category pagination; artist profiles | Spotify ranking and personalized search differ |
| Library | Playlists, liked songs, saved albums; pagination; playlist editing | Availability follows Spotify account/API permissions |
| Artist | Profile image/name, paginated albums and singles, linked album pages | No unavailable top-track, concert, bio or monthly-listener data |
| Playback | Built-in Rustify player (Spotify Soloist, hidden background process), Connect devices, play/pause/skip/seek/volume, queue and repeat | Premium; Soloist must be installed, keyed and paired once, and re-downloaded every ~90 days; Windows only in this build |
| Island | Floating always-on-top mini player (cover, title, prev/play/next, progress), draggable, position remembered, Alt+I | Desktop app only; follows the main window |
| True shuffle | Complete selected collection; unbiased permutation; seen tracking; reshuffle remaining | API queue confirmation covers current + next20; external changes can replace playback |
| Local music | Import, persistent library, playback, playlists, likes, queue | Metadata initially filenames; codecs depend on WebView |
| Desktop layout | Three panels, collapse/resize, Now Playing, collection heroes, keyboard controls | Visual approximation; platform font/window chrome differ |
| Other Spotify surfaces | — | Recommendations, podcasts, audiobooks, lyrics, social, offline catalog and account/billing |

Rust/Tauri handles authorization, credentials, native imports/storage and shuffle generation. The frontend is JavaScript/CSS rendered in Tauri's WebView. This is a working authorized client, not complete Spotify parity.
