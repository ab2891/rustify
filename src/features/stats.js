// Stats: what you listen to. Two sources:
//  - Spotify's own "top artists / top songs / recently played" for the account
//    (needs the sign-in to include those permissions);
//  - a small play log Rustify keeps on this computer while its window is
//    loaded (plays and listening time per song).
const KEY = "rustify-plays";
const RANGES = [["short_term", "Last 4 weeks"], ["medium_term", "Last 6 months"], ["long_term", "All time"]];

/** Adds listening time to the log; a song counts as played after 30 s. */
export function record(log, song, seconds, session) {
  const entry = (log.songs[song.id] ||= { ...song, plays: 0, seconds: 0 });
  Object.assign(entry, song);
  entry.seconds += seconds;
  entry.last = Date.now();
  log.seconds += seconds;
  if (session.id !== song.id) Object.assign(session, { id: song.id, heard: 0, counted: false });
  session.heard += seconds;
  if (!session.counted && session.heard >= 30) {
    session.counted = true;
    entry.plays += 1;
    log.plays += 1;
  }
}

export default {
  name: "stats",
  setup(ctx) {
    let log = { songs: {}, seconds: 0, plays: 0 };
    try { log = { ...log, ...JSON.parse(localStorage.getItem(KEY) || "{}") }; } catch { /* start fresh */ }
    const session = { id: "", heard: 0, counted: false };
    let lastTick = 0;
    let lastSave = 0;
    let range = "short_term";
    let remote = null; // { artists, tracks, recent } | { error }
    let loading = false;

    function persist() {
      // Keep the 400 most listened songs.
      const kept = Object.values(log.songs).sort((a, b) => b.seconds - a.seconds).slice(0, 400);
      log.songs = Object.fromEntries(kept.map((s) => [s.id, s]));
      localStorage.setItem(KEY, JSON.stringify(log));
    }
    function tick(now) {
      const time = Date.now();
      const gap = (time - lastTick) / 1000;
      lastTick = time;
      if (!now.playing || !now.id || !(gap > 0) || gap > 3) return;
      const { id, uri, title, artist, album, cover, duration, source } = now;
      record(log, { id, uri, title, artist, album, cover, duration, spotify: source === "spotify" }, gap, session);
      if (time - lastSave > 15000) {
        lastSave = time;
        persist();
      }
    }

    const { h } = ctx;
    const songs = () => Object.values(log.songs);
    const hours = (seconds) => (seconds >= 3600 ? `${(seconds / 3600).toFixed(1)} hours` : `${Math.round(seconds / 60)} minutes`);
    const row = (t, i, note = "") =>
      `<button class="stats-row" data-action="stats-play" data-id="${h(t.id)}"><span class="rank">${i + 1}</span><img class="thumb" src="${h(t.cover || "/art/local.svg")}" alt="" loading="lazy"><span class="text"><strong>${h(t.title)}</strong><small>${h(t.artist)}</small></span><small>${h(note)}</small></button>`;
    const card = (t) =>
      `<button class="album-card" data-action="stats-play" data-id="${h(t.id)}"><div class="cover-wrap"><img class="thumb" src="${h(t.cover || "/art/local.svg")}" alt="" loading="lazy"><span class="card-play">${ctx.icon("play")}</span></div><h3>${h(t.title)}</h3><p>${h(t.artist)}</p></button>`;
    // Only songs from the source being shown can be played.
    const mine = () => songs().filter((s) => Boolean(s.spotify) === ctx.isSpotify());

    function remoteHTML() {
      if (!ctx.isSpotify()) return "";
      const chips = `<div class="chips">${RANGES.map(([value, label]) => `<button class="chip ${range === value ? "selected" : ""}" data-action="stats-range" data-value="${value}">${label}</button>`).join("")}</div>`;
      if (!ctx.connected()) return `<section><h2>On Spotify</h2><p class="muted">Connect to Spotify to see your top artists and songs.</p></section>`;
      if (!remote) return `<section><h2>On Spotify</h2>${chips}<p class="muted" role="status">Loading your top music…</p></section>`;
      if (remote.error)
        return `<section><h2>On Spotify</h2><p class="muted">Spotify did not share your top music: ${h(remote.error)} If you signed in before this page existed, disconnect in Settings and sign in again so Rustify can ask for that permission.</p></section>`;
      return `<section><h2>On Spotify</h2>${chips}<h3>Top artists</h3><div class="card-grid">${remote.artists.map((a) => `<button class="album-card artist-card" data-route="artist" data-id="${h(a.id)}"><div class="cover-wrap"><img class="thumb" src="${h(a.cover)}" alt="" loading="lazy"></div><h3>${h(a.name)}</h3><p>${h(a.genres)}</p></button>`).join("") || '<p class="muted">Nothing yet.</p>'}</div><h3>Top songs</h3><div class="stats-list">${remote.tracks.map((t, i) => row(t, i)).join("") || '<p class="muted">Nothing yet.</p>'}</div><h3>Recently played</h3><div class="stats-list">${remote.recent.map((t, i) => row(t, i)).join("") || '<p class="muted">Nothing yet.</p>'}</div></section>`;
    }
    function localHTML() {
      const top = mine().sort((a, b) => b.plays - a.plays || b.seconds - a.seconds).slice(0, 10);
      return `<section><h2>On Rustify</h2><div class="stats-tiles"><div><strong>${hours(log.seconds)}</strong><span>listened</span></div><div><strong>${log.plays}</strong><span>songs played</span></div><div><strong>${songs().length}</strong><span>different songs</span></div></div><p class="muted">Counted on this computer while Rustify's window is loaded (not while it is unloaded in the tray).</p><h3>Most played</h3><div class="stats-list">${top.map((t, i) => row(t, i, `${t.plays} ${t.plays === 1 ? "play" : "plays"} · ${hours(t.seconds)}`)).join("") || '<p class="muted">Play some music and it will show up here.</p>'}</div>${songs().length ? '<button class="text-button" data-action="stats-clear">Clear Rustify\'s play log</button>' : ""}</section>`;
    }
    const page = () => `<div class="content-body stats-page"><div class="section-heading"><h1>Your stats</h1></div><div id="stats-remote">${remoteHTML()}</div>${localHTML()}</div>`;

    async function load() {
      if (!ctx.isSpotify() || !ctx.connected() || loading) return;
      loading = true;
      const wanted = range;
      try {
        const [artists, tracks, recent] = await Promise.all([
          ctx.api("GET", `/me/top/artists?time_range=${wanted}&limit=10`),
          ctx.api("GET", `/me/top/tracks?time_range=${wanted}&limit=10`),
          ctx.api("GET", "/me/player/recently-played?limit=10"),
        ]);
        const seen = new Set();
        remote = {
          artists: (artists.items || []).map((a) => ({ id: a.id, name: a.name, cover: ctx.safeImage((a.images?.[1] || a.images?.[0])?.url), genres: (a.genres || []).slice(0, 2).join(", ") })),
          tracks: ctx.cache(tracks.items || []),
          recent: ctx.cache((recent.items || []).map((i) => i.track)).filter((t) => !seen.has(t.id) && seen.add(t.id)),
        };
      } catch (error) {
        remote = { error: `${error?.message || error}` };
      } finally {
        loading = false;
      }
      if (wanted !== range) return load();
      const el = document.querySelector("#stats-remote");
      if (el) el.innerHTML = remoteHTML();
    }

    async function play(button) {
      const id = button.dataset.id;
      const list = button.closest(".stats-list, .card-grid");
      const ids = list ? [...list.querySelectorAll("[data-action='stats-play']")].map((b) => b.dataset.id) : [id];
      // Songs from the play log may not be loaded in this session yet.
      for (const one of ids) if (!ctx.trackById(one) && log.songs[one]?.spotify && ctx.isSpotify()) ctx.remember(log.songs[one]);
      const tracks = ids.map((one) => ctx.trackById(one)).filter(Boolean);
      if (!ctx.trackById(id)) throw new Error("This song is not available here.");
      await ctx.playTrack(id, tracks, false);
    }

    return {
      page,
      load,
      /** Home page sections (see features/home.js). */
      recentHTML: () => {
        const recent = mine().sort((a, b) => (b.last || 0) - (a.last || 0)).slice(0, 6);
        return recent.length ? `<div class="card-grid">${recent.map(card).join("")}</div>` : "";
      },
      topHTML: () => {
        const top = mine().filter((s) => s.plays > 0).sort((a, b) => b.plays - a.plays).slice(0, 6);
        return top.length ? `<div class="card-grid">${top.map(card).join("")}</div>` : "";
      },
      on: { player: tick },
      actions: {
        stats: () => ctx.navigate({ type: "stats" }),
        "stats-range": (button) => {
          range = button.dataset.value;
          remote = null;
          const el = document.querySelector("#stats-remote");
          if (el) el.innerHTML = remoteHTML();
          return load();
        },
        "stats-play": play,
        "stats-clear": () => {
          log = { songs: {}, seconds: 0, plays: 0 };
          persist();
          ctx.renderContent();
          ctx.toast("Play log cleared.");
        },
      },
    };
  },
};
