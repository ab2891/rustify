import { defineConfig } from "vite";
export default defineConfig({
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: { ignored: ["**/src-tauri/**", "**/test-results/**", "**/playwright-report/**", "**/tests/**", "**/dist/**"] },
  },
  envPrefix: ["VITE_", "TAURI_ENV_"],
  build: {
    target: "es2022",
    // Two pages: the main app and the floating island window.
    rollupOptions: { input: { main: "index.html", island: "island.html" } },
  },
});
