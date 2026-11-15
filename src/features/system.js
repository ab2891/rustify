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
    return { tray: true, hotkeys: true, unload: true, ...JSON.parse(localStorage.getItem(KEY) || "{}") };
  } catch {
    return { tray: true, hotkeys: true, unload: true };
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
    let lowMemory = false;

    const save = () => localStorage.setItem(KEY, JSON.stringify(options));

    // Closed to the tray, Rustify can drop this whole page (and the WebView
    // engine) and let Rust handle media keys, as long as nothing here is
    // needed: True shuffle, the sleep timer, the island and local audio all
    // run in the page. See src-tauri/src/background.rs.
    let ready = null;
    function syncReady() {
      const next = Boolean(
        options.unload && options.tray && ctx.isSpotify() && ctx.connected() && !ctx.trueShuffle &&
        !ctx.features.sleep.active() && !ctx.features.island.isOpen(),
      );
      if (next === ready) return;
      ready = next;
      system.setBackgroundReady(next).catch(() => {});
    }
    // A media key or hotkey that woke the page up: run it once signed in.
    async function runWakeCommand() {
      const command = await system.takeWakeCommand();
      if (!command) return;
      for (let i = 0; i < 40 && command !== "island" && !ctx.connected(); i++)
        await new Promise((resolve) => setTimeout(resolve, 250));
      await run(command);
    }

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
        lowMemory = await system.getLowMemory();
        syncReady();
        runWakeCommand().catch(ctx.handleError);
      },
      on: {
        player(now) {
          playing = now.playing;
          if (!system.native) return;
          syncReady();
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
          ? `<div class="setting-group"><h3>Background</h3><div class="setting-row"><div><strong>Start with Windows</strong><p>Rustify starts quietly in the tray when you sign in, so media keys work right away.</p></div>${chip(autostart, "system-autostart")}</div><div class="setting-row"><div><strong>Free memory in the tray</strong><p>When closed to the tray, Rustify shuts its window down completely and keeps only the player; media keys, hotkeys and the tray still work. Reopening takes a moment. It stays loaded while True shuffle, a sleep timer or the island is on.</p></div>${chip(options.unload, "system-unload")}</div><div class="setting-row"><div><strong>Low memory mode</strong><p>Draws the app without the graphics card: uses less memory and leaves the card to games. Animations may be less smooth. Applies after a restart.</p></div>${chip(lowMemory, "system-low-memory")}</div><div class="setting-row"><div><strong>Keep running in the tray</strong><p>Closing the window keeps the music playing. Use the tray icon to reopen or quit Rustify. Media keys always work.</p></div>${chip(options.tray, "system-tray")}</div><div class="setting-row"><div><strong>Global hotkeys</strong><p>${HOTKEYS.map(([keys, what]) => `${ctx.h(keys)} ${ctx.h(what.toLowerCase())}`).join(" · ")}${blocked.length ? `<br>Used by another app: ${ctx.h(blocked.join(", "))}` : ""}</p></div>${chip(options.hotkeys, "system-hotkeys")}</div></div>`
          : "",
      actions: {
        async "system-tray"() {
          options.tray = !options.tray;
          save();
          await system.setCloseToTray(options.tray);
          ctx.openSettings();
        },
        async "system-low-memory"() {
          lowMemory = await system.setLowMemory(!lowMemory);
          ctx.openSettings();
          ctx.toast("Restart Rustify to apply low memory mode.");
        },
        async "system-unload"() {
          options.unload = !options.unload;
          save();
          syncReady();
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
