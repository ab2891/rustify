// Copy this file to start a new feature, then add it to ./index.js.
// Anything with data-action="hello" in the UI calls the action below.
export default {
  name: "template",
  setup(ctx) {
    return {
      actions: {
        // async hello(button) { ctx.toast("Hello from a feature"); },
      },
      shortcuts: [
        // { key: "h", alt: true, run: () => ctx.toast("Alt+H pressed") },
      ],
      // Exports are reachable from main.js as features.template.<name>.
    };
  },
};
