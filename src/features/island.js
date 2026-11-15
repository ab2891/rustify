// Island: a small floating mini player (separate always-on-top window) that
// can be dragged anywhere on screen. Toggle with the player-bar button, Alt+I
// or Ctrl+Alt+I. Options (compact, hide while paused, opacity, click-through)
// live in Settings. The island's arrow opens a lyrics dropdown; lyrics are
// looked up (lrclib.net) only while that dropdown is open.
import { island, lyrics as lyricsService } from "../bridge.js";
import { parseLRC, customLyrics, estimateLines } from "../lyrics.js";

const COMMANDS = new Set(["play", "next", "previous"]);
const KEY = "rustify-island";
const OPACITIES = [100, 85, 70, 50];
const DEFAULTS = { compact: false, hideWhilePaused: false, opacity: 100, clickThrough: false, lyrics: false };

function load() {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || "{}") };
  } catch {
    return { ...DEFAULTS };
  }
}

export default {
  name: "island",
  setup(ctx) {
    const options = load();
    let open = false;
    let listening = null;
    let latest = null;
    let sentKey = "";
    let sentAt = 0;
    let shown = true;

    const lyricsOpen = () => options.lyrics && !options.compact;
    const native = () => ({ compact: options.compact, click_through: options.clickThrough, lyrics: lyricsOpen() });

    // Lyrics per song: { status: "loading" | "ready" | "none" | "error", lines, plain }.
    const found = new Map();
    const songKey = (s) => (s?.title ? `${s.title}|${s.artist}|${Math.round(s.duration || 0)}` : "");
    // Lyrics without timings scroll on an estimate (see estimateLines).
    function untimed(text, own) {
      const lines = estimateLines(text, latest?.duration);
      return lines.length ? { status: "ready", lines, estimated: true, own } : { status: "ready", plain: text, own };
    }
    function loadLyrics() {
      const key = songKey(latest);
      if (!open || !lyricsOpen() || !key || found.has(key)) return;
      // Lyrics you added yourself come first and need no lookup.
      const own = customLyrics.get(latest);
      if (own) {
        const lines = parseLRC(own);
        found.set(key, lines.length ? { status: "ready", lines } : untimed(own, true));
        return;
      }
      found.set(key, { status: "loading" });
      const { title, artist, album, duration } = latest;
      lyricsService
        // Spotify joins several artists with commas; the first one finds the song.
        .fetch({ title, artist: artist.split(",")[0].trim(), album, duration })
        .then((result) => {
          const lines = parseLRC(result?.synced);
          if (lines.length) found.set(key, { status: "ready", lines });
          else if (result?.plain) found.set(key, untimed(result.plain, false));
          else found.set(key, { status: "none", instrumental: Boolean(result?.instrumental) });
        })
        .catch(() => {
          found.set(key, { status: "error" });
          // Let a later song change or reopen try again.
          setTimeout(() => found.get(key)?.status === "error" && found.delete(key), 15000);
        })
        .finally(() => push(true));
    }
    const lyricsState = () => (lyricsOpen() ? { key: songKey(latest), ...(found.get(songKey(latest)) || { status: "loading" }) } : null);

    function push(force = false) {
      if (!open || !latest) return;
      syncVisibility();
      loadLyrics();
      // Track/play/style changes go out at once; position updates at most twice a second.
      const key = `${latest.title}|${latest.artist}|${latest.playing}|${latest.duration}|${options.compact}|${options.opacity}|${lyricsOpen()}|${found.get(songKey(latest))?.status}|${found.get(songKey(latest))?.plain?.length}|${found.get(songKey(latest))?.lines?.length}|${found.get(songKey(latest))?.estimated}`;
      const now = Date.now();
      if (!force && key === sentKey && now - sentAt < 500) return;
      sentKey = key;
      sentAt = now;
      island
        .publish({ ...latest, sentAt: now, style: { compact: options.compact, opacity: options.opacity }, lyrics: lyricsState() })
        .catch(() => {});
    }

    // "Hide while paused" hides the window instead of closing it.
    function syncVisibility() {
      const visible = !options.hideWhilePaused || Boolean(latest?.playing);
      if (visible === shown) return;
      shown = visible;
      island.setVisible(visible).catch(() => {});
    }

    const listen = () =>
      (listening ??= island.listen({
        "island-ready": () => { open = true; shown = true; push(true); },
        "island-closed": () => { open = false; },
        "island-command": (command) => {
          if (COMMANDS.has(command)) ctx.doAction(command).catch(ctx.handleError);
          else if (command === "lyrics") toggleLyrics().catch(ctx.handleError);
        },
      }));

    async function toggle() {
      await listen();
      await island.configure(native());
      open = await island.toggle();
      shown = true;
      if (open) push(true);
    }

    async function toggleLyrics() {
      options.lyrics = !options.lyrics;
      localStorage.setItem(KEY, JSON.stringify(options));
      await island.configure(native());
      push(true);
    }

    async function change(update) {
      Object.assign(options, update);
      localStorage.setItem(KEY, JSON.stringify(options));
      await island.configure(native());
      push(true);
      ctx.openSettings();
    }

    const chip = (on, action, label = on ? "On" : "Off") =>
      `<button class="chip ${on ? "selected" : ""}" data-action="${action}" aria-pressed="${on}">${label}</button>`;
    const row = (title, text, control) =>
      `<div class="setting-row"><div><strong>${title}</strong><p>${text}</p></div>${control}</div>`;

    return {
      toggle,
      isOpen: () => open,
      /** Called after lyrics were added or removed by hand. */
      refreshLyrics() { found.clear(); push(true); },
      options: () => ({ ...options }),
      actions: {
        island: toggle,
        "island-compact": () => change({ compact: !options.compact }),
        "island-hide-paused": () => change({ hideWhilePaused: !options.hideWhilePaused }),
        "island-click-through": () => change({ clickThrough: !options.clickThrough }),
        "island-opacity": (button) => change({ opacity: Number(button.dataset.value) }),
      },
      shortcuts: [{ key: "i", alt: true, run: () => toggle().catch(ctx.handleError) }],
      on: { player(snapshot) { latest = snapshot; push(); } },
      settings: () =>
        `<div class="setting-group"><h3>Island</h3>${row("Show island", "A floating mini player you can drag anywhere. Also Alt+I or Ctrl+Alt+I.", chip(open, "island", open ? "Shown" : "Hidden"))}${row("Compact", "Only the cover; hover it for play/pause.", chip(options.compact, "island-compact"))}${row("Hide while paused", "The island disappears when nothing is playing.", chip(options.hideWhilePaused, "island-hide-paused"))}${row("Opacity", "How see-through the island is.", `<div class="chips">${OPACITIES.map((o) => `<button class="chip ${options.opacity === o ? "selected" : ""}" data-action="island-opacity" data-value="${o}" aria-pressed="${options.opacity === o}">${o}%</button>`).join("")}</div>`)}${row("Click-through", "Clicks pass through to whatever is underneath. Turn this off here to move or use it again.", chip(options.clickThrough, "island-click-through"))}</div>`,
    };
  },
};
