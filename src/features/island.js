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
const DEFAULTS = { compact: false, hideWhilePaused: false, opacity: 100, clickThrough: false, lyrics: false, background: "dark", color: "#1d3557", image: "" };
// Island backgrounds: plain dark, the playing song's cover (blurred), a colour, or your own picture.
const BACKGROUNDS = [["dark", "Dark"], ["cover", "Album art"], ["color", "Colour"], ["image", "Picture"]];
const COLORS = ["#1d3557", "#3a0ca3", "#7b2cbf", "#9d0208", "#b5651d", "#2d6a4f", "#005f73", "#343a40"];

/** Shrinks a picked picture to the island's size (2x) and returns it as a data URL. */
async function islandPicture(file) {
  const bitmap = await createImageBitmap(file);
  const [width, height] = [760, 136];
  const scale = Math.max(width / bitmap.width, height / bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas
    .getContext("2d")
    .drawImage(bitmap, (width - bitmap.width * scale) / 2, (height - bitmap.height * scale) / 2, bitmap.width * scale, bitmap.height * scale);
  return canvas.toDataURL("image/jpeg", 0.82);
}

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
      const key = `${latest.title}|${latest.artist}|${latest.playing}|${latest.duration}|${options.compact}|${options.opacity}|${options.background}|${options.color}|${latest.liked}|${lyricsOpen()}|${found.get(songKey(latest))?.status}|${found.get(songKey(latest))?.plain?.length}|${found.get(songKey(latest))?.lines?.length}|${found.get(songKey(latest))?.estimated}`;
      const now = Date.now();
      if (!force && key === sentKey && now - sentAt < 500) return;
      sentKey = key;
      sentAt = now;
      island
        .publish({ ...latest, sentAt: now, style: { compact: options.compact, opacity: options.opacity, background: options.background, color: options.color }, lyrics: lyricsState() })
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
        "island-ready": () => { open = true; shown = true; sendPicture(); push(true); },
        "island-closed": () => { open = false; },
        "island-command": (command) => {
          if (COMMANDS.has(command)) ctx.doAction(command).catch(ctx.handleError);
          else if (command === "lyrics") toggleLyrics().catch(ctx.handleError);
          else if (command === "like" && latest?.id) ctx.toggleLike(latest.id).catch(ctx.handleError);
        },
      }));

    async function toggle() {
      await listen();
      await island.configure(native());
      open = await island.toggle();
      shown = true;
      if (open) push(true);
    }

    // The picture is large, so it travels once (and on change), not with every update.
    const sendPicture = () => island.background(options.background === "image" ? options.image : "").catch(() => {});

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

    // Opens the file picker; the chosen picture becomes the island's background.
    function pickPicture() {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = "image/*";
      input.addEventListener("change", async () => {
        const file = input.files?.[0];
        if (!file) return;
        try {
          await change({ background: "image", image: await islandPicture(file) });
          sendPicture();
        } catch {
          ctx.toast("That picture could not be used. Try a JPG or PNG.", true);
        }
      });
      input.click();
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
        "island-background": async (button) => {
          const background = button.dataset.value;
          if (background === "image" && !options.image) return pickPicture();
          await change({ background });
          sendPicture();
        },
        "island-color": (button) => change({ background: "color", color: button.dataset.value }),
        "island-picture": () => pickPicture(),
      },
      shortcuts: [{ key: "i", alt: true, run: () => toggle().catch(ctx.handleError) }],
      on: { player(snapshot) { latest = snapshot; push(); } },
      settings: () =>
        `<div class="setting-group"><h3>Island</h3>${row("Show island", "A floating mini player you can drag anywhere. Also Alt+I or Ctrl+Alt+I.", chip(open, "island", open ? "Shown" : "Hidden"))}${row("Compact", "Only the cover; hover it for play/pause.", chip(options.compact, "island-compact"))}${row("Hide while paused", "The island disappears when nothing is playing.", chip(options.hideWhilePaused, "island-hide-paused"))}${row("Opacity", "How see-through the island is.", `<div class="chips">${OPACITIES.map((o) => `<button class="chip ${options.opacity === o ? "selected" : ""}" data-action="island-opacity" data-value="${o}" aria-pressed="${options.opacity === o}">${o}%</button>`).join("")}</div>`)}${row("Background", "What the island looks like behind the song.", `<div class="chips">${BACKGROUNDS.map(([value, label]) => `<button class="chip ${options.background === value ? "selected" : ""}" data-action="island-background" data-value="${value}" aria-pressed="${options.background === value}">${label}</button>`).join("")}</div>`)}${options.background === "color" ? row("Colour", "", `<div class="chips">${COLORS.map((c) => `<button class="chip swatch ${options.color === c ? "selected" : ""}" data-action="island-color" data-value="${c}" style="background:${c}" aria-label="Colour ${c}" aria-pressed="${options.color === c}"></button>`).join("")}</div>`) : ""}${options.background === "image" ? row("Picture", "Shown behind the song, darkened so the text stays readable.", `<button class="white-button" data-action="island-picture">Choose another picture</button>`) : ""}${row("Click-through", "Clicks pass through to whatever is underneath. Turn this off here to move or use it again.", chip(options.clickThrough, "island-click-through"))}</div>`,
    };
  },
};
