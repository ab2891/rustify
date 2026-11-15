import { test } from "node:test";
import assert from "node:assert/strict";
import { parseLRC, currentLine, soloistExpiry, estimateLines, sungLines, toLRC, plainText } from "../src/lyrics.js";

test("LRC text becomes timed lines", () => {
  const lines = parseLRC("[ar: Someone]\n[00:12.50] First\n[01:02.00][00:30.00] Again\nno tag\n[00:20.00]");
  assert.deepEqual(lines, [
    { time: 12.5, text: "First" },
    { time: 20, text: "" },
    { time: 30, text: "Again" },
    { time: 62, text: "Again" },
  ]);
  assert.equal(currentLine(lines, 5), -1);
  assert.equal(currentLine(lines, 12.5), 0);
  assert.equal(currentLine(lines, 45), 2);
  assert.equal(currentLine(lines, 999), 3);
  assert.deepEqual(parseLRC(null), []);
});

test("Soloist expiry is 90 days after the build date", () => {
  const { expires, daysLeft } = soloistExpiry("20261113", Date.UTC(2026, 10, 14));
  assert.equal(expires.toISOString().slice(0, 10), "2027-02-11");
  assert.equal(daysLeft, 89);
  assert.equal(soloistExpiry("unknown"), null);
});

test("untimed lyrics get estimated timings inside the song", () => {
  const text = "[Verse 1]\nShort\nA much longer line that takes more time to sing\n\n[Chorus]\nLast";
  assert.deepEqual(sungLines(text), ["Short", "A much longer line that takes more time to sing", "Last"]);
  const lines = estimateLines(text, 200);
  assert.deepEqual(lines.map((l) => l.text), sungLines(text));
  assert.ok(lines[0].time >= 12, "leaves room for an intro");
  assert.ok(lines.at(-1).time <= 188, "ends before the outro");
  assert.ok(lines[2].time - lines[1].time > lines[1].time - lines[0].time, "longer lines and pauses take longer");
  assert.deepEqual(estimateLines(text, 0), []);
});

test("tapped timings round-trip through LRC", () => {
  const lrc = toLRC(["One", "Two"], [1.5, 75.25]);
  assert.equal(lrc, "[00:01.50] One\n[01:15.25] Two");
  assert.deepEqual(parseLRC(lrc), [{ time: 1.5, text: "One" }, { time: 75.25, text: "Two" }]);
  assert.equal(plainText(lrc), "One\nTwo");
});

import { commonArtists } from "../src/features/suggestions.js";
import { ordered } from "../src/features/home.js";
import { genreBlocked } from "../src/features/rules.js";
import { record } from "../src/features/stats.js";

test("suggestions pick the most common artists and rotate on later rounds", () => {
  const tracks = [{ artist: "A, X" }, { artist: "A" }, { artist: "B" }, { artist: "B" }, { artist: "B" }, { artist: "C" }, { artist: "Unknown artist" }];
  assert.deepEqual(commonArtists(tracks, 2), ["B", "A"]);
  assert.deepEqual(commonArtists(tracks, 2, 1), ["C", "B"]);
  assert.deepEqual(commonArtists([], 2), []);
});

test("home order keeps saved choices and appends new sections", () => {
  assert.deepEqual(ordered(["albums", "gone", "quick"]), ["albums", "quick", "recent", "top", "playlists"]);
  assert.deepEqual(ordered(undefined), ["quick", "recent", "top", "playlists", "albums"]);
});

test("a blocked genre word matches inside an artist's genres", () => {
  assert.equal(genreBlocked(["Melodic Death Metal"], ["metal"]), true);
  assert.equal(genreBlocked(["indie pop"], ["metal"]), false);
  assert.equal(genreBlocked(undefined, ["metal"]), false);
});

test("the play log counts a play once per listen, after 30 seconds", () => {
  const log = { songs: {}, seconds: 0, plays: 0 };
  const session = { id: "", heard: 0, counted: false };
  const song = { id: "a", title: "A" };
  for (let i = 0; i < 29; i++) record(log, song, 1, session);
  assert.equal(log.plays, 0);
  for (let i = 0; i < 60; i++) record(log, song, 1, session);
  assert.equal(log.plays, 1);
  record(log, { id: "b", title: "B" }, 5, session);
  for (let i = 0; i < 31; i++) record(log, song, 1, session);
  assert.equal(log.songs.a.plays, 2);
  assert.equal(log.seconds, 125);
});
