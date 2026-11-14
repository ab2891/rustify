// Sleep timer: pause after a number of minutes, or when the current song ends.
// Set it in Settings; it is not remembered across restarts on purpose.
const CHOICES = [["off", "Off"], ["15", "15 min"], ["30", "30 min"], ["60", "1 hour"], ["end", "End of song"]];

export default {
  name: "sleep",
  setup(ctx) {
    let mode = "off";
    let deadline = 0;
    let timer = null;
    let endTitle = null;
    let latest = null;

    function clear() {
      clearTimeout(timer);
      timer = null;
      mode = "off";
      endTitle = null;
    }

    async function fire() {
      clear();
      if (latest?.playing) await ctx.doAction("play");
      ctx.toast("Sleep timer: playback paused.");
    }

    function set(value) {
      clear();
      if (value === "end") {
        if (!latest?.title) {
          ctx.toast("Nothing is playing.");
          return;
        }
        mode = "end";
        endTitle = latest.title;
        ctx.toast(`Pausing after "${latest.title}".`);
      } else if (value !== "off") {
        const minutes = Number(value);
        mode = value;
        deadline = Date.now() + minutes * 60000;
        timer = setTimeout(() => fire().catch(ctx.handleError), minutes * 60000);
        ctx.toast(`Pausing in ${minutes} minutes.`);
      } else {
        ctx.toast("Sleep timer off.");
      }
    }

    function status() {
      if (mode === "end") return `Pauses after "${ctx.h(endTitle)}".`;
      if (mode !== "off") return `Pauses in ${Math.max(1, Math.ceil((deadline - Date.now()) / 60000))} min.`;
      return "Pause playback after a while, or when this song ends.";
    }

    return {
      active: () => mode !== "off",
      actions: {
        "sleep-timer": (button) => {
          set(button.dataset.value);
          ctx.openSettings();
        },
      },
      on: {
        player(now) {
          latest = now;
          if (mode !== "end" || !now.title) return;
          // Pause on the last second, or as soon as a different song starts.
          const ending = now.playing && now.duration > 0 && now.duration - now.elapsed < 1;
          if (ending || now.title !== endTitle) fire().catch(ctx.handleError);
        },
      },
      settings: () =>
        `<div class="setting-group"><h3>Sleep timer</h3><div class="setting-row"><div><p>${status()}</p></div><div class="chips">${CHOICES.map(([value, label]) => `<button class="chip ${mode === value ? "selected" : ""}" data-action="sleep-timer" data-value="${value}" aria-pressed="${mode === value}">${label}</button>`).join("")}</div></div></div>`,
    };
  },
};
