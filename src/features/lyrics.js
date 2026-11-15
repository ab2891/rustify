// Your own lyrics for a song, pasted from any site. "Sync to song" lets you
// tap as each line starts while the song plays, which saves exact timings.
// Saved on this computer; the island's lyrics dropdown shows them instead of
// looking the song up. Open from a song's menu or the Now Playing panel.
import { customLyrics, parseLRC, sungLines, toLRC, plainText } from "../lyrics.js";

export default {
  name: "lyrics",
  setup(ctx) {
    let song = null; // the song the open dialog is editing

    function edit(button) {
      song = (button?.dataset.id && ctx.trackById(button.dataset.id)) || ctx.current;
      if (!song) {
        ctx.toast("Play or pick a song first.");
        return;
      }
      const saved = customLyrics.get(song);
      const { h } = ctx;
      ctx.openModal(
        saved ? "Edit lyrics" : "Add lyrics",
        `<p><strong>${h(song.title)}</strong> · ${h(song.artist)}</p><label for="lyrics-text">Lyrics (paste from any site, or edit)</label><textarea id="lyrics-text" rows="12" placeholder="Paste the lyrics here">${h(plainText(saved))}</textarea><p class="lyrics-hint">${parseLRC(saved).length ? "These lyrics are synced to the song. Saving edits here keeps the words but removes the timing." : "Without syncing, the island scrolls these on an estimate. Sync to song makes them follow exactly."}</p>`,
        `${saved ? `<button class="white-button" data-action="lyrics-remove">Remove</button>` : ""}<button class="white-button" data-action="close-modal">Cancel</button><button class="white-button" data-action="lyrics-sync">Sync to song</button><button class="green-button" data-action="lyrics-save">Save</button>`,
      );
    }

    function store(text) {
      customLyrics.set(song, text);
      ctx.closeModal();
      ctx.refreshLyrics();
      ctx.toast(text.trim() ? "Lyrics saved" : "Lyrics removed");
    }

    // Tap-along: the song plays and each press marks where the next line starts.
    let sync = null; // { lines, times }
    const same = (a, b) => a && b && a.title === b.title && a.artist === b.artist;
    const clock = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;

    function syncView() {
      const { h } = ctx;
      const { lines, times } = sync;
      const at = times.length;
      const done = at === lines.length;
      const line = (i, cls) => (lines[i] != null ? `<p class="${cls}">${i < at ? `<small>${clock(times[i])}</small> ` : ""}${h(lines[i])}</p>` : `<p class="${cls}">&nbsp;</p>`);
      return `<p>${done ? "All lines are timed. Save to keep them." : "Press <strong>Line starts now</strong> (or Space) the moment each line begins."}</p><div class="sync-lines">${line(at - 1, "past")}${done ? "" : line(at, "next")}${line(at + 1, "later")}</div><p class="lyrics-hint">${at} of ${lines.length} lines timed</p>`;
    }
    function syncRender() {
      const view = document.querySelector("#sync-view");
      if (!view) return;
      view.innerHTML = syncView();
      const done = sync.times.length === sync.lines.length;
      document.querySelector('[data-action="lyrics-tap"]').disabled = done;
      document.querySelector('[data-action="lyrics-sync-save"]').disabled = !done;
      document.querySelector('[data-action="lyrics-undo"]').disabled = !sync.times.length;
      // Keep Space on the tap button until everything is timed.
      document.querySelector(done ? '[data-action="lyrics-sync-save"]' : '[data-action="lyrics-tap"]').focus();
    }
    async function startSync() {
      const text = document.querySelector("#lyrics-text")?.value ?? customLyrics.get(song);
      const lines = sungLines(plainText(text));
      if (!lines.length) throw new Error("Paste the lyrics first.");
      if (!same(song, ctx.current)) throw new Error("Start playing this song first, then press Sync to song.");
      sync = { lines, times: [] };
      ctx.openModal(
        "Sync lyrics to the song",
        `<p><strong>${ctx.h(song.title)}</strong> · ${ctx.h(song.artist)}</p><div id="sync-view"></div>`,
        `<button class="white-button" data-action="lyrics-restart">Restart song</button><button class="white-button" data-action="lyrics-undo">Undo line</button><button class="green-button" data-action="lyrics-tap">Line starts now</button><button class="white-button" data-action="lyrics-sync-save">Save</button>`,
      );
      syncRender();
      await ctx.seekTo(0);
      if (!ctx.playing) await ctx.doAction("play");
      // Focus lands on the first button after the dialog opens; move it back.
      setTimeout(syncRender, 30);
    }

    return {
      get: (track) => customLyrics.get(track),
      /** Saved lyrics without time tags, for display. */
      text: (track) => plainText(customLyrics.get(track)),
      actions: {
        "lyrics-edit": edit,
        "lyrics-save": () => {
          const text = document.querySelector("#lyrics-text").value;
          if (!text.trim()) throw new Error("Paste the lyrics first.");
          // Unchanged words keep their timing.
          const saved = customLyrics.get(song);
          store(text.trim() === plainText(saved).trim() ? saved : text);
        },
        "lyrics-remove": () => store(""),
        "lyrics-sync": startSync,
        "lyrics-tap": () => {
          if (!sync || sync.times.length >= sync.lines.length) return;
          if (!same(song, ctx.current)) throw new Error("The song changed. Play it again to keep syncing.");
          // People press a little after they hear the line begin.
          const time = Math.max(0, ctx.position() - 0.15);
          sync.times.push(Math.max(time, sync.times.at(-1) ?? 0));
          syncRender();
        },
        "lyrics-undo": async () => {
          if (!sync?.times.length) return;
          const back = sync.times.pop();
          syncRender();
          // Jump back a few seconds before that line so it can be tapped again.
          await ctx.seekTo(Math.max(0, back - 4));
        },
        "lyrics-restart": async () => {
          if (!sync) return;
          sync.times = [];
          syncRender();
          await ctx.seekTo(0);
        },
        "lyrics-sync-save": () => {
          if (!sync || sync.times.length < sync.lines.length) throw new Error("Time every line first.");
          const text = toLRC(sync.lines, sync.times);
          sync = null;
          store(text);
        },
      },
    };
  },
};
