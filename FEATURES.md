# Rustify coverage

| Area | Implemented | Remaining limits |
| --- | --- | --- |
| Authorization | PKCE, encrypted saved refresh credentials, restore, disconnect | Non-WSL credential backends need platform testing |
| Search | All / songs / artists / albums / playlists; category pagination; artist profiles | Spotify ranking and personalized search differ |
| Library | Playlists, liked songs, saved albums; pagination; playlist editing | Availability follows Spotify account/API permissions |
| Artist | Profile image/name, paginated albums and singles, linked album pages | No unavailable top-track, concert, bio or monthly-listener data |
| Playback | Built-in Rustify player (Spotify Soloist, hidden background process), Connect devices, play/pause/skip/seek/volume, queue and repeat | Premium; Soloist must be installed, keyed and paired once, and re-downloaded every ~90 days (Rustify warns 14 days ahead and shows the date in Settings); Windows only in this build |
| Island | Floating always-on-top mini player (cover, title, prev/play/next, progress), draggable, position remembered; compact, hide-while-paused, opacity, click-through; like button; backgrounds (dark, album art, colour, your own picture); lyrics dropdown (timed when available) | Desktop app only; follows the main window. Lyrics come from lrclib.net: opening the dropdown sends the song's title, artist, album and length there |
| Background | Windows media controls and media keys, tray with close-to-tray, global hotkeys, start with Windows, single instance, sleep timer | Windows (media controls are Windows-only in this build) |
| True shuffle | Complete selected collection; unbiased permutation; seen tracking; reshuffle remaining | API queue confirmation covers current + next20; external changes can replace playback |
| Local music | Import with embedded title/artist/album/cover, persistent library, playback, playlists, likes, queue | Files without tags use the filename; codecs depend on WebView |
| Song lists | Click selects, Ctrl/Shift-click multi-selects, double-click or Enter plays; right-click menu; queue/add/remove a selection; drag onto a playlist; drag to reorder a playlist (Spotify and local) | Reordering needs a playlist you can edit; one song is moved per drag |
| Desktop layout | Three panels, collapse/resize, Now Playing, collection heroes, keyboard controls | Visual approximation; platform font/window chrome differ |
| Skip rules | Never play chosen artists, genres (by the artist's genres) or explicit songs; also applied in the tray | A blocked song can play for a few seconds before it is skipped; genres come from the song's first artist |
| Transitions | Fade out/in on pause, resume and skip (Short/Medium/Long) on Rustify's own player | No overlap between two songs (true crossfade): there is one player |
| Stats | Spotify top artists/songs (4 weeks, 6 months, all time), recently played; Rustify's own play log | Top music needs a sign-in made after this was added; the play log only counts while the window is loaded |
| Home | Sections can be hidden and reordered (Customize); recently played and most played from the play log | — |
| Playlist suggestions | More songs by the playlist's most common artists, minus what is already there | Spotify's recommendation service is closed to new apps, so this is artist-based |
| In-list search and sort | Filter the open list; sort by title, artist, album, length or recently added | Works on the songs loaded so far; reordering is off while filtered or sorted |
| Other Spotify surfaces | — | Recommendations, podcasts, audiobooks, social, offline catalog and account/billing |

Rust/Tauri handles authorization, credentials, native imports/storage and shuffle generation. The frontend is JavaScript/CSS rendered in Tauri's WebView. This is a working authorized client, not complete Spotify parity.
