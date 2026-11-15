// Devices: Rustify's built-in Spotify player (Spotify Soloist) and the
// "Connect to a device" picker.
import { soloistExpiry } from "../lyrics.js";

const DOWNLOADS = "https://developer.spotify.com/documentation/soloist/reference/downloads-and-updates";

export default {
  name: "devices",
  setup(ctx) {
    let starting = null;
    let expiry = null; // { expires: Date, daysLeft } once the installed Soloist is known

    const day = (date) => date.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
    // Spotify stops each Soloist build 90 days after it was built. Warn two
    // weeks ahead instead of letting playback fail without warning.
    async function checkExpiry() {
      expiry = soloistExpiry(await ctx.spotify.playerBuild());
      if (!expiry || expiry.daysLeft > 14) return;
      ctx.toast(
        expiry.daysLeft > 0
          ? `Rustify's Spotify player stops working in ${expiry.daysLeft} ${expiry.daysLeft === 1 ? "day" : "days"}. See Settings to update it.`
          : "Rustify's Spotify player has expired. See Settings to update it.",
        true,
      );
    }

    // Starts the built-in player and makes it the active Spotify device.
    async function startRustifyPlayer() {
      if (starting) return starting;
      const started = ctx.generation;
      starting = (async () => {
        const deviceId = await ctx.spotify.startPlayer();
        if (started !== ctx.generation || !ctx.isSpotify() || !ctx.connected()) throw ctx.stale();
        await ctx.api("PUT", "/me/player", { device_ids: [deviceId], play: false });
        ctx.remote.deviceId = deviceId;
        ctx.closeModal();
        ctx.toast("Playing on Rustify. No Spotify app or browser needed.");
      })().finally(() => { starting = null; });
      return starting;
    }

    // Uses the active device, otherwise starts Rustify's own player.
    async function ensure() {
      const started = ctx.generation;
      const result = await ctx.spotify.request("GET", "/me/player/devices");
      if (started !== ctx.generation) throw ctx.stale();
      const available = (result.devices || []).filter((d) => d.id && !d.is_restricted);
      const device = available.find((d) => d.is_active);
      if (device) ctx.remote.deviceId = device.id;
      else await startRustifyPlayer();
    }

    async function open() {
      if (!ctx.isSpotify()) {
        ctx.toast("Local audio plays on this computer.");
        return;
      }
      if (!ctx.connected()) {
        ctx.openConnect();
        return;
      }
      const result = await ctx.api("GET", "/me/player/devices");
      const devices = (ctx.remote.devices = result.devices || []);
      const { h, icon } = ctx;
      ctx.openModal(
        "Connect to a device",
        `<p>Play on this computer. No Spotify app or browser tab needed (Premium required).</p><button class="green-button" data-action="rustify-player">Play on this computer</button><p>Or select another Spotify device:</p>${
          devices
            .filter((d) => d.id)
            .map(
              (d) =>
                `<button class="playlist-pick" data-device="${h(d.id)}" ${d.is_restricted ? "disabled" : ""}>${icon("device")}<span>${h(d.name)}${d.is_active ? " · Listening here" : ""}${d.is_restricted ? " · Unavailable for control" : ""}</span></button>`,
            )
            .join("") || "<p>No other devices found.</p>"
        }`,
        `<button class="white-button" data-action="devices">Refresh devices</button>`,
      );
    }

    return {
      ensure,
      open,
      start: () => checkExpiry().catch(() => {}),
      settings: () => {
        if (!expiry) return "";
        const { expires, daysLeft } = expiry;
        const text = daysLeft > 0
          ? `Spotify's player build works until ${day(expires)} (${daysLeft} ${daysLeft === 1 ? "day" : "days"} left). After that, download the newest Soloist and extract it over the old one in the Rustify\\soloist folder; pairing is kept.`
          : `Spotify's player build expired on ${day(expires)}. Download the newest Soloist and extract it over the old one in the Rustify\\soloist folder; pairing is kept.`;
        return `<div class="setting-group"><h3>Spotify player</h3><div class="setting-row"><div><strong>${daysLeft > 14 ? "Up to date" : daysLeft > 0 ? "Update soon" : "Update needed"}</strong><p>${ctx.h(text)}</p><p class="selectable">${DOWNLOADS}</p></div></div></div>`;
      },
      actions: {
        devices: open,
        async "rustify-player"(button) {
          button.disabled = true;
          button.textContent = "Starting…";
          try { await startRustifyPlayer(); }
          finally { if (button.isConnected) { button.disabled = false; button.textContent = "Play on this computer"; } }
        },
      },
    };
  },
};
