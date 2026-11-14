// Island: a small floating mini player (separate always-on-top window) that
// can be dragged anywhere on screen. Toggle with the player-bar button, Alt+I
// or Ctrl+Alt+I. Options (compact, hide while paused, opacity, click-through)
// live in Settings.
import { island } from "../bridge.js";

const COMMANDS = new Set(["play", "next", "previous"]);
const KEY = "rustify-island";
const OPACITIES = [100, 85, 70, 50];
const DEFAULTS = { compact: false, hideWhilePaused: false, opacity: 100, clickThrough: false };

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

    const native = () => ({ compact: options.compact, click_through: options.clickThrough });

    function push(force = false) {
      if (!open || !latest) return;
      syncVisibility();
      // Track/play/style changes go out at once; position updates at most twice a second.
      const key = `${latest.title}|${latest.artist}|${latest.playing}|${latest.duration}|${options.compact}|${options.opacity}`;
      const now = Date.now();
      if (!force && key === sentKey && now - sentAt < 500) return;
      sentKey = key;
      sentAt = now;
      island
        .publish({ ...latest, sentAt: now, style: { compact: options.compact, opacity: options.opacity } })
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
        },
      }));

    async function toggle() {
      await listen();
      await island.configure(native());
      open = await island.toggle();
      shown = true;
      if (open) push(true);
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
