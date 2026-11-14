import { chromium } from "@playwright/test";
import { readFile, mkdir, unlink } from "node:fs/promises";
import { resolve } from "node:path";
const dir = resolve("../../docs/design/reviews/rustify-shuffle-2026-11-13");
await mkdir(dir, { recursive: true });
const catalog = JSON.parse(
  await readFile(new URL("../public/catalog.json", import.meta.url)),
);
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH,
});
const context = await browser.newContext({
  viewport: { width: 1600, height: 900 },
  recordVideo: { dir, size: { width: 1600, height: 900 } },
});
const page = await context.newPage();
await page.addInitScript(() => localStorage.setItem("rustify-mode", "local"));
await page.goto("http://127.0.0.1:1420");
await page.getByRole("heading", { name: "Your albums", exact: true }).waitFor();
await page.locator('.content [data-route="local"]').click();
for (const track of catalog.tracks)
  await page.locator(`.like-row[data-like="${track.id}"]`).click();
await page.locator('.library-item[data-route="liked"]').click();
await page.locator('.playlist-actions [data-action="shuffle"]').click();
await page.locator(".big-play").click();
await page.waitForFunction(
  () => document.querySelector("#audio-engine").currentTime > 0.2,
);
await page.getByRole("button", { name: "Collapse or expand library" }).click();
await page.screenshot({ path: resolve(dir, "liked-true-shuffle.png") });
await page.getByRole("button", { name: "Show queue", exact: true }).click();
await page.screenshot({ path: resolve(dir, "shuffle-queue.png") });
await page.getByRole("button", { name: "Next track", exact: true }).click();
await page
  .getByRole("button", { name: "Reshuffle remaining", exact: true })
  .click();
await page.waitForTimeout(350);
await page.getByRole("button", { name: "Pause", exact: true }).click();
await page.locator(".toast").waitFor({state:"detached"});
await page.getByRole("button", { name: "Home", exact: true }).click();
await page.locator('[data-action="now-panel"]').last().click();
await page.screenshot({ path: resolve(dir, "home-collapsed.png") });
await page.getByRole("button", { name: "Collapse or expand library" }).click();
await page.screenshot({ path: resolve(dir, "home-expanded.png") });
await page.setViewportSize({ width: 860, height: 700 });
await page.screenshot({ path: resolve(dir, "compact-home.png") });
const video = page.video(),
  temporary = await video.path();
await context.close();
await video.saveAs(resolve(dir, "shuffle-flow.webm"));
await unlink(temporary);
await browser.close();
