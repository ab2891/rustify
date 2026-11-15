// Skip rules: things that should never play. Songs by blocked artists, songs
// whose artist has a blocked genre, and (optionally) explicit songs are skipped
// as soon as they start. Spotify has no genre per song, so a song's genre is
// its first artist's genres. The same rules are handed to Rust so they keep
// working while Rustify is unloaded in the tray.
import { system } from "../bridge.js";

const KEY = "rustify-skip-rules";
const GENRES = "rustify-artist-genres";

function read(key, fallback) {
  try {
    return { ...fallback, ...JSON.parse(localStorage.getItem(key) || "{}") };
  } catch {
    return { ...fallback };
  }
}

/** True when one of the artist's genres contains a blocked genre word. */
export function genreBlocked(genres, blocked) {
  return (genres || []).some((g) => blocked.some((b) => b && g.toLowerCase().includes(b)));
}

export default {
  name: "rules",
  setup(ctx) {
    const rules = read(KEY, { explicit: false, artists: [], genres: [] });
    const known = read(GENRES, {}); // artist id -> genres
    let checked = "";
    let streak = 0;
    let shown = null; // { name, genres } of the artist last looked up in Settings

    const active = () => rules.explicit || rules.artists.length > 0 || rules.genres.length > 0;
    function save() {
      localStorage.setItem(KEY, JSON.stringify(rules));
      system.setSkipRules(active() ? { explicit: rules.explicit, artists: rules.artists.map((a) => a.id), genres: rules.genres } : null).catch(() => {});
    }
    async function genresOf(artistId) {
      if (!artistId) return [];
      if (known[artistId]) return known[artistId];
      const artist = await ctx.api("GET", `/artists/${encodeURIComponent(artistId)}`);
      known[artistId] = artist.genres || [];
      const ids = Object.keys(known);
      // Keep the cache small.
      if (ids.length > 600) for (const id of ids.slice(0, 200)) delete known[id];
      localStorage.setItem(GENRES, JSON.stringify(known));
      return known[artistId];
    }
    /** Why this song may not play, or "" when it may. */
    async function reason(now) {
      if (rules.explicit && now.explicit) return "explicit";
      if (now.artistId && rules.artists.some((a) => a.id === now.artistId)) return "blocked artist";
      if (rules.genres.length && now.artistId && genreBlocked(await genresOf(now.artistId), rules.genres)) return "blocked genre";
      return "";
    }
    async function check(now) {
      if (!active() || now.source !== "spotify" || !now.playing || !now.id || now.id === checked) return;
      checked = now.id;
      const why = await reason(now);
      if (!why) {
        streak = 0;
        return;
      }
      // A playlist made only of blocked songs must not skip forever.
      if (++streak > 8) {
        ctx.toast("Skip rules blocked several songs in a row; playing this one.", true);
        return;
      }
      ctx.toast(`Skipped "${now.title}" (${why}).`);
      await ctx.doAction("next");
    }

    const { h } = ctx;
    const chip = (on, action) =>
      `<button class="chip ${on ? "selected" : ""}" data-action="${action}" aria-pressed="${on}">${on ? "On" : "Off"}</button>`;
    const removable = (label, action, value) =>
      `<button class="chip selected" data-action="${action}" data-value="${h(value)}" aria-label="Remove ${h(label)}">${h(label)} ✕</button>`;

    return {
      active,
      blocksArtist: (id) => rules.artists.some((a) => a.id === id),
      start: save,
      on: { player(now) { check(now).catch(() => {}); } },
      actions: {
        "rules-explicit": () => { rules.explicit = !rules.explicit; save(); ctx.openSettings(); },
        "rules-add-genre": () => {
          const value = document.querySelector("#rules-genre")?.value.trim().toLowerCase();
          if (!value) throw new Error("Type a genre first, for example: country.");
          if (!rules.genres.includes(value)) rules.genres.push(value);
          save();
          ctx.openSettings();
        },
        "rules-block-genre": (button) => {
          if (!rules.genres.includes(button.dataset.value)) rules.genres.push(button.dataset.value);
          save();
          ctx.openSettings();
        },
        "rules-remove-genre": (button) => { rules.genres = rules.genres.filter((g) => g !== button.dataset.value); save(); ctx.openSettings(); },
        "rules-remove-artist": (button) => { rules.artists = rules.artists.filter((a) => a.id !== button.dataset.value); save(); ctx.openSettings(); },
        // From a song's menu: never play this artist again (or allow them again).
        "rules-block-artist": (button) => {
          const track = ctx.trackById(button.dataset.id);
          if (!track?.artistId) throw new Error("This song has no Spotify artist to block.");
          const name = track.artist.split(",")[0].trim();
          if (rules.artists.some((a) => a.id === track.artistId)) {
            rules.artists = rules.artists.filter((a) => a.id !== track.artistId);
            ctx.toast(`${name} can play again.`);
          } else {
            rules.artists.push({ id: track.artistId, name });
            ctx.toast(`${name} will be skipped from now on.`);
            checked = "";
          }
          save();
        },
        // Spotify's genre names are not obvious; show the playing artist's.
        "rules-show-genres": async () => {
          const now = ctx.current;
          if (!now?.artistId) throw new Error("Play a Spotify song first.");
          shown = { name: now.artist.split(",")[0].trim(), genres: await genresOf(now.artistId) };
          ctx.openSettings();
        },
      },
      settings: () =>
        `<div class="setting-group"><h3>Skip rules</h3><div class="setting-row"><div><strong>Skip explicit songs</strong><p>Songs Spotify marks as explicit are skipped when they start.</p></div>${chip(rules.explicit, "rules-explicit")}</div><div class="setting-row"><div><strong>Blocked genres</strong><p>Songs by artists in these genres are skipped. A word matches any genre containing it ("metal" also blocks "death metal").</p><div class="chips">${rules.genres.map((g) => removable(g, "rules-remove-genre", g)).join("") || '<span class="muted">None</span>'}</div><div class="rules-add"><input id="rules-genre" placeholder="Genre, e.g. country" maxlength="40"><button class="white-button" data-action="rules-add-genre">Block</button><button class="text-button" data-action="rules-show-genres">Genres of the artist playing now</button></div>${shown ? `<p>${h(shown.name)}: ${shown.genres.length ? shown.genres.map((g) => `<button class="chip" data-action="rules-block-genre" data-value="${h(g.toLowerCase())}">${h(g)}</button>`).join(" ") : "Spotify lists no genres for this artist."}</p>` : ""}</div></div><div class="setting-row"><div><strong>Blocked artists</strong><p>Add one from a song's menu: "Never play this artist".</p><div class="chips">${rules.artists.map((a) => removable(a.name, "rules-remove-artist", a.id)).join("") || '<span class="muted">None</span>'}</div></div></div></div>`,
    };
  },
};
