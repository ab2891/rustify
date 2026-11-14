// Feature registry: lets each feature live in its own file under src/features/.
//
// A feature is `{ name, setup(ctx) }`. `setup` receives the app context (see
// `ctx` in main.js) and returns any of:
//   actions:   { "action-name": async (button) => {} }  // for data-action="action-name"
//   shortcuts: [{ key: "d", ctrl?, shift?, alt?, run(event) }]
//   on:        { player(snapshot) {} }  // app events, see notify() calls in main.js
//   settings:  () => "<html>"           // a section in the Settings dialog
//   start()                             // runs once after the app has loaded
//   ...anything else, exposed to the app as `features.<name>.<thing>`
// Register new features in ./index.js. See ./template.js.
export function loadFeatures(list, ctx) {
  const actions = new Map();
  const shortcuts = [];
  const listeners = {};
  const sections = [];
  const starters = [];
  const api = {};
  for (const feature of list) {
    const { actions: own = {}, shortcuts: keys = [], on = {}, settings, start, ...exports } = feature.setup(ctx) || {};
    if (settings) sections.push(settings);
    if (start) starters.push(start);
    for (const [event, run] of Object.entries(on)) (listeners[event] ||= []).push(run);
    for (const [name, run] of Object.entries(own)) {
      if (actions.has(name)) throw new Error(`Action "${name}" is defined twice (${feature.name}).`);
      actions.set(name, run);
    }
    shortcuts.push(...keys);
    api[feature.name] = exports;
  }
  return {
    ...api,
    /** Tells every feature listening for `event`; one failing feature never breaks the app. */
    notify(event, data) {
      for (const run of listeners[event] || []) {
        try { run(data); } catch (error) { console.error(error); }
      }
    },
    /** Settings sections contributed by features, in load order. */
    settingsHTML: () => sections.map((render) => render()).join(""),
    /** Runs every feature's start(); a failing feature is logged, not fatal. */
    async start() {
      await Promise.all(starters.map(async (run) => {
        try { await run(); } catch (error) { console.error(error); }
      }));
    },
    /** Handler for a data-action name, or undefined. */
    action: (name) => actions.get(name),
    /** Runs the first matching shortcut; returns true when one handled the event. */
    shortcut(event) {
      if (/INPUT|TEXTAREA|SELECT/.test(event.target?.tagName || "")) return false;
      const match = shortcuts.find(
        (s) =>
          s.key.toLowerCase() === event.key.toLowerCase() &&
          !!s.ctrl === (event.ctrlKey || event.metaKey) &&
          !!s.shift === event.shiftKey &&
          !!s.alt === event.altKey,
      );
      if (!match) return false;
      event.preventDefault();
      match.run(event);
      return true;
    },
  };
}
