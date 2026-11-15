// The floating island window (see src-tauri/src/island.rs and features/island.js).
// It only displays state and sends commands; the main window does the work.
import "./island.css";
import { invoke } from "@tauri-apps/api/core";
import { emitTo, listen } from "@tauri-apps/api/event";
import { icon } from "./icons.js";
import { escapeHTML as h } from "./player.js";
import { currentLine } from "./lyrics.js";

const root = document.querySelector("#island");
const panel = document.querySelector("#lyrics");
let shownLine = -2;
let picture = ""; // custom background picture (data URL), sent by the main window
// Estimated lyrics can be nudged with the mouse wheel; seconds, per song.
let nudge = 0;
let nudgeKey = "";
let state = null;
let receivedAt = 0;

function position() {
  if (!state?.duration) return 0;
  const moved = state.playing ? (Date.now() - receivedAt) / 1000 : 0;
  return Math.min(state.duration, state.elapsed + moved);
}

function render() {
  const style = state?.style || {};
  document.documentElement.style.setProperty("--opacity", String((style.opacity ?? 100) / 100));
  document.body.classList.toggle("compact", Boolean(style.compact));
  // Background: dark (default), the song's cover, a colour or the user's picture.
  const background = style.background || "dark";
  const image = background === "cover" ? state?.cover : background === "image" ? picture : "";
  document.body.dataset.background = image || background === "color" ? background : "dark";
  root.style.setProperty("--bg-image", image ? `url("${String(image).replace(/["\\\n]/g, "")}")` : "none");
  root.style.setProperty("--bg-color", style.color || "#1d3557");
  renderLyrics();
  if (style.compact) {
    root.className = `island${state?.playing ? " playing" : ""}`;
    root.innerHTML = `${state?.cover ? `<img class="cover" src="${h(state.cover)}" alt="">` : `<div class="cover"></div>`}${state?.title ? `<button class="play overlay" data-command="play" aria-label="${state.playing ? "Pause" : "Play"}" title="${h(state.title)} · ${h(state.artist)}">${icon(state.playing ? "pause" : "play")}</button>` : ""}`;
    return;
  }
  if (!state?.title) {
    root.className = "island";
    root.innerHTML = `<span class="empty" data-tauri-drag-region>Nothing playing. Pick something in Rustify.</span>${closeButton()}`;
    return;
  }
  root.className = `island${state.playing ? " playing" : ""}`;
  root.innerHTML = `${state.cover ? `<img class="cover" src="${h(state.cover)}" alt="">` : `<div class="cover"></div>`}<button class="text" data-command="show-main" title="Open Rustify"><strong>${h(state.title)}</strong><small>${h(state.artist)}</small></button><div class="controls">${state.id ? `<button class="like${state.liked ? " on" : ""}" data-command="like" aria-label="${state.liked ? "Remove from" : "Add to"} Liked Songs" aria-pressed="${Boolean(state.liked)}">${icon(state.liked ? "check" : "heart")}</button>` : ""}<button data-command="previous" aria-label="Previous track">${icon("previous")}</button><button class="play" data-command="play" aria-label="${state.playing ? "Pause" : "Play"}">${icon(state.playing ? "pause" : "play")}</button><button data-command="next" aria-label="Next track">${icon("next")}</button><button class="lyrics-toggle" data-command="lyrics" aria-label="${state.lyrics ? "Hide lyrics" : "Show lyrics"}" aria-expanded="${Boolean(state.lyrics)}" title="Lyrics">${icon(state.lyrics ? "up" : "down")}</button></div>${closeButton()}<div class="progress"><span></span></div>`;
  tick();
}

const closeButton = () => `<button class="close" data-command="close" aria-label="Hide island">${icon("close")}</button>`;

// The lyrics dropdown under the pill. Timed lyrics follow the song; plain
// lyrics are a scrollable text.
function renderLyrics() {
  const lyrics = state?.style?.compact || !state?.title ? null : state?.lyrics;
  panel.hidden = !lyrics;
  shownLine = -2;
  if (!lyrics) {
    panel.innerHTML = "";
    return;
  }
  if (lyrics.key !== nudgeKey) {
    nudge = 0;
    nudgeKey = lyrics.key;
  }
  if (lyrics.lines?.length)
    panel.innerHTML = `<div class="lines${lyrics.estimated ? " estimated" : ""}">${lyrics.lines.map((line) => `<p>${h(line.text) || "♪"}</p>`).join("")}</div>`;
  else if (lyrics.plain)
    panel.innerHTML = `<div class="plain">${lyrics.own ? "" : "<small>These lyrics are not timed to the song.</small>"}${h(lyrics.plain)}</div>`;
  else
    panel.innerHTML = `<p class="note">${lyrics.status === "loading" ? "Finding lyrics…" : lyrics.status === "error" ? "Could not load lyrics. Check your connection." : lyrics.instrumental ? "This song is instrumental." : "No lyrics found for this song."}</p>`;
  tick();
}

function tick() {
  const bar = root.querySelector(".progress span");
  if (bar) bar.style.setProperty("--pct", `${state?.duration ? (position() / state.duration) * 100 : 0}%`);
  const lines = state?.lyrics?.lines;
  const list = panel.querySelector(".lines");
  if (!lines?.length || !list) return;
  const index = currentLine(lines, position() + (state.lyrics.estimated ? nudge : 0));
  if (index === shownLine) return;
  list.querySelector(".now")?.classList.remove("now");
  const line = list.children[Math.max(index, 0)];
  if (index >= 0) line.classList.add("now");
  // Keep the current line in the middle of the dropdown.
  panel.scrollTo({ top: line.offsetTop - panel.clientHeight / 2 + line.offsetHeight / 2, behavior: shownLine === -2 ? "auto" : "smooth" });
  shownLine = index;
}

document.addEventListener("contextmenu", (event) => event.preventDefault());
// Estimated lyrics drift; the wheel moves them a line's worth earlier or later.
panel.addEventListener("wheel", (event) => {
  if (!state?.lyrics?.estimated) return;
  event.preventDefault();
  nudge += Math.sign(event.deltaY) * 2.5;
  tick();
}, { passive: false });
document.addEventListener("click", async (event) => {
  const command = event.target.closest("[data-command]")?.dataset.command;
  if (!command) return;
  if (command === "close") await invoke("island_toggle");
  else if (command === "show-main") await invoke("island_show_main");
  else await emitTo("main", "island-command", command);
});

await listen("island-state", (event) => {
  const next = event.payload;
  const changed =
    !state ||
    ["title", "artist", "cover", "playing", "liked", "id"].some((k) => state[k] !== next[k]) ||
    JSON.stringify(state.style) !== JSON.stringify(next.style) ||
    state.lyrics?.key !== next.lyrics?.key ||
    state.lyrics?.status !== next.lyrics?.status ||
    state.lyrics?.plain !== next.lyrics?.plain ||
    state.lyrics?.lines?.length !== next.lyrics?.lines?.length ||
    state.lyrics?.estimated !== next.lyrics?.estimated;
  state = next;
  receivedAt = Date.now();
  if (changed) render();
  else tick();
});
await listen("island-background", (event) => {
  picture = typeof event.payload === "string" && event.payload.startsWith("data:image/") ? event.payload : "";
  render();
});
render();
setInterval(tick, 250);
await emitTo("main", "island-ready");
