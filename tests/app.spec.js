import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
const demo = JSON.parse(
  readFileSync(new URL("../public/catalog.json", import.meta.url)),
);
async function local(page) {
  await page.addInitScript(() => localStorage.setItem("rustify-mode", "local"));
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Your albums" }),
  ).toBeVisible();
}
async function playlist(page) {
  await page.locator('.library-item[data-id="late-nights"]').click();
  await expect(
    page.getByRole("heading", { name: "Late nights", exact: true }),
  ).toBeVisible();
}
test("actual audio decodes, plays, seeks, pauses and advances", async ({
  page,
}) => {
  await local(page);
  await playlist(page);
  await page.locator('tr[data-track="night-drive"]').click();
  await expect(
    page.getByRole("button", { name: "Pause", exact: true }),
  ).toBeVisible();
  await expect
    .poll(() => page.locator("#audio-engine").evaluate((a) => a.currentTime))
    .toBeGreaterThan(0.1);
  expect(await page.locator("#audio-engine").evaluate((a) => a.duration)).toBe(
    16,
  );
  await page.locator("#seek").fill("7");
  await page.locator("#seek").dispatchEvent("change");
  await expect
    .poll(() => page.locator("#audio-engine").evaluate((a) => a.currentTime))
    .toBeGreaterThanOrEqual(7);
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  expect(await page.locator("#audio-engine").evaluate((a) => a.paused)).toBe(
    true,
  );
  await page.getByRole("button", { name: "Next track", exact: true }).click();
  await expect(page.locator(".current-track strong")).toHaveText("Soft Focus");
});
test("likes and playlist edits survive reload", async ({ page }) => {
  await local(page);
  await playlist(page);
  await page.locator('tr[data-track="night-drive"] .like-row').click();
  await page
    .getByRole("button", { name: "Create playlist", exact: true })
    .first()
    .click();
  await page.getByLabel("Name", { exact: true }).fill("A <night> & day");
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "A <night> & day", exact: true }),
  ).toBeVisible();
  await page.reload();
  await page.locator('.library-item[data-route="liked"]').click();
  await expect(page.locator('tr[data-track="night-drive"]')).toBeVisible();
  await expect(
    page.locator(".library-item strong").filter({ hasText: "A <night> & day" }),
  ).toBeVisible();
});
test("imported audio persists in IndexedDB and plays after restart", async ({
  page,
}) => {
  await local(page);
  await page.locator("#file-import").setInputFiles({
    name: "My recording.wav",
    mimeType: "audio/wav",
    buffer: readFileSync(
      new URL("../public/audio/night-drive.wav", import.meta.url),
    ),
  });
  await expect(
    page.locator(".song-title").filter({ hasText: "My recording" }),
  ).toBeVisible();
  await page.reload();
  await page.locator('[data-route="local"]').first().click();
  await page.locator("tr").filter({ hasText: "My recording" }).click();
  await expect(
    page.getByRole("button", { name: "Pause", exact: true }),
  ).toBeVisible();
  await expect
    .poll(() => page.locator("#audio-engine").evaluate((a) => a.currentTime))
    .toBeGreaterThan(0);
});
test("queue honors manual enqueue, removes queued songs and shows next track", async ({
  page,
}) => {
  await local(page);
  await playlist(page);
  await page.locator('tr[data-track="night-drive"]').click();
  await page.getByRole("button", { name: "Options for Blue Hour" }).click();
  await page.getByRole("button", { name: "Add to queue", exact: true }).click();
  await page.getByRole("button", { name: "Show queue" }).click();
  await expect(page.locator(".side-panel .queue-item").nth(1)).toContainText(
    "Blue Hour",
  );
  await page
    .getByRole("button", { name: "Remove Blue Hour from queue", exact: true })
    .first()
    .click();
  await expect(page.locator(".side-panel .queue-item").nth(1)).toContainText(
    "Soft Focus",
  );
  await page.getByRole("button", { name: "Options for Blue Hour" }).click();
  await page.getByRole("button", { name: "Add to queue", exact: true }).click();
  await page.getByRole("button", { name: "Next track", exact: true }).click();
  await expect(page.locator(".current-track strong")).toHaveText("Blue Hour");
  await expect(page.locator(".side-panel .queue-item").first()).toContainText(
    "Blue Hour",
  );
});
test("search, playlist add/remove, keyboard control and responsive layout", async ({
  page,
}) => {
  await local(page);
  await page
    .getByRole("textbox", { name: "Search music", exact: true })
    .fill("blue");
  await expect(page.locator("tbody tr")).toHaveCount(1);
  await page.getByRole("button", { name: "Options for Blue Hour" }).click();
  await page
    .getByRole("button", { name: "Add to playlist", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Slow mornings", exact: true })
    .last()
    .click();
  await page.locator('.library-item[data-id="slow-mornings"]').click();
  await expect(page.locator('tr[data-track="blue-hour"]')).toHaveCount(1);
  await page.getByRole("button", { name: "Options for Blue Hour" }).click();
  await page
    .getByRole("button", { name: "Remove from this playlist", exact: true })
    .click();
  await expect(page.locator('tr[data-track="blue-hour"]')).toHaveCount(0);
  await page.keyboard.press("Control+k");
  await expect(
    page.getByRole("textbox", { name: "Search music", exact: true }),
  ).toBeFocused();
  await page.locator('tr[data-track="daylight"]').click();
  await page.keyboard.press("Space");
  expect(await page.locator("#audio-engine").evaluate((a) => a.paused)).toBe(
    true,
  );
  await page.setViewportSize({ width: 860, height: 700 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
test("browser sign-in clearly reports native requirement and dialog traps focus", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Connect to Spotify", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toContainText("Tauri desktop app");
  // The dialog focuses its first control on a timer; let that settle first.
  await expect(page.getByRole("button", { name: "Close dialog", exact: true })).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(
    page.getByRole("button", { name: "Continue to Spotify", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("button", { name: "Close dialog", exact: true }),
  ).toBeFocused();

  await page.getByLabel("Spotify Developer Client ID").fill("a".repeat(32));
  await page.getByRole("button", { name: "Continue to Spotify" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "requires the Tauri desktop app",
  );
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});
async function fakeSpotify(page, restore = false, options = {}) {
  await page.addInitScript(
    ({ demo, restore, options }) => {
      window.isTauri = true;
      window.calls = [];
      const album = {
        id: "remote-album",
        name: "Remote album",
        uri: "spotify:album:remote-album",
        images: [],
        artists: [{ id: "remote-artist", name: "Remote artist" }],
        total_tracks: 3,
        album_type: "album",
        release_date: "2026-01-01",
      };
      const track = {
        id: "remote-track",
        name: "Remote song",
        type: "track",
        uri: "spotify:track:remote-track",
        duration_ms: 200000,
        artists: album.artists,
        album,
      };
      const other = {
        ...track,
        id: "other-track",
        name: "Other song",
        uri: "spotify:track:other-track",
      };
      const pool = Array.from({ length: options.large ? 137 : 1 }, (_, i) =>
        i
          ? {
              ...track,
              id: `pool-${i}`,
              uri: `spotify:track:pool-${i}`,
              name: `Pool song ${i}`,
            }
          : track,
      );
      const byURI = (uri) =>
        [...pool, other].find((t) => t.uri === uri) || {
          ...track,
          id: uri.split(":").at(-1),
          uri,
        };
      const playlist = {
        id: "remote-playlist",
        name: "My Spotify playlist",
        uri: "spotify:playlist:remote-playlist",
        description: "My saved collection",
        images: [],
        owner: { id: "me", display_name: "You" },
        items: { total: pool.length },
      };
      let active = track,
        playing = options.paused ? false : true,
        context = null,
        order = [track.uri],
        cursor = 0,
        savedAlbum = true,
        staleQueue = [];
      window.testExternalAdvance = () => {
        active = pool[1] || other;
        playing = true;
      };
      window.__TAURI_INTERNALS__ = {
        invoke: async (command, args) => {
          window.calls.push({ command, args });
          if (command === "island_toggle") return (window.islandOpen = !window.islandOpen);
          if (command === "plugin:event|listen") { (window.eventHandlers ||= {})[args.event] = args.handler; return args.handler; }
          if (command === "plugin:event|emit_to") { (window.emitted ||= []).push(args); return null; }
          if (command === "spotify_player_start") { window.playerStarted = true; return "rustify-player"; }
          if (command === "spotify_player_status") return { device_id: window.playerStarted ? "rustify-player" : null, starting: false, error: null };
          if (command === "spotify_player_stop") { window.playerStarted = false; return null; }
          if (command === "get_library") return demo;
          if (command === "spotify_restore")
            return restore && !localStorage.getItem("test-disconnected")
              ? { id: "me", display_name: "Listener" }
              : null;
          if (command === "spotify_disconnect") {
            localStorage.setItem("test-disconnected", "true");
            return null;
          }
          if (command === "spotify_connect")
            return { id: "me", display_name: "Listener" };
          if (command === "shuffle_tracks") {
            if (window.delayNextShuffle) {
              window.delayNextShuffle = false;
              await new Promise((resolve) => (window.releaseShuffle = resolve));
            }
            const ids = [...new Set(args.ids)]
              .filter((id) => id !== args.keepFirst)
              .reverse();
            return args.keepFirst ? [args.keepFirst, ...ids] : ids;
          }
          if (command === "spotify_request") {
            const p = args.path,
              url = new URL(p, "https://api.test"),
              offset = Number(url.searchParams.get("offset") || 0);
            if (
              p.startsWith("/me/player/shuffle") &&
              window.delayDeviceShuffle
            ) {
              window.delayDeviceShuffle = false;
              await new Promise(
                (resolve) => (window.releaseDeviceShuffle = resolve),
              );
            }

            if (p === "/me/player" && args.method === "PUT") { window.selectedDevice = args.body.device_ids[0]; return null; }
            if (options.noDevices && !window.selectedDevice && p === "/me/player") return null;
            if (p === "/me/player") {
              if (window.delayNextPlayer) {
                window.delayNextPlayer = false;
                await new Promise(
                  (resolve) => (window.releasePlayer = resolve),
                );
              }
              return {
                item: active,
                is_playing: playing,
                progress_ms: 1000,
                repeat_state: "off",
                shuffle_state: false,
                context,
                device: {
                  id: window.selectedDevice || "device",
                  name: window.selectedDevice === "rustify-player" ? "Rustify" : "My speaker",
                  volume_percent: 60,
                  supports_volume: true,
                },
              };
            }
            if (options.staleDevice && !window.selectedDevice && p.startsWith("/me/player/play")) throw "No active Spotify device or this item is unavailable.";
            if (p.startsWith("/me/player/play")) {
              staleQueue = order.slice(cursor + 1, cursor + 21);
              if (args.body?.uris) {
                order = [...args.body.uris];
                cursor = 0;
                context = null;
              } else if (args.body?.context_uri) {
                context = { uri: args.body.context_uri };
                const content = context.uri.endsWith("other-playlist")
                  ? [other]
                  : pool;
                order = content.map((t) => t.uri);
                cursor = args.body.offset?.uri
                  ? Math.max(0, order.indexOf(args.body.offset.uri))
                  : 0;
              }
              active = byURI(order[cursor]);
              playing = true;
              return null;
            }
            if (p.startsWith("/me/player/pause")) {
              playing = false;
              return null;
            }
            if (p.startsWith("/me/player/next")) {
              cursor = Math.min(cursor + 1, order.length - 1);
              active = byURI(order[cursor]);
              return null;
            }
            if (p.startsWith("/me/player/previous")) {
              cursor = Math.max(0, cursor - 1);
              active = byURI(order[cursor]);
              return null;
            }
            if (p === "/me/player/queue") {
              if (window.forceForeignQueue) return { queue: [other] };
              const items =
                window.staleQueueReads > 0
                  ? (window.staleQueueReads--, staleQueue)
                  : order.slice(cursor + 1, cursor + 21);
              return { queue: items.map(byURI) };
            }
            if (p.startsWith("/me/playlists"))
              return {
                items: [
                  playlist,
                  {
                    ...playlist,
                    id: "other-playlist",
                    name: "Another playlist",
                    uri: "spotify:playlist:other-playlist",
                  },
                ],
                next: null,
              };
            if (p.startsWith("/me/tracks")) {
              if (window.delayNextSaved) {
                window.delayNextSaved = false;
                await new Promise((resolve) => (window.releaseSaved = resolve));
              }
              const items = pool
                .slice(offset, offset + 50)
                .map((track) => ({ track, added_at: "2026-11-01T12:00:00Z" }));
              return {
                items,
                total: pool.length,
                next: offset + items.length < pool.length ? "next" : null,
              };
            }
            if (p.startsWith("/me/albums"))
              return { items: savedAlbum ? [{ album }] : [], next: null };
            if (p.startsWith("/me/library/contains"))
              return (url.searchParams.get("uris") || "")
                .split(",")
                .map((uri) =>
                  uri.startsWith("spotify:album:") ? savedAlbum : true,
                );
            if (
              p.startsWith("/me/library?") &&
              url.searchParams.get("uris")?.startsWith("spotify:album:")
            ) {
              savedAlbum = args.method === "PUT";
              return null;
            }
            if (p.startsWith("/playlists/")) {
              const content = p.includes("other-playlist") ? [other] : pool;
              const items = content
                .slice(offset, offset + 50)
                .map((item) => ({ item, added_at: "2026-10-01T12:00:00Z" }));
              return {
                items,
                total: content.length,
                next: offset + items.length < content.length ? "next" : null,
              };
            }
            if (p.startsWith("/albums/") && p.includes("/tracks"))
              return {
                items: [
                  track,
                  {
                    ...track,
                    id: "album-track-2",
                    uri: "spotify:track:album-track-2",
                  },
                  {
                    ...track,
                    id: "album-track-3",
                    uri: "spotify:track:album-track-3",
                  },
                ],
                total: 3,
                next: null,
              };
            if (p.startsWith("/albums/")) return album;
            if (p.startsWith("/artists/") && p.includes("/albums")) {
              const count = options.artistPages ? 11 : 2;
              const items = Array.from(
                { length: Math.min(10, count - offset) },
                (_, i) => ({
                  ...album,
                  id: `release-${offset + i}`,
                  name: `Release ${offset + i}`,
                  uri: `spotify:album:release-${offset + i}`,
                }),
              );
              return {
                items,
                next: offset + items.length < count ? "next" : null,
              };
            }
            if (p.startsWith("/artists/"))
              return {
                id: "remote-artist",
                name: "Remote artist",
                images: [],
                followers: { total: 123 },
              };
            if (p.startsWith("/search"))
              return {
                tracks: {
                  items: [
                    {
                      ...track,
                      id: "outside-page",
                      uri: "spotify:track:outside-page",
                    },
                  ],
                  next: null,
                },
                artists: {
                  items: [
                    { id: "remote-artist", name: "Remote artist", images: [] },
                  ],
                  next: null,
                },
              };
            if (p === "/me/player/devices")
              return {
                devices: options.noDevices ? [] : [
                  { id: "device", name: "My speaker", is_active: true },
                ],
              };
            return null;
          }
        },
        convertFileSrc: (path) => path,
        transformCallback: (callback) => {
          const id = (window.nextCallback = (window.nextCallback || 0) + 1);
          (window.callbacks ||= {})[id] = callback;
          return id;
        },
      };
      // Delivers a Tauri event to the app, as the island window would.
      window.fireEvent = (event, payload) => window.callbacks[window.eventHandlers[event]]({ event, id: 1, payload });
      localStorage.setItem("rustify-mode", "spotify");
    },
    { demo, restore, options },
  );
  await page.goto("/");
  if (restore) {
    await expect(page.locator(".avatar")).toHaveText("L");
    return;
  }
  await page
    .getByRole("button", { name: "Connect to Spotify", exact: true })
    .click();
  await page.getByLabel("Spotify Developer Client ID").fill("a".repeat(32));
  await page.getByRole("button", { name: "Continue to Spotify" }).click();
  await expect(page.locator(".avatar")).toHaveText("L");
}
test("Spotify IPC contract uses 2026 items endpoint, context offset and encoded library URI", async ({
  page,
}) => {
  await fakeSpotify(page);
  await page.locator('.library-item[data-id="remote-playlist"]').click();
  await expect(
    page.getByRole("heading", { name: "My Spotify playlist", exact: true }),
  ).toBeVisible();
  await page.locator('tr[data-track="remote-track"] .song-title').click();
  const play = await page.evaluate(() =>
    window.calls.find((c) => c.args?.path?.startsWith("/me/player/play")),
  );
  expect(play.args.body).toEqual({
    context_uri: "spotify:playlist:remote-playlist",
    offset: { uri: "spotify:track:remote-track" },
  });
  await page.locator('tr[data-track="remote-track"] .like-row').click();
  expect(
    await page.evaluate(() =>
      window.calls.some(
        (c) =>
          c.args?.method === "DELETE" &&
          c.args.path.startsWith("/me/library?uris=spotify%3Atrack%3A"),
      ),
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "Settings and account" }).click();
  await page
    .getByRole("button", { name: "Disconnect Spotify", exact: true })
    .click();
  await expect(page.locator('tr[data-track="remote-track"]')).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Connect to Spotify", exact: true }),
  ).toBeVisible();
});
test("Spotify search is paginated with limit10 and device selection uses transfer endpoint", async ({
  page,
}) => {
  await fakeSpotify(page);
  await page
    .getByRole("textbox", { name: "Search music", exact: true })
    .fill("ambient");
  await expect(page.locator(".song-title")).toHaveText("Remote song");
  expect(
    await page.evaluate(() =>
      window.calls.some((c) =>
        c.args?.path?.includes(
          "/search?q=ambient&type=track,artist,album,playlist&limit=10&offset=0",
        ),
      ),
    ),
  ).toBe(true);
  await page
    .getByRole("button", { name: "Connect to a device", exact: true })
    .click();
  await page.getByRole("button", { name: /My speaker/ }).click();
  expect(
    await page.evaluate(() =>
      window.calls.some(
        (c) =>
          c.args?.method === "PUT" &&
          c.args?.path === "/me/player" &&
          c.args.body.device_ids[0] === "device",
      ),
    ),
  ).toBe(true);
});
test("source switch rejects late remote playback responses", async ({
  page,
}) => {
  await fakeSpotify(page);
  await page.evaluate(() => (window.delayNextPlayer = true));
  await page.getByRole("button", { name: "Next track", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => Boolean(window.releasePlayer)))
    .toBe(true);
  await page.getByRole("button", { name: "Spotify", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Your albums" }),
  ).toBeVisible();
  await page.locator('.library-item[data-id="late-nights"]').click();
  await page.locator('tr[data-track="night-drive"]').click();
  await expect(page.locator(".current-track strong")).toHaveText("Night Drive");
  await page.evaluate(() => window.releasePlayer());
  await page.waitForTimeout(100);
  await expect(page.locator(".current-track strong")).toHaveText("Night Drive");
  await page.getByRole("button", { name: "Settings and account" }).click();
  await page
    .getByRole("button", { name: "Disconnect Spotify", exact: true })
    .click();
  await expect(page.locator(".current-track strong")).toHaveText("Night Drive");
  expect(await page.locator("#audio-engine").evaluate((a) => a.paused)).toBe(
    false,
  );
});

test("saved status outside loaded page is checked before unlike", async ({
  page,
}) => {
  await fakeSpotify(page);
  await page
    .getByRole("textbox", { name: "Search music", exact: true })
    .fill("outside");
  await expect(
    page.locator('tr[data-track="outside-page"] .like-row'),
  ).toHaveAttribute("aria-label", "Remove from Liked Songs");
  await page.locator('tr[data-track="outside-page"] .like-row').click();
  expect(
    await page.evaluate(() =>
      window.calls.some(
        (c) =>
          c.args?.method === "DELETE" &&
          c.args.path === "/me/library?uris=spotify%3Atrack%3Aoutside-page",
      ),
    ),
  ).toBe(true);
});

test("saved session restores at startup and explicit disconnect stays signed out", async ({
  page,
}) => {
  await fakeSpotify(page, true);
  await expect(
    page.locator('.library-item[data-id="remote-playlist"]'),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => window.calls.filter((c) => c.command === "spotify_connect").length,
    ),
  ).toBe(0);
  await page.getByRole("button", { name: "Settings and account" }).click();
  await page
    .getByRole("button", { name: "Disconnect Spotify", exact: true })
    .click();
  await page.reload();
  await expect(page.locator(".avatar")).toHaveText("R");
  await expect(page.locator(".connect-top")).toBeVisible();
});
test("locked credential storage preserves local library access", async ({
  page,
}) => {
  await page.addInitScript(
    ({ demo }) => {
      window.isTauri = true;
      localStorage.setItem("rustify-mode", "local");
      window.__TAURI_INTERNALS__ = {
        invoke: async (command) => {
          if (command === "get_library") return demo;
          if (command === "spotify_restore")
            throw Error("Unlock your system credential store");
        },
      };
    },
    { demo },
  );
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Your albums" }),
  ).toBeVisible();
  await expect(page.getByRole("alert")).toContainText(
    "Unlock your system credential store",
  );
});

test("local True shuffle plays every track exactly once and stops at the end", async ({
  page,
}) => {
  await local(page);
  await playlist(page);
  await page.locator('.playlist-actions [data-action="shuffle"]').click();
  await page
    .getByRole("button", { name: "Play Late nights", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Pause", exact: true }),
  ).toBeVisible();
  const titles = [];
  for (let i = 0; i < 4; i++) {
    titles.push(await page.locator(".current-track strong").textContent());
    await page.getByRole("button", { name: "Next track", exact: true }).click();
  }
  expect(new Set(titles).size).toBe(4);
  expect(await page.locator("#audio-engine").evaluate((a) => a.paused)).toBe(
    true,
  );
});
test("True shuffle loads and submits all137 tracks, disables device shuffle and confirms the queue", async ({
  page,
}) => {
  await fakeSpotify(page, false, { large: true });
  await page.locator('.library-item[data-route="liked"]').click();
  await page.locator('.playlist-actions [data-action="shuffle"]').click();
  await expect(page.getByRole("status")).toContainText("137 unique songs");
  const request = await page.evaluate(() =>
    window.calls
      .filter((c) => c.args?.path?.startsWith("/me/player/play"))
      .at(-1),
  );
  expect(request.args.body.uris).toHaveLength(137);
  expect(request.args.body.offset).toEqual({ position: 0 });
  expect(new Set(request.args.body.uris).size).toBe(137);
  expect(
    await page.evaluate(() =>
      window.calls.some(
        (c) => c.args?.path === "/me/tracks?limit=50&offset=100",
      ),
    ),
  ).toBe(true);
  expect(
    await page.evaluate(() =>
      window.calls.some((c) =>
        c.args?.path?.startsWith("/me/player/shuffle?state=false"),
      ),
    ),
  ).toBe(true);
});
test("turning shuffle off cancels a pending full-library start", async ({
  page,
}) => {
  await fakeSpotify(page, false, { large: true });
  await page.locator('.library-item[data-route="liked"]').click();
  await page.evaluate(() => (window.delayNextSaved = true));
  await page.locator('.playlist-actions [data-action="shuffle"]').click();
  await expect
    .poll(() => page.evaluate(() => Boolean(window.releaseSaved)))
    .toBe(true);
  await page.locator('.player [data-action="shuffle"]').click();
  await page.evaluate(() => window.releaseSaved());
  await page.waitForTimeout(150);
  expect(
    await page.evaluate(
      () =>
        window.calls.filter((c) => c.args?.path?.startsWith("/me/player/play"))
          .length,
    ),
  ).toBe(0);
  await expect(page.locator('.player [data-action="shuffle"]')).not.toHaveClass(
    /active/,
  );
});
test("paused Off→On→Play clears the old sequential plan", async ({ page }) => {
  await fakeSpotify(page, false, { large: true });
  await page.locator('.library-item[data-route="liked"]').click();
  await page.locator('.playlist-actions [data-action="shuffle"]').click();
  await expect(page.getByRole("status")).toContainText("137 unique songs");
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await page.locator('.playlist-actions [data-action="shuffle"]').click();
  await page.locator('.playlist-actions [data-action="shuffle"]').click();
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("137 unique songs");
  const body = await page.evaluate(
    () =>
      window.calls
        .filter((c) => c.args?.path?.startsWith("/me/player/play"))
        .at(-1).args.body,
  );
  expect(body.uris[1]).toBe("spotify:track:pool-136");
  expect(body.uris).toHaveLength(137);
});
test("reshuffle keeps the active collection when another playlist is browsed", async ({
  page,
}) => {
  await fakeSpotify(page, false, { large: true });
  await page.locator('.library-item[data-id="remote-playlist"]').click();
  await page.locator('.playlist-actions [data-action="shuffle"]').click();
  await expect(page.getByRole("status")).toContainText("137 unique songs");
  await page.locator('.library-item[data-id="other-playlist"]').click();
  await page.locator('.playlist-actions [data-action="reshuffle"]').click();
  await expect(page.getByRole("status")).toContainText("137 unique songs");
  await page.locator('.playlist-actions [data-action="shuffle"]').click();
  const body = await page.evaluate(
    () =>
      window.calls
        .filter((c) => c.args?.path?.startsWith("/me/player/play"))
        .at(-1).args.body,
  );
  expect(body.context_uri).toBe("spotify:playlist:remote-playlist");
});
test("saved albums are independent from song likes and artist releases are paginated", async ({
  page,
}) => {
  await fakeSpotify(page, false, { artistPages: true });
  await page.getByRole("button", { name: "Albums", exact: true }).click();
  await page.locator('.library-item[data-id="remote-album"]').click();
  await page
    .getByRole("button", { name: "Remove saved album", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Save album", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(() =>
      window.calls.some(
        (c) =>
          c.args?.method === "DELETE" &&
          c.args.path === "/me/library?uris=spotify%3Aalbum%3Aremote-album",
      ),
    ),
  ).toBe(true);
  expect(
    await page.evaluate(() =>
      window.calls.some(
        (c) =>
          c.args?.method === "DELETE" &&
          c.args.path.includes("spotify%3Atrack"),
      ),
    ),
  ).toBe(false);
  await page
    .locator('tbody tr .song-artist [data-route="artist"]')
    .first()
    .click();
  await expect(
    page.getByRole("heading", { name: "Remote artist", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".content .album-card")).toHaveCount(10);
  await page.getByRole("button", { name: "Load more releases" }).click();
  await expect(page.locator(".content .album-card")).toHaveCount(11);
  expect(
    await page.evaluate(() =>
      window.calls.some(
        (c) =>
          c.args?.path ===
          "/artists/remote-artist/albums?include_groups=album,single&limit=10&offset=10",
      ),
    ),
  ).toBe(true);
});
test("saved song date remains distinct from its playlist membership after playback", async ({
  page,
}) => {
  await fakeSpotify(page);
  await page.locator('.library-item[data-route="liked"]').click();
  await expect(page.locator("tbody .date-added").first()).toContainText("Nov");
  await page.locator('tr[data-track="remote-track"] .song-title').click();
  await page.locator('.library-item[data-id="remote-playlist"]').click();
  await expect(page.locator("tbody .date-added").first()).toContainText("Oct");
  await page.locator('.library-item[data-route="liked"]').click();
  await expect(page.locator("tbody .date-added").first()).toContainText("Nov");
});
test("panel widths persist and separators work with keyboard and pointer", async ({
  page,
}) => {
  await local(page);
  const left = page.getByRole("separator", { name: "Resize library" });
  const before = await page
    .locator(".library")
    .evaluate((el) => el.getBoundingClientRect().width);
  await left.focus();
  await page.keyboard.press("ArrowRight");
  const after = await page
    .locator(".library")
    .evaluate((el) => el.getBoundingClientRect().width);
  expect(after).toBeGreaterThan(before);
  const right = page.getByRole("separator", { name: "Resize now playing" });
  const box = await right.boundingBox();
  await page.mouse.move(box.x + 4, box.y + 100);
  await page.mouse.down();
  await page.mouse.move(box.x - 28, box.y + 100);
  await page.mouse.up();
  const rightWidth = await page
    .locator(".side-panel")
    .evaluate((el) => el.getBoundingClientRect().width);
  await page.reload();
  expect(
    await page
      .locator(".library")
      .evaluate((el) => el.getBoundingClientRect().width),
  ).toBe(after);
  expect(
    await page
      .locator(".side-panel")
      .evaluate((el) => el.getBoundingClientRect().width),
  ).toBe(rightWidth);
});

test("new collection playback clears a deferred order from the old playlist", async ({
  page,
}) => {
  await fakeSpotify(page, false, { large: true });
  await page.locator('.library-item[data-id="remote-playlist"]').click();
  await page.locator('.playlist-actions [data-action="shuffle"]').click();
  await expect(page.getByRole("status")).toContainText("137 unique songs");
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await page.locator('.playlist-actions [data-action="shuffle"]').click();
  await page.locator('.library-item[data-id="other-playlist"]').click();
  await page.locator('tr[data-track="other-track"] .song-title').click();
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await page.getByRole("button", { name: "Play", exact: true }).click();
  const last = await page.evaluate(() =>
    window.calls
      .filter((c) => c.args?.path?.startsWith("/me/player/play"))
      .at(-1),
  );
  expect(last.args.body).toBe(null);
  await expect(page.locator(".current-track strong")).toHaveText("Other song");
});
test("shuffle cancellation while Rust generates an order cannot start playback", async ({
  page,
}) => {
  await fakeSpotify(page, false, { large: true });
  await page.locator('.library-item[data-route="liked"]').click();
  await page.evaluate(() => (window.delayNextShuffle = true));
  await page.locator('.playlist-actions [data-action="shuffle"]').click();
  await expect
    .poll(() => page.evaluate(() => Boolean(window.releaseShuffle)))
    .toBe(true);
  await page.locator('.player [data-action="shuffle"]').click();
  await page.evaluate(() => window.releaseShuffle());
  await page.waitForTimeout(100);
  expect(
    await page.evaluate(
      () =>
        window.calls.filter((c) => c.args?.path?.startsWith("/me/player/play"))
          .length,
    ),
  ).toBe(0);
});
test("shuffle waits for the upcoming queue rather than only an unchanged current song", async ({
  page,
}) => {
  await fakeSpotify(page, false, { large: true });
  await page.locator('.library-item[data-route="liked"]').click();
  await page.evaluate(() => (window.staleQueueReads = 3));
  await page.locator('.playlist-actions [data-action="shuffle"]').click();
  await expect(page.getByRole("status")).toContainText("137 unique songs");
  expect(await page.evaluate(() => window.staleQueueReads)).toBe(0);
});

test("an older shuffle-Off response cannot clear a newer On plan", async ({
  page,
}) => {
  await fakeSpotify(page, false, { large: true });
  await page.locator('.library-item[data-route="liked"]').click();
  await page.locator('.playlist-actions [data-action="shuffle"]').click();
  await expect(page.getByRole("status")).toContainText("137 unique songs");
  await page.evaluate(() => (window.delayDeviceShuffle = true));
  await page.locator('.playlist-actions [data-action="shuffle"]').click();
  await expect
    .poll(() => page.evaluate(() => Boolean(window.releaseDeviceShuffle)))
    .toBe(true);
  await page.locator('.player [data-action="shuffle"]').click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          window.calls.filter((c) =>
            c.args?.path?.startsWith("/me/player/play"),
          ).length,
      ),
    )
    .toBe(2);
  await page.evaluate(() => window.releaseDeviceShuffle());
  await page.waitForTimeout(100);
  await page.getByRole("button", { name: "Show queue", exact: true }).click();
  await expect(page.locator(".shuffle-note")).toContainText("136 songs left");
  expect(
    await page.evaluate(
      () =>
        window.calls.filter((c) => c.args?.path?.startsWith("/me/player/play"))
          .length,
    ),
  ).toBe(2);
});
test("a track that advances during full-library loading is not restarted", async ({
  page,
}) => {
  await fakeSpotify(page, false, { large: true });
  await page.locator('.library-item[data-route="liked"]').click();
  await page.evaluate(() => (window.delayNextSaved = true));
  await page.locator('.playlist-actions [data-action="shuffle"]').click();
  await expect
    .poll(() => page.evaluate(() => Boolean(window.releaseSaved)))
    .toBe(true);
  await page.evaluate(() => {
    window.testExternalAdvance();
    window.releaseSaved();
  });
  await expect(page.getByRole("alert")).toContainText("Playback changed while");
  expect(
    await page.evaluate(
      () =>
        window.calls.filter((c) => c.args?.path?.startsWith("/me/player/play"))
          .length,
    ),
  ).toBe(0);
});

test("typing an artist shows a directly selectable artist profile in default results", async ({
  page,
}) => {
  await fakeSpotify(page);
  await page
    .getByRole("textbox", { name: "Search music", exact: true })
    .fill("Remote artist");
  await expect(page.locator(".top-result .artist-card")).toContainText(
    "Remote artist",
  );
  await page.locator('.top-result [data-route="artist"]').click();
  await expect(
    page.getByRole("heading", { name: "Remote artist", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(() =>
      window.calls.some((c) => c.args?.path === "/artists/remote-artist"),
    ),
  ).toBe(true);
});
test("starting another playlist creates a pool containing only that playlist", async ({
  page,
}) => {
  await fakeSpotify(page, false, { large: true });
  await page.locator('.library-item[data-id="remote-playlist"]').click();
  await page.locator('.playlist-actions [data-action="shuffle"]').click();
  await expect(page.getByRole("status")).toContainText("137 unique songs");
  await page.locator('.library-item[data-id="other-playlist"]').click();
  await page.locator(".big-play").click();
  await expect(page.getByRole("status")).toContainText("1 unique song");
  const uris = await page.evaluate(
    () =>
      window.calls
        .filter((c) => c.args?.path?.startsWith("/me/player/play"))
        .at(-1).args.body.uris,
  );
  expect(uris).toEqual(["spotify:track:other-track"]);
  await page.getByRole("button", { name: "Show queue", exact: true }).click();
  await expect(page.locator(".shuffle-source")).toHaveText("Another playlist");
});

test("unconfirmed foreign queue is paused rather than reported as successful shuffle", async ({
  page,
}) => {
  await fakeSpotify(page, false, { large: true });
  await page.locator('.library-item[data-route="liked"]').click();
  await page.evaluate(() => (window.forceForeignQueue = true));
  await page.locator('.playlist-actions [data-action="shuffle"]').click();
  await expect(page.getByRole("alert")).toContainText(
    "has not confirmed this order",
  );
  await expect(
    page.getByRole("button", { name: "Play", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(() =>
      window.calls.some((c) => c.args?.path?.startsWith("/me/player/pause")),
    ),
  ).toBe(true);
});

// Native playback projections can omit linked_from and ISRC even when catalog metadata provides it.
test("regional playback aliases confirm and remain canonical after skipping beyond initial queue", async ({page}) => {
  await fakeSpotify(page,false,{large:true});
  await page.evaluate(()=>{
    const original=window.__TAURI_INTERNALS__.invoke;
    const alias=t=>t?{...t,id:`alias-${t.id}`,uri:`spotify:track:alias-${t.id}`}:t;
    window.__TAURI_INTERNALS__.invoke=async(command,args)=>{
      if(command==='spotify_request'&&args.path.startsWith('/tracks/'))return {external_ids:{isrc:decodeURIComponent(args.path.split('/').at(-1)).replace(/^alias-/,'')}};
      const result=await original(command,args);
      if(command==='spotify_request'&&args.path==='/me/player')return {...result,item:alias(result.item)};
      if(command==='spotify_request'&&args.path==='/me/player/queue')return {...result,queue:result.queue.map(alias)};
      return result;
    };
  });
  await page.locator('.library-item[data-route="liked"]').click();
  await page.locator('.playlist-actions [data-action="shuffle"]').click();
  await page.locator('.big-play').click();
  await expect(page.getByRole('status')).toContainText('137 unique songs');
  // Cross the initial 20-song confirmation window and retain canonical seen IDs.
  for(let i=0;i<22;i++)await page.getByRole('button',{name:'Next track',exact:true}).click();
  await page.getByRole('button',{name:'Show queue',exact:true}).click();
  await expect(page.locator('.shuffle-note')).toContainText('114 songs left');
  await page.getByRole('button',{name:'Reshuffle remaining',exact:true}).click();
  await expect(page.getByRole('status')).toContainText('115 unique songs');
});


test("Rustify built-in player replaces the need for another Spotify app", async ({ page }) => {
  await fakeSpotify(page, true, { noDevices: true });
  await page.getByRole("button", { name: "Connect to a device", exact: true }).click();
  await expect(page.getByText("No other devices found.", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Play on this computer", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(await page.evaluate(() => window.selectedDevice)).toBe("rustify-player");
  expect(await page.evaluate(() => window.calls.some(c => c.command === "spotify_player_start"))).toBe(true);
});

test("play automatically sets up Rustify audio when no Spotify device exists", async ({ page }) => {
  await fakeSpotify(page, true, { noDevices: true });
  await page.getByRole("textbox", { name: "Search music", exact: true }).fill("ambient");
  await page.getByRole("row", { name: "Play Remote song by Remote artist", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.calls.some(c => c.args?.path?.startsWith("/me/player/play") && c.args.path.includes("device_id=rustify-player")))).toBe(true);
});

test("closing the previous Spotify app recovers from its stale device", async ({ page }) => {
  await fakeSpotify(page, true, { noDevices: true, staleDevice: true });
  // Simulate an initially advertised device that disappears before Play.
  // noDevices yields no initial player, so inject that last known player once.
  await page.evaluate(() => {
    const original = window.__TAURI_INTERNALS__.invoke;
    let returned = false;
    window.__TAURI_INTERNALS__.invoke = async (command, args) => {
      if (command === "spotify_request" && args.path === "/me/player" && args.method === "GET" && !returned) {
        returned = true;
        return { item: { id:"remote-track",name:"Remote song",uri:"spotify:track:remote-track",artists:[],duration_ms:200000 }, is_playing:false, device:{id:"closed-device"} };
      }
      return original(command, args);
    };
  });
  await page.getByRole("button", { name: "Next track", exact: true }).click();
  await expect(page.locator(".current-track strong")).toHaveText("Remote song");
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.selectedDevice)).toBe("rustify-player");
});

test("island opens from the player bar, mirrors playback and sends commands", async ({ page }) => {
  await fakeSpotify(page, true);
  await page.getByRole("button", { name: "Toggle floating island", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.calls.some((c) => c.command === "island_toggle"))).toBe(true);
  await expect.poll(() => page.evaluate(() => Boolean(window.eventHandlers?.["island-ready"]))).toBe(true);
  await page.evaluate(() => window.fireEvent("island-ready"));
  const state = await page.evaluate(() => window.emitted.find((e) => e.event === "island-state")?.payload);
  expect(state).toMatchObject({ source: "spotify", playing: expect.any(Boolean) });
  expect(await page.evaluate(() => window.emitted.find((e) => e.event === "island-state").target)).toMatchObject({ label: "island" });
  await page.evaluate(() => window.fireEvent("island-command", "next"));
  await expect.poll(() => page.evaluate(() => window.calls.some((c) => c.args?.path?.startsWith("/me/player/next")))).toBe(true);
  await page.keyboard.press("Alt+I");
  await expect.poll(() => page.evaluate(() => window.calls.filter((c) => c.command === "island_toggle").length)).toBe(2);
});
