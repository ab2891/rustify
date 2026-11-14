import { test } from "node:test";
import assert from "node:assert/strict";
import {
  Queue,
  shuffled,
  randomIndex,
  formatTime,
  escapeHTML,
} from "../src/player.js";
test("manual queue plays before context and previous follows actual history", () => {
  const q = new Queue();
  q.start(["a", "b", "c"]);
  q.enqueue("x");
  assert.equal(q.next(), "x");
  assert.equal(q.next(), "b");
  assert.equal(q.previous(), "x");
  assert.equal(q.previous(), "a");
});
test("natural completion repeats one, next skips it, repeat all starts a full new cycle", () => {
  const q = new Queue();
  q.start(["a", "b"]);
  q.cycleRepeat();
  q.cycleRepeat();
  assert.equal(q.next(true), "a");
  assert.equal(q.next(), "b");
  assert.equal(q.next(), null);
  q.repeat = "all";
  assert.equal(q.next(), "a");
});
test("shuffle is a complete no-repeat traversal and ends with repeat off", () => {
  const q = new Queue(() => 0);
  q.start(["a", "b", "c", "d"]);
  q.shuffle = true;
  const played = [q.current];
  for (let id; (id = q.next()) != null; ) played.push(id);
  assert.equal(played.length, 4);
  assert.equal(new Set(played).size, 4);
  assert.deepEqual([...played].sort(), ["a", "b", "c", "d"]);
  assert.equal(q.next(), null);
});
test("reshuffling preserves current and never brings back already-played or removed songs", () => {
  const q = new Queue(() => 0);
  q.start(["a", "b", "c", "d", "e"]);
  q.next();
  q.shuffle = true;
  const removed = q.upcoming()[0];
  q.removeUpcoming(0);
  q.reshuffle();
  assert.equal(q.current, "b");
  assert(!q.upcoming().includes("a"));
  assert(!q.upcoming().includes("b"));
  assert(!q.upcoming().includes(removed));
});
test("manually queueing an unplayed collection track consumes its original occurrence", () => {
  const q = new Queue();
  q.start(["a", "b", "c"]);
  q.enqueue("c");
  assert.deepEqual(q.upcoming(), ["c", "b"]);
  assert.equal(q.next(), "c");
  assert.equal(q.next(), "b");
  assert.equal(q.next(), null);
});
test("every three-track permutation has equal draw-count coverage", () => {
  const counts = new Map();
  for (let a = 0; a < 3; a++)
    for (let b = 0; b < 2; b++) {
      const draws = [a, b];
      const result = shuffled(["a", "b", "c"], () => draws.shift()).join("");
      counts.set(result, (counts.get(result) || 0) + 1);
    }
  assert.equal(counts.size, 6);
  assert([...counts.values()].every((count) => count === 1));
});
test("bounded cryptographic sampling rejects biased tail values", () => {
  const values = [0xffffffff, 5];
  let calls = 0;
  assert.equal(
    randomIndex(3, (array) => {
      array[0] = values[calls++];
    }),
    2,
  );
  assert.equal(calls, 2);
  assert.throws(() => randomIndex(0));
});
test("empty, single, duplicate and large pools preserve each unique track", () => {
  for (const size of [0, 1, 2, 101, 513]) {
    const ids = Array.from({ length: size }, (_, i) => String(i));
    const result = shuffled([...ids, ...ids]);
    assert.equal(result.length, size);
    assert.deepEqual(new Set(result), new Set(ids));
  }
  assert.deepEqual(
    shuffled(["a", "b", "a"], () => 0, "b"),
    ["b", "a"],
  );
});
test("repeat all creates another complete cycle with no lost or duplicate tracks", () => {
  const q = new Queue(() => 0);
  q.shuffle = true;
  q.start(["a", "b", "c"]);
  q.repeat = "all";
  const first = [q.current, q.next(), q.next()],
    second = [q.next(), q.next(), q.next()];
  assert.equal(new Set(first).size, 3);
  assert.equal(new Set(second).size, 3);
});
test("empty queue and escaped metadata are safe", () => {
  const q = new Queue();
  assert.equal(q.next(), null);
  assert.equal(q.previous(), null);
  assert.equal(formatTime(NaN), "0:00");
  assert.equal(formatTime(125.8), "2:05");
  assert.equal(escapeHTML('<script>"&'), "&lt;script&gt;&quot;&amp;");
});
