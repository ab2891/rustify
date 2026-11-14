// Browser preview fallback; native shuffle orders come from Rust/OsRng.
export function randomIndex(
  upper,
  fill = (value) => crypto.getRandomValues(value),
) {
  if (!Number.isInteger(upper) || upper < 1 || upper > 2 ** 32)
    throw new RangeError("Invalid random bound");
  const limit = 2 ** 32 - (2 ** 32 % upper),
    value = new Uint32Array(1);
  do {
    fill(value);
  } while (value[0] >= limit);
  return value[0] % upper;
}
export function shuffled(ids, draw = randomIndex, keepFirst = null) {
  const order = [...new Set(ids)];
  if (keepFirst != null) {
    const index = order.indexOf(keepFirst);
    if (index < 0)
      throw new Error("The current track is outside this collection.");
    order.splice(index, 1);
  }
  for (let i = order.length - 1; i > 0; i--) {
    const j = draw(i + 1);
    [order[i], order[j]] = [order[j], order[i]];
  }
  if (keepFirst != null) order.unshift(keepFirst);
  return order;
}
export class Queue {
  constructor(draw = randomIndex) {
    this.ids = [];
    this.sourceIds = [];
    this.index = -1;
    this.manual = [];
    this.played = new Set();
    this.skipped = new Set();
    this._shuffle = false;
    this.repeat = "off";
    this.draw = draw;
  }
  get current() {
    return this.ids[this.index] ?? null;
  }
  get shuffle() {
    return this._shuffle;
  }
  set shuffle(value) {
    this.setShuffle(value);
  }
  start(ids, id = null, order = null) {
    this.sourceIds = [...new Set(ids)];
    this.manual = [];
    this.played.clear();
    this.skipped.clear();
    this.ids = this._shuffle
      ? (order ?? shuffled(this.sourceIds, this.draw, id))
      : [...this.sourceIds];
    this.index = id == null ? (this.ids.length ? 0 : -1) : this.ids.indexOf(id);
    if (this.current != null) this.played.add(this.current);
  }
  remainingPool() {
    return this.sourceIds.filter(
      (id) =>
        !this.played.has(id) &&
        !this.skipped.has(id) &&
        !this.manual.includes(id),
    );
  }
  setShuffle(value, order = null) {
    this._shuffle = Boolean(value);
    const remaining = this.remainingPool();
    const next = this._shuffle
      ? (order ?? shuffled(remaining, this.draw))
      : remaining;
    this.ids = [...this.ids.slice(0, this.index + 1), ...next];
  }
  reshuffle(order = null) {
    this.setShuffle(true, order);
  }
  enqueue(id) {
    this.manual.push(id);
    this.ids = [
      ...this.ids.slice(0, this.index + 1),
      ...this.ids.slice(this.index + 1).filter((next) => next !== id),
    ];
  }
  next(ended = false) {
    if (ended && this.repeat === "one") return this.current;
    if (this.manual.length) {
      this.ids.splice(this.index + 1, 0, this.manual.shift());
      this.index++;
      this.played.add(this.current);
      return this.current;
    }
    if (this.index + 1 < this.ids.length) {
      this.index++;
      this.played.add(this.current);
      return this.current;
    }
    if (this.repeat === "all" && this.sourceIds.length) {
      this.start(this.sourceIds);
      return this.current;
    }
    return null;
  }
  previous() {
    this.index = Math.max(0, this.index - 1);
    return this.current;
  }
  removeUpcoming(index) {
    if (index < this.manual.length) {
      this.skipped.add(this.manual[index]);
      this.manual.splice(index, 1);
    } else {
      const absolute = this.index + 1 + index - this.manual.length;
      const [id] = this.ids.splice(absolute, 1);
      if (id) this.skipped.add(id);
    }
  }
  cycleRepeat() {
    this.repeat = { off: "all", all: "one", one: "off" }[this.repeat];
    return this.repeat;
  }
  upcoming() {
    return [...this.manual, ...this.ids.slice(this.index + 1)];
  }
}
export const formatTime = (seconds) => {
  const n = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  return `${Math.floor(n / 60)}:${String(n % 60).padStart(2, "0")}`;
};
export const escapeHTML = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
