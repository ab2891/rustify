import { test } from "node:test";
import assert from "node:assert/strict";
import { allCollectionTracks } from "../src/collections.js";
const track = (i) => ({
  id: String(i),
  uri: `spotify:track:${i}`,
  name: `Track ${i}`,
  type: "track",
});
test("loads every playlist page well past100 before returning the shuffle pool", async () => {
  const calls = [];
  const result = await allCollectionTracks(
    { type: "playlist", id: "mine" },
    async (method, path) => {
      calls.push(path);
      const offset = Number(
        new URL(path, "https://example.test").searchParams.get("offset"),
      );
      const items = Array.from(
        { length: Math.min(50, 513 - offset) },
        (_, i) => ({ item: track(offset + i) }),
      );
      return { items, next: offset + items.length < 513 ? "next" : null };
    },
  );
  assert.equal(result.tracks.length, 513);
  assert.equal(new Set(result.tracks.map((t) => t.id)).size, 513);
  assert.equal(calls.length, 11);
  assert(calls.at(-1).endsWith("offset=500"));
});
test("deduplicates track URIs and reports unavailable or unsupported entries", async () => {
  const result = await allCollectionTracks({ type: "liked" }, async () => ({
    items: [
      { track: track(1) },
      { track: track(1) },
      { track: { ...track(2), is_playable: false } },
      { track: null },
      { track: { ...track(3), type: "episode" } },
      { track: track(4) },
    ],
    next: null,
  }));
  assert.deepEqual(
    result.tracks.map((t) => t.id),
    ["1", "4"],
  );
  assert.equal(result.duplicates, 1);
  assert.equal(result.unavailable, 3);
});
test("a failed later page never returns a partial shuffle pool", async () => {
  let calls = 0;
  await assert.rejects(
    () =>
      allCollectionTracks({ type: "liked" }, async () => {
        if (calls++) throw Error("rate limited");
        return { items: [{ track: track(1) }], next: "next" };
      }),
    /rate limited/,
  );
});
test("empty nonterminal pages fail rather than looping or silently losing songs", async () => {
  await assert.rejects(
    () =>
      allCollectionTracks({ type: "liked" }, async () => ({
        items: [],
        next: "next",
      })),
    /pagination stopped/,
  );
});
test("album pages retain album metadata for playback and navigation", async () => {
  const result = await allCollectionTracks(
    { type: "album", id: "album" },
    async (method, path) =>
      path === "/albums/album"
        ? { id: "album", name: "A release", images: [] }
        : { items: [track(1)], next: null },
  );
  assert.equal(result.tracks[0].album.id, "album");
});
