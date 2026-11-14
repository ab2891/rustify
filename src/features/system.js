// System integration: media keys and the Windows media flyout/lock screen,
// the tray (keep running when the window is closed) and global hotkeys.
// The Rust side lives in src-tauri/src/{media,tray,hotkeys}.rs; all three send
// "media-command" events that are handled here.
import { system } from "../bridge.js";

const KEY = "rustify-system";
const HOTKEYS = [
  ["Ctrl+Alt+Space", "Play / pause"],
  ["Ctrl+Alt+→", "Next"],
  ["Ctrl+Alt+←", "Previous"],
  ["Ctrl+Alt+I", "Show / hide island"],
];

function load() {
  try {
    return { tray: true, hotkeys: true, ...JSON.parse(localStorage.getItem(KEY) || "{}") };
  } catch {
    return { tray: true, hotkeys: true };
  }
}

export default {
  name: "system",
  setup(ctx) {
    const options = load();
    let playing = false;
    let sentKey = "";
    let sentAt = 0;
    let blocked = [];
    let autostart = false;

    const save = () => localStorage.setItem(KEY, JSON.stringify(options));

    async function applyHotkeys() {
      blocked = (await system.setHotkeys(options.hotkeys)) || [];
      if (blocked.length) ctx.toast(`Another app already uses ${blocked.join(", ")}.`, true);
    }

    function run(command) {
      // Media keys may send explicit play/pause; the app's "play" action toggles.
      if (command === "toggle" || (command === "play" && !playing) || (command === "pause" && playing)) {
        return ctx.doAction("play");
      }
      if (command === "next" || command === "previous" || command === "island") return ctx.doAction(command);
    }

    const chip = (on, action) =>
      `<button class="chip ${on ? "selected" : ""}" data-action="${action}" aria-pressed="${on}">${on ? "On" : "Off"}</button>`;

    return {
      async start() {
        if (!system.native) return;
        await system.listen({ "media-command": (command) => Promise.resolve(run(command)).catch(ctx.handleError) });
        await system.setCloseToTray(options.tray);
        await applyHotkeys();
        autostart = await system.getAutostart();
      },
      on: {
        player(now) {
          playing = now.playing;
          if (!system.native) return;
          // Track and play/pause changes go out at once; position every 5 seconds.
          const key = `${now.title}|${now.artist}|${now.cover}|${now.playing}`;
          const time = Date.now();
          if (key === sentKey && time - sentAt < 5000) return;
          sentKey = key;
          sentAt = time;
          system.mediaUpdate(now).catch(() => {});
        },
      },
      settings: () =>
        system.native
          ? `<div class="setting-group"><h3>Background</h3><div class="setting-row"><div><strong>Start with Windows</strong><p>Rustify starts quietly in the tray when you sign in, so media keys work right away.</p></div>${chip(autostart, "system-autostart")}</div><div class="setting-row"><div><strong>Keep running in the tray</strong><p>Closing the window keeps the music playing. Use the tray icon to reopen or quit Rustify. Media keys always work.</p></div>${chip(options.tray, "system-tray")}</div><div class="setting-row"><div><strong>Global hotkeys</strong><p>${HOTKEYS.map(([keys, what]) => `${ctx.h(keys)} ${ctx.h(what.toLowerCase())}`).join(" · ")}${blocked.length ? `<br>Used by another app: ${ctx.h(blocked.join(", "))}` : ""}</p></div>${chip(options.hotkeys, "system-hotkeys")}</div></div>`
          : "",
      actions: {
        async "system-tray"() {
          options.tray = !options.tray;
          save();
          await system.setCloseToTray(options.tray);
          ctx.openSettings();
        },
        async "system-autostart"() {
          autostart = await system.setAutostart(!autostart);
          ctx.openSettings();
        },
        async "system-hotkeys"() {
          options.hotkeys = !options.hotkeys;
          save();
          await applyHotkeys();
          ctx.openSettings();
        },
      },
    };
  },
};
