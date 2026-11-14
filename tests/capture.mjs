import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
const dir = resolve("../../docs/design/reviews/rustify-2026-11-13");
await mkdir(dir, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH,
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 950 },
  recordVideo: { dir, size: { width: 1440, height: 950 } },
});
const page = await context.newPage();
await page.addInitScript(() => localStorage.setItem("rustify-mode", "local"));
await page.goto("http://127.0.0.1:1420");
await page.getByRole("heading", { name: "Your albums" }).waitFor();
await page.screenshot({ path: resolve(dir, "local-home.png") });
await page.locator('.library-item[data-id="late-nights"]').click();
await page.locator('tr[data-track="night-drive"]').click();
await page.waitForTimeout(700);
await page.screenshot({ path: resolve(dir, "playlist-playing.png") });
await page.getByRole("button", { name: "Show queue" }).click();
await page.waitForTimeout(350);
await page.getByRole("button", { name: "Next track", exact: true }).click();
await page.waitForTimeout(350);
await page.getByRole("button", { name: "Pause", exact: true }).click();
await page.getByRole("button", { name: "Home", exact: true }).click();
await page.setViewportSize({ width: 860, height: 700 });
await page.screenshot({ path: resolve(dir, "compact-home.png") });
const video = page.video();
const temporaryVideo = await video.path();
await context.close();
await video.saveAs(resolve(dir, "local-player-flow.webm"));
await (await import("node:fs/promises")).unlink(temporaryVideo);
await browser.close();
