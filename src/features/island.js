// Island: a small floating mini player (separate always-on-top window) that
// can be dragged anywhere on screen. Toggle with the player-bar button or Alt+I.
import { island } from "../bridge.js";

const COMMANDS = new Set(["play", "next", "previous"]);

export default {
  name: "island",
  setup(ctx) {
    let open = false;
    let listening = null;
    let latest = null;
    let sentKey = "";
    let sentAt = 0;

    function push(force = false) {
      if (!open || !latest) return;
      // Track/play changes go out at once; position updates at most twice a second.
      const key = `${latest.title}|${latest.artist}|${latest.playing}|${latest.duration}`;
      const now = Date.now();
      if (!force && key === sentKey && now - sentAt < 500) return;
      sentKey = key;
      sentAt = now;
      island.publish({ ...latest, sentAt: now }).catch(() => {});
    }

    const listen = () =>
      (listening ??= island.listen({
        "island-ready": () => { open = true; push(true); },
        "island-closed": () => { open = false; },
        "island-command": (command) => {
          if (COMMANDS.has(command)) ctx.doAction(command).catch(ctx.handleError);
        },
      }));

    async function toggle() {
      await listen();
      open = await island.toggle();
      if (open) push(true);
    }

    return {
      toggle,
      actions: { island: toggle },
      shortcuts: [{ key: "i", alt: true, run: () => toggle().catch(ctx.handleError) }],
      on: { player(snapshot) { latest = snapshot; push(); } },
    };
  },
};
