// Lyrics helpers shared by the main window and the island.

/** Parses LRC text (`[mm:ss.xx] words`) into `[{ time, text }]`, sorted by time in seconds. */
export function parseLRC(text) {
  const lines = [];
  for (const raw of String(text || "").split(/\r?\n/)) {
    const tags = [...raw.matchAll(/\[(\d+):(\d+(?:\.\d+)?)\]/g)];
    if (!tags.length) continue;
    const words = raw.replace(/\[[^\]]*\]/g, "").trim();
    // One line can carry several time tags when it repeats.
    for (const tag of tags) lines.push({ time: Number(tag[1]) * 60 + Number(tag[2]), text: words });
  }
  return lines.sort((a, b) => a.time - b.time);
}

/** Index of the line being sung at `seconds`, or -1 before the first line. */
export function currentLine(lines, seconds) {
  let found = -1;
  for (let i = 0; i < lines.length && lines[i].time <= seconds; i++) found = i;
  return found;
}

/** Soloist builds stop working 90 days after their build date (`YYYYMMDD`). */
export function soloistExpiry(buildDate, now = Date.now()) {
  const match = /^(\d{4})(\d{2})(\d{2})$/.exec(buildDate || "");
  if (!match) return null;
  const expires = new Date(Date.UTC(+match[1], +match[2] - 1, +match[3]) + 90 * 86400000);
  return { expires, daysLeft: Math.ceil((expires.getTime() - now) / 86400000) };
}

// Lyrics the user added themselves, kept on this computer. They win over the
// lyrics service. Keyed by title and first artist so the same song matches
// wherever it is played from.
const CUSTOM = "rustify-custom-lyrics";
const customKey = (song) =>
  `${song?.title || ""}|${(song?.artist || "").split(",")[0]}`.trim().toLowerCase();
function customAll() {
  try {
    return JSON.parse(localStorage.getItem(CUSTOM) || "{}");
  } catch {
    return {};
  }
}
export const customLyrics = {
  get: (song) => (song?.title ? customAll()[customKey(song)] || "" : ""),
  set(song, text) {
    const all = customAll();
    if (text.trim()) all[customKey(song)] = text.trim();
    else delete all[customKey(song)];
    localStorage.setItem(CUSTOM, JSON.stringify(all));
  },
};

const isHeader = (line) => /^\[[^\]]*\]$/.test(line) || /^\([^)]*\)$/.test(line);

/** The lines a singer actually sings: no blank lines, no "[Verse 1]" headers. */
export function sungLines(text) {
  return String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !isHeader(line));
}

/**
 * Guessed timings for lyrics that have none, so they can scroll with the song.
 * Each line gets time in proportion to its length; a blank line or section
 * header counts as a short pause; the first and last 6% of the song (at most
 * 15 seconds each) are treated as intro and outro. It is an estimate only.
 */
export function estimateLines(text, duration) {
  const raw = String(text || "").split(/\r?\n/).map((line) => line.trim());
  if (!(duration > 0) || !raw.some(Boolean)) return [];
  const edge = Math.min(15, duration * 0.06);
  const weights = raw.map((line) => (!line || isHeader(line) ? 14 : Math.max(18, line.length)));
  const total = weights.reduce((a, b) => a + b, 0);
  const lines = [];
  let passed = 0;
  raw.forEach((line, i) => {
    if (line && !isHeader(line))
      lines.push({ time: edge + (passed / total) * (duration - 2 * edge), text: line });
    passed += weights[i];
  });
  return lines;
}

/** LRC text from lines and the second each one starts at. */
export function toLRC(lines, times) {
  return lines
    .map((text, i) => {
      const t = Math.max(0, times[i]);
      const minutes = String(Math.floor(t / 60)).padStart(2, "0");
      const seconds = (t % 60).toFixed(2).padStart(5, "0");
      return `[${minutes}:${seconds}] ${text}`;
    })
    .join("\n");
}

/** Lyrics text without LRC time tags (for showing and editing). */
export const plainText = (text) =>
  String(text || "").split(/\r?\n/).map((line) => line.replace(/^(\[\d+:\d+(?:\.\d+)?\])+\s*/, "")).join("\n");
