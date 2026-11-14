// The floating island window (see src-tauri/src/island.rs and features/island.js).
// It only displays state and sends commands; the main window does the work.
import "./island.css";
import { invoke } from "@tauri-apps/api/core";
import { emitTo, listen } from "@tauri-apps/api/event";
import { icon } from "./icons.js";
import { escapeHTML as h } from "./player.js";

const root = document.querySelector("#island");
let state = null;
let receivedAt = 0;

function position() {
  if (!state?.duration) return 0;
  const moved = state.playing ? (Date.now() - receivedAt) / 1000 : 0;
  return Math.min(state.duration, state.elapsed + moved);
}

function render() {
  if (!state?.title) {
    root.className = "island";
    root.innerHTML = `<span class="empty" data-tauri-drag-region>Nothing playing. Pick something in Rustify.</span>${closeButton()}`;
    return;
  }
  root.className = `island${state.playing ? " playing" : ""}`;
  root.innerHTML = `${state.cover ? `<img class="cover" src="${h(state.cover)}" alt="">` : `<div class="cover"></div>`}<button class="text" data-command="show-main" title="Open Rustify"><strong>${h(state.title)}</strong><small>${h(state.artist)}</small></button><div class="controls"><button data-command="previous" aria-label="Previous track">${icon("previous")}</button><button class="play" data-command="play" aria-label="${state.playing ? "Pause" : "Play"}">${icon(state.playing ? "pause" : "play")}</button><button data-command="next" aria-label="Next track">${icon("next")}</button></div>${closeButton()}<div class="progress"><span></span></div>`;
  tick();
}

const closeButton = () => `<button class="close" data-command="close" aria-label="Hide island">${icon("close")}</button>`;

function tick() {
  const bar = root.querySelector(".progress span");
  if (bar) bar.style.setProperty("--pct", `${state?.duration ? (position() / state.duration) * 100 : 0}%`);
}

root.addEventListener("click", async (event) => {
  const command = event.target.closest("[data-command]")?.dataset.command;
  if (!command) return;
  if (command === "close") await invoke("island_toggle");
  else if (command === "show-main") await invoke("island_show_main");
  else await emitTo("main", "island-command", command);
});

await listen("island-state", (event) => {
  const next = event.payload;
  const changed = !state || ["title", "artist", "cover", "playing"].some((k) => state[k] !== next[k]);
  state = next;
  receivedAt = Date.now();
  if (changed) render();
  else tick();
});
render();
setInterval(tick, 500);
await emitTo("main", "island-ready");
