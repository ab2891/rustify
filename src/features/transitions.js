// Transitions: fade the music out and in when you pause, resume or skip,
// instead of cutting hard. Works on Rustify's own player, whose volume can be
// changed quickly through a local channel (src-tauri/src/native_player.rs
// `fade`). Two songs cannot overlap (a true crossfade): there is one player.
import { spotify } from "../bridge.js";

const KEY = "rustify-transitions";
const CHOICES = [[0, "Off"], [300, "Short"], [600, "Medium"], [1200, "Long"]];

export default {
  name: "transitions",
  setup(ctx) {
    let options = { fade: 0, pause: true, skip: true };
    try { options = { ...options, ...JSON.parse(localStorage.getItem(KEY) || "{}") }; } catch { /* keep defaults */ }
    let busyUntil = 0;
    let broken = false; // the local channel failed; stop trying this session
    const save = () => localStorage.setItem(KEY, JSON.stringify(options));
    const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

    // Only when Spotify is playing on Rustify's own player.
    async function usable() {
      if (!options.fade || broken || !ctx.isSpotify() || !ctx.remote.deviceId) return false;
      const status = await spotify.playerStatus().catch(() => null);
      return Boolean(status?.device_id) && status.device_id === ctx.remote.deviceId;
    }
    async function fade(from, to, millis) {
      busyUntil = Date.now() + millis + 2500;
      await spotify.fade(from, to, millis);
    }

    /**
     * Runs a play, pause or skip command with a fade around it. Whatever
     * happens, the volume ends where the user had it.
     */
    async function wrap(kind, run) {
      const level = Math.round(ctx.volume * 100);
      const wanted = kind === "skip" ? options.skip : options.pause;
      if (!wanted || level < 5 || !(await usable())) return run();
      try {
        if (kind === "play") await fade(level, 0, 0);
        else await fade(level, 0, options.fade);
      } catch {
        broken = true;
        busyUntil = 0;
        return run();
      }
      try {
        await run();
        if (kind === "skip") await pause(250);
      } finally {
        try {
          // Paused: put the volume straight back. Playing: bring it up gently.
          await fade(0, level, kind === "pause" ? 0 : options.fade);
        } catch {
          broken = true;
          // The quick channel failed mid-way: restore through Spotify instead.
          await ctx.api("PUT", `/me/player/volume?volume_percent=${level}`).catch(() => {});
        }
        busyUntil = Date.now() + 1500;
      }
    }

    const chip = (on, action, label = on ? "On" : "Off", value = "") =>
      `<button class="chip ${on ? "selected" : ""}" data-action="${action}" data-value="${value}" aria-pressed="${on}">${label}</button>`;
    return {
      wrap,
      /** While a fade runs, volume read back from Spotify is not the user's. */
      busy: () => Date.now() < busyUntil,
      actions: {
        "transition-fade": (button) => { options.fade = Number(button.dataset.value); broken = false; save(); ctx.openSettings(); },
        "transition-pause": () => { options.pause = !options.pause; save(); ctx.openSettings(); },
        "transition-skip": () => { options.skip = !options.skip; save(); ctx.openSettings(); },
      },
      settings: () =>
        `<div class="setting-group"><h3>Transitions</h3><div class="setting-row"><div><strong>Fade</strong><p>Fades the music out and in instead of cutting. Only on Rustify's own player ("Play on this computer").</p></div><div class="chips">${CHOICES.map(([ms, label]) => chip(options.fade === ms, "transition-fade", label, ms)).join("")}</div></div>${options.fade ? `<div class="setting-row"><div><strong>On pause and resume</strong></div>${chip(options.pause, "transition-pause")}</div><div class="setting-row"><div><strong>On skip</strong></div>${chip(options.skip, "transition-skip")}</div>` : ""}</div>`,
    };
  },
};
