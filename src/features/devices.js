// Devices: Rustify's built-in Spotify player (Spotify Soloist) and the
// "Connect to a device" picker.
export default {
  name: "devices",
  setup(ctx) {
    let starting = null;

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
