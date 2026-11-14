const paths = {
  logo: "M5 10c7-3 15-2 21 1M7 15c6-2 12-1 17 1M9 20c4-1 8 0 12 1",
  home: "m3 11 9-8 9 8v10h-6v-7H9v7H3z",
  search: "M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0",
  library: "M4 3v18M9 3v18m5-18 6 1v17l-6-1z",
  plus: "M12 4v16M4 12h16",
  close: "m6 6 12 12M6 18 18 6",
  left: "m15 5-7 7 7 7",
  right: "m9 5 7 7-7 7",
  play: "m7 3 15 9-15 9z",
  pause: "M7 4v16M17 4v16",
  next: "m4 4 12 8-12 8zM20 4v16",
  previous: "m20 4-12 8 12 8zM4 4v16",
  shuffle:
    "M3 6h3c5 0 6 12 11 12h4m-4-4 4 4-4 4M3 18h3c2 0 3-2 4-4m4-4c1-2 2-4 4-4h3m-4-4 4 4-4 4",
  repeat:
    "m17 2 4 4-4 4M3 11V8a2 2 0 0 1 2-2h16M7 22l-4-4 4-4m14-1v3a2 2 0 0 1-2 2H3",
  volume: "m3 9 5 0 5-5v16l-5-5H3zM17 8c3 2 3 6 0 8m3-11c5 4 5 10 0 14",
  muted: "m3 9 5 0 5-5v16l-5-5H3zM17 9l6 6m0-6-6 6",
  queue: "M3 5h18M3 10h18M3 15h9m4-1 6 4-6 4z",
  device: "M2 3h14v12H2zM5 19h6m7-10h5v13h-5z",
  heart: "M12 21S2 15 2 8a5 5 0 0 1 10-2A5 5 0 0 1 22 8c0 7-10 13-10 13z",
  check: "m5 12 4 4L20 5",
  more: "M4 12h.01M12 12h.01M20 12h.01",
  download: "M12 3v12m-5-5 5 5 5-5M4 17v4h16v-4",
  clock: "M12 8v5l3 2M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0",
  expand: "M9 3H3v6m12-6h6v6M3 15v6h6m12-6v6h-6",
  list: "M3 5h2m4 0h12M3 12h2m4 0h12M3 19h2m4 0h12",
  music:
    "M9 18V5l12-2v13M9 9l12-2M9 18c0 4-7 4-7 0s7-4 7 0m12-2c0 4-7 4-7 0s7-4 7 0",
  settings:
    "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8M9 2h6l1 4 4 1 2 5-3 3v4l-5 3-4-2-4 1-4-5 2-4-1-4 5-3z",
  folder: "M3 6V4h7l2 3h9v13H3z",
  logout: "M9 3H3v18h6m5-16 7 7-7 7m-6-7h13",
  island: "M7 9h10a3 3 0 0 1 0 6H7a3 3 0 0 1 0-6M3 4h18v16H3z",
  info: "M12 11v7m0-12v1M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0",
};
export const icon = (name, cls = "") =>
  `<svg class="icon ${cls}" viewBox="0 0 ${name === "logo" ? "32 32" : "24 24"}" fill="${name === "play" || name === "next" || name === "previous" ? "currentColor" : "none"}" stroke="currentColor" stroke-width="${name === "pause" ? "4" : "1.8"}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${paths[name] || paths.music}"/></svg>`;
