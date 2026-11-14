import { test } from "node:test";
import assert from "node:assert/strict";
import { loadFeatures } from "../src/features/registry.js";

const key = (key, extra = {}) => ({
  key, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false,
  target: { tagName: "BODY" }, preventDefault() { this.prevented = true; }, ...extra,
});

test("features expose actions, exports and shortcuts through the context", async () => {
  const seen = [];
  const features = loadFeatures(
    [{ name: "demo", setup: (ctx) => ({
      hello: () => ctx.value,
      actions: { greet: async (button) => seen.push(button) },
      shortcuts: [{ key: "g", alt: true, run: () => seen.push("shortcut") }],
    }) }],
    { value: 42 },
  );
  assert.equal(features.demo.hello(), 42);
  await features.action("greet")("button");
  assert.equal(features.action("missing"), undefined);
  const event = key("G", { altKey: true });
  assert.equal(features.shortcut(event), true);
  assert.equal(event.prevented, true);
  assert.equal(features.shortcut(key("g")), false, "modifiers must match");
  assert.equal(features.shortcut(key("g", { altKey: true, target: { tagName: "INPUT" } })), false, "typing is ignored");
  assert.deepEqual(seen, ["button", "shortcut"]);
});

test("duplicate action names are rejected", () => {
  const twice = { setup: () => ({ actions: { same() {} } }) };
  assert.throws(() => loadFeatures([{ name: "a", ...twice }, { name: "b", ...twice }], {}), /defined twice/);
});

test("notify reaches every listener and isolates a failing feature", () => {
  const got = [];
  const features = loadFeatures(
    [
      { name: "broken", setup: () => ({ on: { player() { throw new Error("boom"); } } }) },
      { name: "ok", setup: () => ({ on: { player: (s) => got.push(s.title) } }) },
    ],
    {},
  );
  const original = console.error;
  console.error = () => {};
  try { features.notify("player", { title: "Song" }); } finally { console.error = original; }
  features.notify("unknown", {});
  assert.deepEqual(got, ["Song"]);
});
