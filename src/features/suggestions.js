// Playlist suggestions: songs that might belong in the open Spotify playlist.
// Spotify closed its recommendations service to new apps, so this looks up
// more songs by the artists that appear most in the playlist and leaves out
// what is already there. Nothing is looked up until you ask.

/** The artists that appear most in a list of songs, most frequent first. */
export function commonArtists(tracks, limit = 4, skip = 0) {
  const counts = new Map();
  for (const t of tracks) {
    const name = (t.artist || "").split(",")[0].trim();
    if (name && name !== "Unknown artist") counts.set(name, (counts.get(name) || 0) + 1);
  }
  const names = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([name]) => name);
  // Later rounds move on to the next artists, wrapping around.
  const start = names.length ? (skip * limit) % names.length : 0;
  return [...names.slice(start), ...names.slice(0, start)].slice(0, limit);
}

export default {
  name: "suggestions",
  setup(ctx) {
    let state = { playlist: "", status: "idle", tracks: [], round: 0 };
    const { h } = ctx;
    const shown = () => ctx.isSpotify() && ctx.connected() && ctx.route.type === "playlist";

    function html() {
      if (!shown()) return "";
      const mine = state.playlist === ctx.route.id ? state : { status: "idle", tracks: [] };
      let body = `<button class="white-button" data-action="suggest-load">Suggest songs for this playlist</button>`;
      if (mine.status === "loading") body = `<p class="muted" role="status">Looking for songs…</p>`;
      else if (mine.status === "error") body = `<p class="muted">${h(mine.error)}</p><button class="white-button" data-action="suggest-load">Try again</button>`;
      else if (mine.status === "ready")
        body = mine.tracks.length
          ? `<div class="stats-list">${mine.tracks.map((t) => `<div class="stats-row"><img class="thumb" src="${h(t.cover)}" alt="" loading="lazy"><span class="text"><strong>${h(t.title)}</strong><small>${h(t.artist)}</small></span><button class="white-button" data-action="suggest-add" data-id="${h(t.id)}" aria-label="Add ${h(t.title)} to this playlist">Add</button></div>`).join("")}</div><button class="text-button" data-action="suggest-load">Show different songs</button>`
          : `<p class="muted">Nothing new found for this playlist's artists.</p><button class="text-button" data-action="suggest-load">Try other artists</button>`;
      return `<section class="suggestions" id="suggestions"><div class="section-heading"><h2>Suggested songs</h2></div><p class="muted">More from the artists in this playlist.</p>${body}</section>`;
    }
    function paint() {
      const el = document.querySelector("#suggestions");
      if (el) el.outerHTML = html();
    }
    async function load() {
      const playlist = ctx.route.id;
      const round = state.playlist === playlist ? state.round + 1 : 0;
      const inPlaylist = ctx.viewTracks();
      state = { playlist, status: "loading", tracks: [], round };
      paint();
      try {
        const artists = commonArtists(inPlaylist, 4, round);
        if (!artists.length) throw new Error("Add a few songs first, so there is something to go on.");
        const have = new Set(inPlaylist.map((t) => t.id));
        const haveNames = new Set(inPlaylist.map((t) => `${t.title}|${t.artist}`.toLowerCase()));
        const found = await Promise.all(
          artists.map((name) =>
            ctx.api("GET", `/search?type=track&limit=10&q=${encodeURIComponent(`artist:"${name}"`)}`).then((r) => ctx.cache(r.tracks?.items || [])),
          ),
        );
        // Take songs from each artist in turn, so one artist does not fill the list.
        const picked = [];
        for (let i = 0; picked.length < 8 && found.some((list) => list[i]); i++)
          for (const list of found) {
            const t = list[i];
            const name = t && `${t.title}|${t.artist}`.toLowerCase();
            if (!t || have.has(t.id) || haveNames.has(name) || t.available === false) continue;
            have.add(t.id);
            haveNames.add(name);
            if (picked.length < 8) picked.push(t);
          }
        if (state.playlist !== playlist) return;
        state = { playlist, status: "ready", tracks: picked, round };
      } catch (error) {
        state = { playlist, status: "error", error: error?.message || String(error), tracks: [], round };
      }
      paint();
    }

    return {
      html,
      actions: {
        "suggest-load": load,
        "suggest-add": async (button) => {
          const id = button.dataset.id;
          state.tracks = state.tracks.filter((t) => t.id !== id);
          await ctx.addToPlaylist(ctx.route.id, id);
        },
      },
    };
  },
};
