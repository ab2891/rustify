import { invoke, convertFileSrc, isTauri } from "@tauri-apps/api/core";
import { shuffled } from "./player.js";
export const native = isTauri();
export async function shuffleTracks(ids, keepFirst = null) {
  return native
    ? invoke("shuffle_tracks", { ids, keepFirst })
    : shuffled(ids, undefined, keepFirst);
}
let db;
const database = () =>
  (db ??= new Promise((resolve, reject) => {
    const request = indexedDB.open("spotify-rust", 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore("library");
      request.result.createObjectStore("media");
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  }));
async function read(store, key) {
  const db = await database();
  return new Promise((resolve, reject) => {
    const r = db.transaction(store).objectStore(store).get(key);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
async function write(store, key, value) {
  const db = await database();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, "readwrite");
    t.objectStore(store).put(value, key);
    t.oncomplete = resolve;
    t.onerror = () => reject(t.error);
  });
}
export async function loadLibrary() {
  if (native) return invoke("get_library");
  return (
    (await read("library", "state")) ??
    (await fetch("/catalog.json").then((r) => r.json()))
  );
}
let saving = Promise.resolve();
export function persist(library) {
  const snapshot = structuredClone(library);
  saving = saving
    .catch(() => {})
    .then(() =>
      native
        ? invoke("persist_library", { library: snapshot })
        : write("library", "state", snapshot),
    );
  return saving;
}
const objectURLs = new Map();
let nativeMedia = null;
export async function source(track) {
  if (!track.imported) {
    if (!native) return track.src;
    // WebKitGTK cannot hand tauri:// resources directly to its audio decoder.
    // Keep the bundled recordings on a WebView-owned blob URL instead.
    if (!objectURLs.has(track.id)) {
      const response = await fetch(track.src);
      if (!response.ok)
        throw new Error("The bundled recording could not be loaded.");
      objectURLs.set(track.id, URL.createObjectURL(await response.blob()));
    }
    return objectURLs.get(track.id);
  }
  if (native) {
    const url = convertFileSrc(track.src);
    if (!url.startsWith("asset:")) return url;
    // Custom schemes also need a WebView-owned URL for imported media on WebKit.
    // Retain only the currently selected imported file, regardless of library size.
    if (nativeMedia?.id === track.id) return nativeMedia.url;
    const response = await fetch(url);
    if (!response.ok)
      throw new Error("This audio file is unavailable. Import it again.");
    const blob = await response.blob();
    if (nativeMedia) URL.revokeObjectURL(nativeMedia.url);
    nativeMedia = { id: track.id, url: URL.createObjectURL(blob) };
    return nativeMedia.url;
  }
  if (!objectURLs.has(track.id)) {
    const blob = await read("media", track.id);
    if (!blob) throw new Error("This audio file is missing. Import it again.");
    objectURLs.set(track.id, URL.createObjectURL(blob));
  }
  return objectURLs.get(track.id);
}
export async function importTracks(files) {
  if (native) return invoke("import_tracks");
  const result = [];
  for (const file of files) {
    if (!/\.(mp3|m4a|wav|ogg|flac|aac|opus)$/i.test(file.name)) continue;
    if (file.size > 512 * 1024 * 1024)
      throw new Error("Choose audio files smaller than 512 MB.");
    const id = `local-${crypto.randomUUID()}`;
    await write("media", id, file);
    result.push({
      id,
      title: file.name.replace(/\.[^.]+$/, ""),
      artist: "Local artist",
      album: "Local files",
      duration: 0,
      cover: "/art/local.svg",
      src: id,
      imported: true,
    });
  }
  return result;
}
// The island window (src/island.js) and the main window talk through events.
export const island = {
  async toggle() {
    if (!native) throw new Error("The island needs the Rustify desktop app.");
    return invoke("island_toggle");
  },
  async publish(state) {
    if (!native) return;
    const { emitTo } = await import("@tauri-apps/api/event");
    await emitTo("island", "island-state", state);
  },
  async listen(handlers) {
    return listenAll(handlers);
  },
  async configure(options) {
    if (native) await invoke("island_configure", { options });
  },
  async setVisible(visible) {
    if (native) await invoke("island_set_visible", { visible });
  },
};
async function listenAll(handlers) {
  if (!native) return;
  const { listen } = await import("@tauri-apps/api/event");
  await Promise.all(Object.entries(handlers).map(([name, run]) => listen(name, (e) => run(e.payload))));
}
// Windows media controls, tray and global hotkeys (src-tauri media/tray/hotkeys.rs).
export const system = {
  native,
  listen: listenAll,
  async mediaUpdate(now) {
    if (native) await invoke("media_update", { now });
  },
  async setCloseToTray(enabled) {
    if (native) await invoke("set_close_to_tray", { enabled });
  },
  async getAutostart() {
    return native ? Boolean(await invoke("get_autostart")) : false;
  },
  async setAutostart(enabled) {
    return native ? Boolean(await invoke("set_autostart", { enabled })) : false;
  },
  /** Returns hotkeys another app already owns. */
  async setHotkeys(enabled) {
    return native ? invoke("set_hotkeys", { enabled }) : [];
  },
};
export const spotify = {
  async startPlayer() {
    if (!native) throw new Error("Spotify playback on this computer needs the Rustify desktop app.");
    return invoke("spotify_player_start");
  },
  async playerStatus() { return invoke("spotify_player_status"); },
  async stopPlayer() { if (native) await invoke("spotify_player_stop"); },
  async restore() {
    return native ? invoke("spotify_restore") : null;
  },
  async connect(clientId) {
    if (!native)
      throw new Error(
        "Spotify sign-in requires the Tauri desktop app. Run npm run desktop.",
      );
    return invoke("spotify_connect", { clientId });
  },
  async disconnect() {
    if (native) await invoke("spotify_disconnect");
  },
  async request(method, path, body = null) {
    if (!native)
      throw new Error("Spotify controls require the Tauri desktop app.");
    return invoke("spotify_request", { method, path, body });
  },
};
export function normalizeTrack(t) {
  return {
    id: t.linked_from?.id || t.id,
    artistId: t.artists?.[0]?.id,
    addedAt: t.added_at || null,
    isrc:t.external_ids?.isrc||null,
    albumId: t.album?.id,
    title: t.name,
    artist: t.artists?.map((a) => a.name).join(", ") || "Unknown artist",
    album: t.album?.name || "",
    duration: (t.duration_ms || 0) / 1000,
    cover: safeImage(t.album?.images?.[0]?.url),
    uri: t.linked_from?.uri || t.uri,
    spotify: true,
    available: t.is_playable !== false,
    type: t.type,
  };
}
export function safeImage(url) {
  if (!url) return "/art/local.svg";
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" &&
      /(^|\.)(scdn\.co|spotifycdn\.com)$/.test(parsed.hostname)
      ? url
      : "/art/local.svg";
  } catch {
    return "/art/local.svg";
  }
}
export async function page(path) {
  const result = await spotify.request("GET", path);
  return result;
}
