// Home page layout: which sections show and in what order. main.js builds
// the sections; this decides their order and offers "Customize".
const KEY = "rustify-home";
const NAMES = {
  quick: "Shortcuts",
  recent: "Recently played on Rustify",
  top: "Your most played",
  playlists: "Your playlists",
  albums: "Your albums",
};
const DEFAULT = Object.keys(NAMES);

/** Section ids in the user's order; ids added in later versions go last. */
export function ordered(saved) {
  const known = (saved || []).filter((id) => DEFAULT.includes(id));
  return [...known, ...DEFAULT.filter((id) => !known.includes(id))];
}

export default {
  name: "home",
  setup(ctx) {
    let config = { order: DEFAULT, hidden: [] };
    try { config = { ...config, ...JSON.parse(localStorage.getItem(KEY) || "{}") }; } catch { /* defaults */ }
    const save = () => localStorage.setItem(KEY, JSON.stringify(config));
    const order = () => ordered(config.order);

    function dialog() {
      const ids = order();
      ctx.openModal(
        "Customize home",
        `<p>Choose what your home page shows, and in which order.</p>${ids
          .map((id, i) => {
            const on = !config.hidden.includes(id);
            return `<div class="setting-row"><div><strong>${NAMES[id]}</strong></div><div class="chips"><button class="chip" data-action="home-move" data-id="${id}" data-by="-1" ${i === 0 ? "disabled" : ""} aria-label="Move ${NAMES[id]} up">↑</button><button class="chip" data-action="home-move" data-id="${id}" data-by="1" ${i === ids.length - 1 ? "disabled" : ""} aria-label="Move ${NAMES[id]} down">↓</button><button class="chip ${on ? "selected" : ""}" data-action="home-toggle" data-id="${id}" aria-pressed="${on}" aria-label="Show ${NAMES[id]}">${on ? "Shown" : "Hidden"}</button></div></div>`;
          })
          .join("")}`,
        `<button class="white-button" data-action="home-reset">Reset</button><button class="green-button" data-action="close-modal">Done</button>`,
      );
    }
    function changed() {
      save();
      ctx.renderContent();
      dialog();
    }

    return {
      names: NAMES,
      /** Joins the sections ({ id: html }) the user wants, in their order. */
      arrange: (sections) => order().filter((id) => !config.hidden.includes(id) && sections[id]).map((id) => sections[id]).join(""),
      actions: {
        "home-customize": dialog,
        "home-toggle": (button) => {
          const id = button.dataset.id;
          config.hidden = config.hidden.includes(id) ? config.hidden.filter((v) => v !== id) : [...config.hidden, id];
          changed();
        },
        "home-move": (button) => {
          const ids = order();
          const from = ids.indexOf(button.dataset.id);
          const to = from + Number(button.dataset.by);
          if (from < 0 || to < 0 || to >= ids.length) return;
          [ids[from], ids[to]] = [ids[to], ids[from]];
          config.order = ids;
          changed();
        },
        "home-reset": () => { config = { order: DEFAULT, hidden: [] }; changed(); },
      },
    };
  },
};
