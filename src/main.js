import "./style.css";
import { icon } from "./icons.js";
import { installPanelSizing } from "./layout.js";
import { allCollectionTracks } from "./collections.js";
import { sameRecording } from "./playback-match.js";
import { Queue, formatTime, escapeHTML as h } from "./player.js";
import { loadFeatures } from "./features/registry.js";
import featureList from "./features/index.js";
import {
  native,
  shuffleTracks,
  loadLibrary,
  persist,
  source,
  importTracks,
  spotify,
  normalizeTrack,
  safeImage,
} from "./bridge.js";

const root = document.querySelector("#app");
const audio = new Audio();
audio.preload = "metadata";
audio.volume = Number(localStorage.getItem("rustify-volume") ?? 0.65);
audio.id = "audio-engine";
audio.hidden = true;
document.body.append(audio);
const queue = new Queue();
let localPlaybackContext = null;
let trueShuffle = localStorage.getItem("rustify-true-shuffle") === "true";
queue.shuffle = trueShuffle;
let library;
let mode = localStorage.getItem("rustify-mode") || "spotify";
let route = { type: "home" },
  history = [route],
  historyIndex = 0;
let panel = localStorage.getItem("rustify-panel") || "now";
let mobilePanelRequested = false;
let current = null,
  playing = false,
  elapsed = 0,
  duration = 0,
  muted = false,
  previousVolume = 0.65;
let generation = 0,
  librarySearchOpen = false;
let libraryFilter = "all",
  librarySearch = "",
  librarySort = "recent",
  searchQuery = "",
  searchType = "all";
let searchTimer,
  searchSequence = 0,
  routeSequence = 0,
  toastTimer,
  playSequence = 0;
let searchData = {
  tracks: [],
  albums: [],
  playlists: [],
  artists: [],
  offset: 0,
  more: false,
};
function freshRemote() {
  return {
    profile: null,
    playlists: [],
    playlistOffset: 0,
    morePlaylists: false,
    liked: [],
    saved: new Map(),
    likedTotal: 0,
    likedOffset: 0,
    moreLiked: false,
    tracks: new Map(),
    trackMetadata:new Map(),playbackAliases:new Map(),shuffleExpectedContext:null,shuffleDevice:null,
    addedDates: new Map(),
    viewTracks: [],
    viewMeta: null,
    viewMore: false,
    viewOffset: 0,
    devices: [],
    deviceId: null,
    state: null,
    queue: [],
    refreshing: false,
    playbackEpoch: 0,
    pendingReshuffle: false,
    pendingSequential: null,
    shuffleSource: [],
    shuffleOrder: [],
    shuffleContext: null,
    shuffleSeen: new Set(),
    albums: [],
    albumOffset: 0,
    moreAlbums: false,
    savedAlbums: new Map(),
    artist: null,
    discography: [],
    artistOffset: 0,
    moreArtist: false,
  };
}
let remote = freshRemote();
let modalReturnFocus;
const connected = () => Boolean(remote.profile);
const isSpotify = () => mode === "spotify";
const api = async (method, path, body) => {
  const started = generation;
  if ((method === "PUT" || method === "POST") && path.startsWith("/me/player/") && !remote.deviceId) {
    await features.devices.ensure();
    if (started !== generation) throw Object.assign(new Error("Source changed."), { stale: true });
    // The path was built before a device existed.
    const target = new URL(path, "https://api.spotify.com");
    target.searchParams.set("device_id", remote.deviceId);
    path = target.pathname + target.search;
  }
  let result;
  try { result = await spotify.request(method, path, body); }
  catch (error) {
    // A closed Spotify app can leave its last device ID in memory. Recover only
    // playback mutations; catalog 404s must keep their original meaning.
    if (!/No active Spotify device/.test(String(error)) || !["PUT", "POST"].includes(method) || !path.startsWith("/me/player/")) throw error;
    if (started !== generation) throw Object.assign(new Error("Source changed."), { stale: true });
    remote.deviceId = null;
    await features.devices.ensure();
    if (started !== generation) throw Object.assign(new Error("Source changed."), { stale: true });
    const target = new URL(path, "https://api.spotify.com");
    target.searchParams.set("device_id", remote.deviceId);
    result = await spotify.request(method, target.pathname + target.search, body);
  }
  if (started !== generation) {
    const error = new Error("Source changed.");
    error.stale = true;
    throw error;
  }
  return result;
};
const tracks = () =>
  isSpotify() ? [...remote.tracks.values()] : library.tracks;
const trackById = (id) =>
  isSpotify() ? remote.tracks.get(id) : library.tracks.find((t) => t.id === id);
const playlists = () => (isSpotify() ? remote.playlists : library.playlists);
const liked = (id) =>
  isSpotify()
    ? (remote.saved.get(id) ?? remote.liked.includes(id))
    : library.liked.includes(id);
async function checkSaved(list) {
  const unknown = list.filter((t) => t?.uri && !remote.saved.has(t.id));
  for (let start = 0; start < unknown.length; start += 40) {
    const batch = unknown.slice(start, start + 40);
    const result = await api(
      "GET",
      `/me/library/contains?uris=${encodeURIComponent(batch.map((t) => t.uri).join(","))}`,
    );
    batch.forEach((t, i) => remote.saved.set(t.id, Boolean(result[i])));
  }
}
const ib = (name, label, action, extra = "", active = false) =>
  `<button class="icon-button ${active ? "active" : ""} ${extra}" aria-label="${h(label)}" title="${h(label)}" data-action="${action}" ${active ? 'aria-pressed="true"' : ""}>${icon(name)}</button>`;
const cover = (url, alt = "", cls = "") =>
  `<img class="thumb ${cls}" src="${h(url || "/art/local.svg")}" alt="${h(alt)}" loading="lazy">`;
const likedCover = () => `<div class="liked-cover">${icon("heart")}</div>`;
const normPlaylist = (p) => ({
  id: p.id,
  title: p.name,
  description: p.description?.replace(/<[^>]*>/g, "") || "",
  cover: safeImage(p.images?.[0]?.url),
  uri: p.uri || `spotify:playlist:${p.id}`,
  total: p.items?.total ?? p.tracks?.total ?? 0,
  owner: p.owner?.display_name || "Spotify",
  collaborative: p.collaborative,
});
const normAlbum = (a) => ({
  id: a.id,
  album: a.name,
  artist: a.artists?.map((t) => t.name).join(", ") || "Unknown artist",
  artistId: a.artists?.[0]?.id,
  cover: safeImage(a.images?.[0]?.url),
  uri: a.uri,
  year: a.release_date?.slice(0, 4),
  kind: a.album_type,
});
function artistLink(track) {
  return track.artistId
    ? `<button class="inline-link" data-route="artist" data-id="${h(track.artistId)}">${h(track.artist)}</button>`
    : h(track.artist);
}
function artistCard(a) {
  return `<button class="album-card artist-card" data-route="artist" data-id="${h(a.id)}"><div class="cover-wrap">${cover(safeImage(a.images?.[0]?.url), a.name)}</div><h3>${h(a.name)}</h3><p>Artist</p></button>`;
}
function cache(items,playback=false){
  return items.filter(t=>t&&t.id).map(t=>{
    const normalized=normalizeTrack(t);
    const canonical=playback?remote.playbackAliases.get(normalized.id):null;
    const previous=remote.tracks.get(canonical||normalized.id);
    if(canonical&&previous){normalized.id=canonical;normalized.uri=previous.uri;}
    if(playback&&!normalized.isrc&&previous?.isrc)normalized.isrc=previous.isrc;
    remote.tracks.set(normalized.id,normalized);return normalized;
  });
}
function toast(message, error = false) {
  clearTimeout(toastTimer);
  document.querySelector(".toast")?.remove();
  const el = document.createElement("div");
  el.className = `toast ${error ? "error" : ""}`;
  el.setAttribute("role", error ? "alert" : "status");
  el.textContent = String(message);
  document.body.append(el);
  toastTimer = setTimeout(() => el.remove(), error ? 10000 : 3500);
}
async function save() {
  await persist(library);
}
function shell() {
  root.innerHTML = `<div class="app-shell ${localStorage.getItem("rustify-collapsed") === "true" ? "library-collapsed" : ""}">
<header class="topbar"><div class="topbar-left"><button class="app-menu icon-button" data-action="settings" aria-label="Rustify settings">${icon("more")}</button><div class="history">${ib("left", "Go back", "back")}${ib("right", "Go forward", "forward")}</div></div><div class="topbar-center">${ib("home", "Home", "home", "home-button")}<label class="searchbox">${icon("search")}<input id="global-search" aria-label="Search music" placeholder="What do you want to play?" autocomplete="off" spellcheck="false">${ib("close", "Clear search", "clear-search")}</label></div><div class="topbar-right"><button class="mode-switch" data-action="switch-mode"></button><button class="connect-top" data-action="connect">Connect Spotify</button><button class="avatar" data-action="settings" aria-label="Settings and account">R</button></div></header>
<div class="workspace"><aside class="library" aria-label="Your library"></aside><main class="content" id="content" aria-label="Music collection"></main><aside class="side-panel" aria-label="Now playing and queue"></aside><div class="panel-resizer library-resizer" data-resize-panel="library" role="separator" aria-orientation="vertical" aria-label="Resize library" tabindex="0" aria-valuenow="284" aria-valuemin="190" aria-valuemax="440"></div><div class="panel-resizer right-resizer" data-resize-panel="right" role="separator" aria-orientation="vertical" aria-label="Resize now playing" tabindex="0" aria-valuenow="310" aria-valuemin="240" aria-valuemax="420"></div></div><footer class="player" aria-label="Playback controls"></footer></div><input class="hidden" type="file" id="file-import" accept=".mp3,.m4a,.wav,.ogg,.flac,.aac,.opus,audio/*" multiple><div class="device-status"></div>`;
  renderAll();
  installPanelSizing();
}
function renderAll() {
  renderTop();
  renderLibrary();
  renderContent();
  renderPanel();
  renderPlayer();
}
function renderTop() {
  document.querySelector(".mode-switch").textContent = isSpotify()
    ? "Spotify"
    : "Local files";
  const connect = document.querySelector(".connect-top");
  connect.classList.toggle("hidden", connected());
  const avatar = document.querySelector(".avatar");
  avatar.textContent = (remote.profile?.display_name ||
    "Rustify")[0].toUpperCase();
  document.querySelector(".workspace").classList.toggle("no-panel", !panel);
  document
    .querySelector(".workspace")
    .classList.toggle("mobile-panel", Boolean(panel) && mobilePanelRequested);
  document.querySelector(".side-panel").classList.toggle("hidden", !panel);
}
function renderLibrary() {
  let list = [...playlists()];
  if (librarySearch)
    list = list.filter((p) =>
      p.title.toLowerCase().includes(librarySearch.toLowerCase()),
    );
  if (librarySort === "alphabetical")
    list.sort((a, b) => a.title.localeCompare(b.title));
  const songs = isSpotify() ? remote.likedTotal : library.liked.length;
  let items = `<button class="library-item ${route.type === "liked" ? "selected" : ""}" data-route="liked"><div class="thumb liked-cover">${icon("heart")}</div><span class="text"><strong>Liked Songs</strong><small>${songs} ${songs === 1 ? "song" : "songs"}</small></span></button>`;
  if (libraryFilter !== "albums")
    items += list
      .map(
        (p) =>
          `<button class="library-item ${route.id === p.id ? "selected" : ""}" data-route="playlist" data-id="${h(p.id)}" data-drop-playlist="${h(p.id)}">${cover(p.cover)}<span class="text"><strong>${h(p.title)}</strong><small>Playlist · ${h(isSpotify() ? p.owner : "You")}</small></span></button>`,
      )
      .join("");
  if (libraryFilter !== "playlists")
    items += (
      isSpotify()
        ? remote.albums
        : library.tracks.filter(
            (t, i, a) => a.findIndex((v) => v.album === t.album) === i,
          )
    )
      .filter(
        (t) =>
          !librarySearch ||
          `${t.album} ${t.artist}`
            .toLowerCase()
            .includes(librarySearch.toLowerCase()),
      )
      .sort((a, b) =>
        librarySort === "alphabetical" ? a.album.localeCompare(b.album) : 0,
      )
      .map(
        (t) =>
          `<button class="library-item ${route.type === "album" && route.id === t.id ? "selected" : ""}" data-route="album" data-id="${h(t.id)}">${cover(t.cover)}<span class="text"><strong>${h(t.album)}</strong><small>Album · ${h(t.artist)}</small></span></button>`,
      )
      .join("");
  document.querySelector(".library").innerHTML =
    `<div class="library-head"><button class="library-label" data-action="collapse-library" aria-label="Collapse or expand library">${icon("library")}<span>Your Library</span></button><div class="library-tools">${ib("plus", "Create playlist", "create-playlist")}${ib("folder", "Import local audio", "import")}</div></div><div class="chips"><button class="chip ${libraryFilter === "playlists" ? "selected" : ""}" data-filter="playlists">Playlists</button><button class="chip ${libraryFilter === "albums" ? "selected" : ""}" data-filter="albums">Albums</button></div><div class="library-sort">${ib("search", "Search your library", "library-search")}<select class="sort-select" id="library-sort" aria-label="Sort library"><option value="recent" ${librarySort === "recent" ? "selected" : ""}>Recently added</option><option value="alphabetical" ${librarySort === "alphabetical" ? "selected" : ""}>Alphabetical</option></select></div>${librarySearchOpen ? `<input class="library-search" id="library-search" aria-label="Search your library" value="${h(librarySearch)}">` : ""}${items}${isSpotify() && remote.moreAlbums && libraryFilter !== "playlists" ? '<button class="text-button load-more" data-action="more-albums">Load more albums</button>' : ""}${isSpotify() && remote.morePlaylists && libraryFilter !== "albums" ? '<button class="text-button load-more" data-action="more-playlists">Load more playlists</button>' : ""}<div class="library-footer">${isSpotify() ? (connected() ? "Connected to Spotify." : "Connect your Spotify account to see your library.") : "Your local library. Bundled tracks are original ambient demos."}<br><button data-action="${isSpotify() ? "connect" : "import"}">${isSpotify() ? "Account settings" : "Import music"}</button></div>`;
}
function toolbar() {
  document.querySelector('[data-action="back"]').disabled = historyIndex === 0;
  document.querySelector('[data-action="forward"]').disabled =
    historyIndex === history.length - 1;
  return "";
}
function albumCard(t) {
  return `<button class="album-card" data-route="album" data-id="${h(t.id)}"><div class="cover-wrap">${cover(t.cover, t.album)}<span class="card-play">${icon("play")}</span></div><h3>${h(t.album)}</h3><p>${h(t.artist)}</p></button>`;
}
function playlistCard(p) {
  return `<button class="album-card" data-route="playlist" data-id="${h(p.id)}"><div class="cover-wrap">${cover(p.cover, p.title)}<span class="card-play">${icon("play")}</span></div><h3>${h(p.title)}</h3><p>${h(p.description || `By ${p.owner || "you"}`)}</p></button>`;
}
function section(title, body, action = "") {
  return `<section><div class="section-heading"><h2>${h(title)}</h2>${action}</div>${body}</section>`;
}
function renderContent() {
  const el = document.querySelector(".content");
  el.dataset.view = route.type;
  el.classList.toggle(
    "plain",
    route.type === "search" || route.type === "local",
  );
  if (route.type === "loading") {
    el.innerHTML =
      toolbar() +
      '<div class="loading" role="status">Loading your music…</div>';
    return;
  }
  if (route.type === "home") {
    let body = "";
    if (isSpotify() && !connected()) {
      body = `<div class="welcome-panel"><h1>All your music.<br>Right where you left it.</h1><p>Connect your Spotify account to browse your library, find your next track, and control playback on your Spotify devices.</p><button class="green-button" data-action="connect">Connect to Spotify</button><button class="text-button" data-action="switch-mode" style="margin-left:16px">Try local music</button><div class="welcome-art">${library.tracks
        .slice(0, 3)
        .map((t) => cover(t.cover, t.album))
        .join(
          "",
        )}</div><p style="font-size:12px">Spotify plays right here in Rustify, no Spotify app needed. Local files play directly in Rustify.</p></div>`;
    } else {
      const greeting =
        new Date().getHours() < 12
          ? "Good morning"
          : new Date().getHours() < 18
            ? "Good afternoon"
            : "Good evening";
      const quick = [
        { type: "liked", title: "Liked Songs", cover: null },
        ...playlists()
          .slice(0, 5)
          .map((p) => ({ ...p, type: "playlist" })),
      ];
      body = `<h1 class="home-title">${greeting}</h1><div class="quick-grid">${quick.map((p) => `<button class="quick-card" data-route="${p.type}" data-id="${h(p.id || "")}">${p.cover ? cover(p.cover) : likedCover()}<span>${h(p.title)}</span><span class="quick-play">${icon("play")}</span></button>`).join("")}</div>`;
      if (!isSpotify() && library.recent.length)
        body += section(
          "Recently played",
          `<div class="card-grid">${library.recent
            .map((id) => trackById(id))
            .filter(Boolean)
            .slice(0, 6)
            .map(albumCard)
            .join("")}</div>`,
        );
      if (playlists().length)
        body += section(
          "Your playlists",
          `<div class="card-grid">${playlists().map(playlistCard).join("")}</div>`,
          `<button class="text-button" data-route="playlists">Show all</button>`,
        );
      if (isSpotify() && remote.albums.length)
        body += section(
          "Your albums",
          `<div class="card-grid">${remote.albums.map(albumCard).join("")}</div>`,
          '<button class="text-button" data-route="albums">Show all</button>',
        );
      if (!isSpotify())
        body +=
          section(
            "Your albums",
            `<div class="card-grid">${library.tracks
              .filter(
                (t, i, a) => a.findIndex((v) => v.album === t.album) === i,
              )
              .map(albumCard)
              .join("")}</div>`,
            '<button class="text-button" data-route="albums">Show all</button>',
          ) +
          `<p class="demo-caption">Six original ambient recordings are included. Import your music to make this library yours.</p>`;
      else if (!playlists().length)
        body += empty(
          "Your library starts here",
          "Create a playlist or search for music.",
          "create-playlist",
          "Create playlist",
        );
    }
    el.innerHTML =
      toolbar() +
      `<div class="content-filters chips"><button class="chip selected" data-action="home">All</button><button class="chip" data-route="local">${isSpotify() ? "Saved songs" : "Local files"}</button></div><div class="content-body">${body}</div>`;
    return;
  }
  if (route.type === "search") {
    renderSearch();
    return;
  }
  if (route.type === "playlists" || route.type === "albums") {
    const isAlbums = route.type === "albums";
    const list = isAlbums
      ? isSpotify()
        ? remote.albums
        : library.tracks.filter(
            (t, i, a) => a.findIndex((v) => v.album === t.album) === i,
          )
      : playlists();
    el.innerHTML =
      toolbar() +
      `<div class="content-body"><div class="section-heading"><h1>${isAlbums ? "Your albums" : "Your playlists"}</h1>${!isAlbums ? '<button class="text-button" data-action="create-playlist">Create playlist</button>' : ""}</div><div class="card-grid">${list.map(isAlbums ? albumCard : playlistCard).join("")}</div>${isSpotify() && (isAlbums ? remote.moreAlbums : remote.morePlaylists) ? `<button class="white-button load-more" data-action="${isAlbums ? "more-albums" : "more-playlists"}">Load more</button>` : ""}</div>`;
    return;
  }
  if (route.type === "artist") {
    const a = remote.artist;
    el.innerHTML =
      toolbar() +
      `<div class="artist-hero">${a ? cover(safeImage(a.images?.[0]?.url), a.name, "artist-background") : ""}<div><small>Artist</small><h1>${h(a?.name || "Artist")}</h1>${a?.followers?.total != null ? `<p>${Number(a.followers.total).toLocaleString()} followers</p>` : ""}</div></div><div class="content-body">${section("Discography", `<div class="card-grid">${remote.discography.map(albumCard).join("")}</div>`)}${remote.moreArtist ? '<button class="white-button load-more" data-action="more-artist">Load more releases</button>' : ""}${!remote.discography.length ? empty("No releases available", "Spotify has no accessible releases for this artist.") : ""}</div>`;
    return;
  }
  const info = viewInfo();
  const list = viewTracks();
  el.innerHTML =
    toolbar() +
    `<div class="playlist-hero ${route.type === "liked" ? "liked-hero" : ""}">${route.type !== "liked" ? `<div class="hero-art-backdrop">${cover(info.cover)}</div>` : ""}${route.type === "liked" ? likedCover() : cover(info.cover, info.title)}<div><small>${h(info.kind)}</small><h1>${h(info.title)}</h1><p>${h(info.description || "")}<br><strong>${h(isSpotify() ? remote.profile?.display_name || "Your collection" : "Your collection")}</strong> · ${info.total ?? list.length} songs${list.length && list.length === (info.total ?? list.length) ? " · " + formatTime(list.reduce((n, t) => n + t.duration, 0)) : ""}</p></div></div><div class="content-body"><div class="playlist-actions"><button class="big-play" data-action="play-view" aria-label="Play ${h(info.title)}">${icon("play")}</button>${shuffleControls()}${isSpotify() && route.type === "album" ? `<button class="album-save ${remote.savedAlbums.get(route.id) ? "saved" : ""}" data-action="save-album" aria-label="${remote.savedAlbums.get(route.id) ? "Remove saved album" : "Save album"}">${icon(remote.savedAlbums.get(route.id) ? "check" : "plus")}</button>` : ""}${route.type === "playlist" ? ib("more", "Playlist options", "playlist-menu") : ""}<span style="flex:1"></span>${!isSpotify() ? '<button class="text-button" data-action="import">Import music</button>' : ""}</div>${list.length ? table(list) : empty("Find your next favorite", route.type === "liked" ? "Save songs with the heart button." : "Add songs from search or your collection.", "focus-search", "Search music")}${isSpotify() && (route.type === "liked" || route.type === "local" ? remote.moreLiked : remote.viewMore) ? '<button class="white-button load-more" data-action="more-tracks">Load more songs</button>' : ""}</div>`;
}
function empty(title, description, action, label) {
  return `<div class="empty-state"><h2>${h(title)}</h2><p>${h(description)}</p>${action ? `<button class="white-button" data-action="${action}">${h(label)}</button>` : ""}</div>`;
}
function viewInfo() {
  if (route.type === "liked")
    return {
      title: "Liked Songs",
      kind: "Playlist",
      description: "The songs you’ve saved.",
      total: isSpotify() ? remote.likedTotal : library.liked.length,
    };
  if (route.type === "local")
    return {
      title: isSpotify() ? "Saved songs" : "Local files",
      kind: "Your music",
      cover: "/art/local.svg",
      description: isSpotify()
        ? "Your saved Spotify tracks."
        : "Music stored on this device.",
      total: isSpotify() ? remote.likedTotal : library.tracks.length,
    };
  if (isSpotify())
    return (
      remote.viewMeta || {
        title: "Playlist",
        kind: "Playlist",
        cover: "/art/local.svg",
      }
    );
  if (route.type === "playlist")
    return {
      ...library.playlists.find((p) => p.id === route.id),
      kind: "Playlist",
    };
  const t = trackById(route.id);
  return {
    title: t?.album || "Album",
    kind: "Album",
    description: t?.artist,
    cover: t?.cover,
  };
}
function viewTracks() {
  if (route.type === "search") return searchData.tracks;
  if (isSpotify())
    return route.type === "liked" || route.type === "local"
      ? remote.liked.map((id) => remote.tracks.get(id)).filter(Boolean)
      : remote.viewTracks;
  if (route.type === "liked")
    return library.liked.map((id) => trackById(id)).filter(Boolean);
  if (route.type === "local") return library.tracks;
  if (route.type === "playlist")
    return (library.playlists.find((p) => p.id === route.id)?.track_ids || [])
      .map((id) => trackById(id))
      .filter(Boolean);
  const t = trackById(route.id);
  return t ? library.tracks.filter((v) => v.album === t.album) : [];
}
function collectionDate(t) {
  return (
    remote.addedDates
      .get(route.type === "playlist" ? `playlist:${route.id}` : "liked")
      ?.get(t.id) || null
  );
}
function table(list) {
  const withDate =
    isSpotify() && ["liked", "local", "playlist"].includes(route.type);
  return `<table class="track-table ${withDate ? "with-date" : ""}"><thead><tr><th class="number">#</th><th class="song-heading">Title</th><th class="album-heading">Album</th>${withDate ? '<th class="date-added">Date added</th>' : ""}<th class="duration-cell">${icon("clock")}</th><th class="actions-cell"><span class="hidden">Actions</span></th></tr></thead><tbody>${list.map((t, i) => `<tr class="${current?.id === t.id ? "playing" : ""}" data-track="${h(t.id)}" data-index="${i}" tabindex="0" draggable="${!isSpotify() && route.type === "playlist"}" aria-label="Play ${h(t.title)} by ${h(t.artist)}"><td class="number">${current?.id === t.id && playing ? "▸" : i + 1}</td><td><div class="song-cell">${cover(t.cover)}<span class="text"><strong class="song-title">${h(t.title)}</strong><span class="song-artist">${artistLink(t)}</span></span></div></td><td class="album-cell">${t.albumId ? `<button class="inline-link" data-route="album" data-id="${h(t.albumId)}">${h(t.album)}</button>` : h(t.album)}</td>${withDate ? `<td class="date-added">${collectionDate(t) && !Number.isNaN(Date.parse(collectionDate(t))) ? h(new Date(collectionDate(t)).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })) : "—"}</td>` : ""}<td class="duration-cell">${formatTime(t.duration)}</td><td class="actions-cell"><div class="row-actions"><button class="icon-button like-row ${liked(t.id) ? "active" : ""}" data-like="${h(t.id)}" aria-label="${liked(t.id) ? "Remove from" : "Add to"} Liked Songs">${icon(liked(t.id) ? "check" : "plus")}</button><button class="icon-button" data-menu-track="${h(t.id)}" aria-label="Options for ${h(t.title)}">${icon("more")}</button></div></td></tr>`).join("")}</tbody></table>`;
}
function renderSearch() {
  const el = document.querySelector(".content");
  el.dataset.view = "search";
  if (!isSpotify())
    searchData.tracks = library.tracks.filter((t) =>
      `${t.title} ${t.artist} ${t.album}`
        .toLowerCase()
        .includes(searchQuery.toLowerCase()),
    );
  const labels = {
    all: "All",
    track: "Songs",
    artist: "Artists",
    album: "Albums",
    playlist: "Playlists",
  };
  let body = "";
  if (!searchQuery)
    body = empty(
      "What do you want to play?",
      isSpotify()
        ? "Search Spotify for artists, songs, albums and playlists."
        : "Search by song, artist or album.",
    );
  else if (isSpotify() && !connected())
    body = empty(
      "Connect to search Spotify",
      "Your account connects through the desktop app.",
      "connect",
      "Connect Spotify",
    );
  else if (!isSpotify() || searchType === "track")
    body = searchData.tracks.length
      ? table(searchData.tracks)
      : empty("No songs found", "Try a different title or artist.");
  else if (searchType === "all") {
    const top = searchData.artists?.[0];
    body = `<div class="search-top-grid">${top ? `<section><div class="section-heading"><h2>Top result</h2></div><div class="top-result">${artistCard(top)}</div></section>` : ""}${searchData.tracks.length ? `<section><div class="section-heading"><h2>Songs</h2><button class="text-button" data-search-type="track">Show all</button></div>${table(searchData.tracks.slice(0, 4))}</section>` : ""}</div>`;
    if (searchData.artists?.length)
      body += section(
        "Artists",
        `<div class="card-grid">${searchData.artists.slice(0, 6).map(artistCard).join("")}</div>`,
        '<button class="text-button" data-search-type="artist">Show all</button>',
      );
    if (searchData.albums.length)
      body += section(
        "Albums",
        `<div class="card-grid">${searchData.albums.slice(0, 6).map(albumCard).join("")}</div>`,
        '<button class="text-button" data-search-type="album">Show all</button>',
      );
    if (searchData.playlists.length)
      body += section(
        "Playlists",
        `<div class="card-grid">${searchData.playlists.slice(0, 6).map(playlistCard).join("")}</div>`,
        '<button class="text-button" data-search-type="playlist">Show all</button>',
      );
    if (
      !top &&
      !searchData.tracks.length &&
      !searchData.albums.length &&
      !searchData.playlists.length
    )
      body = empty("No results found", "Try a different artist or title.");
  } else if (searchType === "artist")
    body = searchData.artists?.length
      ? `<div class="card-grid">${searchData.artists.map(artistCard).join("")}</div>`
      : empty("No artists found", "Try another artist name.");
  else if (searchType === "album")
    body = `<div class="card-grid">${searchData.albums.map(albumCard).join("")}</div>`;
  else
    body = `<div class="card-grid">${searchData.playlists.map(playlistCard).join("")}</div>`;
  el.innerHTML =
    toolbar() +
    `<div class="content-body"><h1 class="search-heading">${searchQuery ? `Results for “${h(searchQuery)}”` : "Search your music"}</h1>${
      isSpotify()
        ? `<div class="chips search-types">${Object.entries(labels)
            .map(
              ([type, label]) =>
                `<button class="chip ${searchType === type ? "selected" : ""}" data-search-type="${type}">${label}</button>`,
            )
            .join("")}</div>`
        : ""
    }${body}${isSpotify() && searchData.more && searchType !== "all" ? '<button class="white-button load-more" data-action="more-search">Load more results</button>' : ""}</div>`;
}
function renderPanel() {
  const el = document.querySelector(".side-panel");
  el.classList.toggle("now-panel", panel === "now" && Boolean(current));
  if (!panel) {
    el.innerHTML = "";
    return;
  }
  if (panel === "queue") {
    el.innerHTML = `<div class="panel-title"><strong>Queue</strong>${ib("close", "Close queue", "close-panel")}</div><p class="queue-label">Now playing</p>${current ? queueItem(current, false) : '<p class="demo-caption">Nothing playing yet.</p>'}${trueShuffle ? `<div class="shuffle-note"><strong>True shuffle</strong><span class="shuffle-source">${h(shuffleSourceName())}</span><span>${isSpotify() ? (remote.shuffleOrder.length ? remote.shuffleOrder.filter((t) => !remote.shuffleSeen.has(t.id)).length + " songs left in this order" : "Play a collection to begin") : queue.upcoming().length + " songs left"}</span><button data-action="reshuffle">Reshuffle remaining</button></div>` : ""}<p class="queue-label">Next in queue</p>${
      (isSpotify()
        ? remote.queue
        : queue
            .upcoming()
            .map((id) => trackById(id))
            .filter(Boolean)
      )
        .map((t, i) => queueItem(t, true, i))
        .join("") ||
      '<p class="demo-caption">Choose a song or add one to your queue.</p>'
    }`;
    return;
  }
  el.innerHTML = current
    ? `<div class="now-visual">${cover(current.cover, current.album, "now-cover")}<div class="now-shade"></div><div class="panel-title"><strong>Now playing</strong>${ib("close", "Close now playing", "close-panel")}</div><div class="now-title"><div><h2>${h(current.title)}</h2><p>${artistLink(current)}</p></div><button class="icon-button ${liked(current.id) ? "active" : ""}" data-like="${h(current.id)}" aria-label="${liked(current.id) ? "Remove from" : "Add to"} Liked Songs">${icon(liked(current.id) ? "check" : "plus")}</button></div></div><div class="panel-details"><div class="info-card"><h3>${isSpotify() ? "Credits" : "About this recording"}</h3><strong>${artistLink(current)}</strong><p>${isSpotify() ? `Playing on ${h(remote.state?.device?.name || "your Spotify device")}.` : current.imported ? "Imported from your local files. Playback stays on this device." : "An original ambient recording, included with Rustify."}</p></div><div class="info-card"><div class="panel-title"><strong>Next in queue</strong><button class="text-button" data-action="queue">Open queue</button></div>${(() => {
        const next = isSpotify()
          ? remote.queue[0]
          : trackById(queue.upcoming()[0]);
        return next
          ? queueItem(next, false)
          : "<p>Your next song will appear here.</p>";
      })()}</div></div>`
    : `<div class="panel-title"><strong>Now playing</strong>${ib("close", "Close now playing", "close-panel")}</div><div class="panel-empty">${icon("music")}<p>Pick something to play.<br>Your music will appear here.</p></div>`;
}
function queueItem(t, removable, i = 0) {
  return `<div class="queue-item">${cover(t.cover)}<button class="text" data-queue-play="${h(t.id)}"><strong>${h(t.title)}</strong><small>${h(t.artist)}</small></button>${removable && !isSpotify() ? `<button class="icon-button" data-queue-remove="${i}" aria-label="Remove ${h(t.title)} from queue">${icon("close")}</button>` : ""}</div>`;
}
function renderPlayer() {
  const repeat = isSpotify()
    ? { off: "off", context: "all", track: "one" }[
        remote.state?.repeat_state
      ] || "off"
    : queue.repeat;
  const shuffle = trueShuffle;
  document.querySelector(".player").innerHTML =
    `<div class="current-track">${current ? `${cover(current.cover, current.album)}<button class="text" data-action="now-panel"><strong>${h(current.title)}</strong><small>${h(current.artist)}</small></button><button class="icon-button ${liked(current.id) ? "active" : ""}" data-like="${h(current.id)}" aria-label="${liked(current.id) ? "Remove from" : "Add to"} Liked Songs">${icon(liked(current.id) ? "check" : "plus")}</button>` : '<span class="muted" style="font-size:12px">Choose something to play</span>'}</div><div class="transport"><div class="transport-buttons">${ib("shuffle", "True shuffle", "shuffle", "", shuffle)}${ib("previous", "Previous track", "previous")}${ib(playing ? "pause" : "play", playing ? "Pause" : "Play", "play", "main-play")}${ib("next", "Next track", "next")}${ib("repeat", `Repeat: ${repeat}`, "repeat", "", repeat !== "off")}${repeat === "one" ? '<span style="position:absolute;font-size:9px;margin-left:210px;margin-top:-4px;pointer-events:none">1</span>' : ""}</div><div class="timeline"><span id="elapsed">${formatTime(elapsed)}</span><input id="seek" type="range" min="0" max="${Math.max(1, duration)}" step=".1" value="${elapsed}" aria-label="Seek playback" style="--pct:${duration ? (elapsed / duration) * 100 : 0}%"><span id="duration">${formatTime(duration)}</span></div></div><div class="player-extras">${ib("queue", "Show queue", "queue", "", panel === "queue")}${ib("device", "Connect to a device", "devices", "device-button", Boolean(isSpotify() && remote.state?.device))}<div class="volume-controls" style="display:flex;align-items:center">${ib(muted ? "muted" : "volume", muted ? "Unmute" : "Mute", "mute")}<input id="volume" ${isSpotify() && remote.state?.device?.supports_volume === false ? "disabled" : ""} type="range" min="0" max="100" value="${muted ? 0 : Math.round(audio.volume * 100)}" aria-label="Volume" style="--pct:${muted ? 0 : audio.volume * 100}%"></div>${ib("expand", "Toggle now playing", "now-panel", "expand-btn", panel === "now")}</div>`;
  document.querySelector(".device-status").textContent =
    isSpotify() && remote.state?.device
      ? `Listening on ${remote.state.device.name}`
      : "";
}
function updateTime() {
  const seek = document.querySelector("#seek");
  if (seek && document.activeElement !== seek) {
    seek.max = Math.max(1, duration);
    seek.value = elapsed;
    seek.style.setProperty(
      "--pct",
      `${duration ? (elapsed / duration) * 100 : 0}%`,
    );
  }
  const time = document.querySelector("#elapsed");
  if (time) time.textContent = formatTime(elapsed);
  const total = document.querySelector("#duration");
  if (total) total.textContent = formatTime(duration);
}
async function navigate(next, record = true) {
  routeSequence++;
  const sequence = routeSequence;
  if (record) {
    history = history.slice(0, historyIndex + 1);
    history.push(next);
    historyIndex++;
  }
  route = next;
  document.querySelector(".content").scrollTop = 0;
  renderLibrary();
  if (
    isSpotify() &&
    connected() &&
    ["playlist", "album", "artist"].includes(next.type)
  ) {
    route = { type: "loading" };
    renderContent();
    try {
      if (next.type === "artist") await fetchArtist(next.id);
      else await fetchRemoteView(next);
      if (sequence !== routeSequence) return;
      route = next;
    } catch (error) {
      if (sequence !== routeSequence) return;
      route = next;
      remote.viewTracks = [];
      remote.viewMore = false;
      if (next.type === "artist") {
        remote.artist = null;
        remote.discography = [];
        remote.moreArtist = false;
      }
      remote.viewMeta =
        next.type === "playlist"
          ? {
              ...remote.playlists.find((p) => p.id === next.id),
              kind: "Playlist",
            }
          : { title: "Album", kind: "Album" };
      toast(error, true);
    }
  }
  if (sequence !== routeSequence) return;
  renderContent();
  renderLibrary();
}
async function fetchRemoteView(next, more = false) {
  const sequence = routeSequence;
  const offset = more ? remote.viewOffset : 0;
  const previousTracks = [...remote.viewTracks];
  if (next.type === "playlist") {
    const p =
      remote.playlists.find((p) => p.id === next.id) ||
      searchData.playlists.find((p) => p.id === next.id);
    const meta = { ...p, kind: "Playlist" };
    const data = await api(
      "GET",
      `/playlists/${encodeURIComponent(next.id)}/items?limit=50&offset=${offset}`,
    );
    const items = cache(
      data.items
        ?.filter((i) => i.item?.type === "track")
        .map((i) => ({ ...i.item, added_at: i.added_at })) || [],
    );
    await checkSaved(items);
    if (sequence !== routeSequence) return;
    const dates = more
      ? new Map(remote.addedDates.get(`playlist:${next.id}`) || [])
      : new Map();
    (data.items || []).forEach((entry) => {
      if (entry.item?.id)
        dates.set(entry.item.linked_from?.id || entry.item.id, entry.added_at);
    });
    remote.addedDates.set(`playlist:${next.id}`, dates);
    remote.viewMeta = { ...meta, total: data.total };
    remote.viewTracks = more ? [...previousTracks, ...items] : items;
    remote.viewMore = Boolean(data.next);
    remote.viewOffset = offset + (data.items?.length || 0);
  } else {
    const album = await api("GET", `/albums/${encodeURIComponent(next.id)}`);
    const data = await api(
      "GET",
      `/albums/${encodeURIComponent(next.id)}/tracks?limit=50&offset=${offset}`,
    );
    const items = cache(data.items?.map((t) => ({ ...t, album })) || []);
    await checkSaved(items);
    const saved = await api(
      "GET",
      `/me/library/contains?uris=${encodeURIComponent(album.uri)}`,
    );
    if (sequence !== routeSequence) return;
    remote.savedAlbums.set(next.id, Boolean(saved[0]));
    remote.viewMeta = {
      id: album.id,
      artistId: album.artists?.[0]?.id,
      title: album.name,
      kind: "Album",
      description: album.artists?.map((a) => a.name).join(", "),
      cover: safeImage(album.images?.[0]?.url),
      uri: album.uri,
      total: data.total,
    };
    remote.viewTracks = more ? [...previousTracks, ...items] : items;
    remote.viewMore = Boolean(data.next);
    remote.viewOffset = offset + (data.items?.length || 0);
  }
}
async function fetchPlaylists(more = false) {
  const offset = more ? remote.playlistOffset : 0;
  const data = await api("GET", `/me/playlists?limit=50&offset=${offset}`);
  const list = (data.items || []).filter(Boolean).map(normPlaylist);
  remote.playlists = more ? [...remote.playlists, ...list] : list;
  remote.morePlaylists = Boolean(data.next);
  remote.playlistOffset = offset + (data.items?.length || 0);
  renderLibrary();
}
async function fetchAlbums(more = false) {
  const offset = more ? remote.albumOffset : 0;
  const data = await api("GET", `/me/albums?limit=50&offset=${offset}`);
  const items = (data?.items || [])
    .filter((t) => t.album)
    .map((t) => normAlbum(t.album));
  items.forEach((a) => remote.savedAlbums.set(a.id, true));
  remote.albums = more ? [...remote.albums, ...items] : items;
  remote.albumOffset = offset + (data?.items?.length || 0);
  remote.moreAlbums = Boolean(data?.next);
  renderLibrary();
}
async function fetchArtist(id, more = false) {
  const sequence = routeSequence;
  const artist = more
    ? remote.artist
    : await api("GET", `/artists/${encodeURIComponent(id)}`);
  const offset = more ? remote.artistOffset : 0;
  const data = await api(
    "GET",
    `/artists/${encodeURIComponent(id)}/albums?include_groups=album,single&limit=10&offset=${offset}`,
  );
  if (sequence !== routeSequence) return;
  remote.artist = artist;
  remote.discography = more
    ? [...remote.discography, ...(data.items || []).map(normAlbum)]
    : (data.items || []).map(normAlbum);
  remote.artistOffset = offset + (data.items?.length || 0);
  remote.moreArtist = Boolean(data.next);
}
async function toggleSavedAlbum() {
  const id = route.id,
    uri = `spotify:album:${id}`;
  const wasSaved = remote.savedAlbums.get(id);
  await api(
    wasSaved ? "DELETE" : "PUT",
    `/me/library?uris=${encodeURIComponent(uri)}`,
  );
  remote.savedAlbums.set(id, !wasSaved);
  await fetchAlbums();
  renderContent();
  toast(
    wasSaved
      ? "Album removed from your library"
      : "Album saved to your library",
  );
}
async function fetchLiked(more = false) {
  const offset = more ? remote.likedOffset : 0;
  const data = await api("GET", `/me/tracks?limit=50&offset=${offset}`);
  const list = cache(
    (data.items || []).map((i) =>
      i.track ? { ...i.track, added_at: i.added_at } : null,
    ),
  );
  const dates = more
    ? new Map(remote.addedDates.get("liked") || [])
    : new Map();
  (data.items || []).forEach((entry) => {
    if (entry.track?.id)
      dates.set(entry.track.linked_from?.id || entry.track.id, entry.added_at);
  });
  remote.addedDates.set("liked", dates);
  list.forEach((t) => remote.saved.set(t.id, true));
  remote.liked = more
    ? [...remote.liked, ...list.map((t) => t.id)]
    : list.map((t) => t.id);
  remote.likedTotal = data.total;
  remote.moreLiked = Boolean(data.next);
  remote.likedOffset = offset + (data.items?.length || 0);
  renderLibrary();
}
async function refreshState(silent = true) {
  if (!connected() || !isSpotify() || remote.refreshing) return;
  remote.refreshing = true;
  try {
    const epoch = remote.playbackEpoch;
    const previousId = current?.id;
    const state = await api("GET", "/me/player");
    if (epoch !== remote.playbackEpoch) return;
    remote.state = state;
    if (state?.item) {
      if(remote.shuffleOrder.length&&!remote.shuffleOrder.some(t=>t.id===(state.item.linked_from?.id||state.item.id))&&!remote.playbackAliases.has(state.item.id)){
        const priorIndex=remote.shuffleOrder.findIndex(t=>t.id===previousId);
        const next=remote.shuffleOrder[(priorIndex+1)%remote.shuffleOrder.length];
        let canonical=next&&await sameRecording(next,state.item,resolveTrackMetadata)?next:null;
        if(!canonical){
          const metadata=await resolveTrackMetadata(state.item.id);
          const isrc=metadata?.external_ids?.isrc?.toUpperCase();
          if(isrc){
            canonical=remote.shuffleOrder.find(t=>t.isrc?.toUpperCase()===isrc);
            if(!canonical){
              const candidates=[...remote.shuffleOrder.slice(priorIndex+1),...remote.shuffleOrder.slice(0,priorIndex+1)];
              for(const candidate of candidates){
                if(!candidate.isrc)candidate.isrc=(await resolveTrackMetadata(candidate.id))?.external_ids?.isrc||null;
                if(epoch!==remote.playbackEpoch)return;
                if(candidate.isrc?.toUpperCase()===isrc){canonical=candidate;break;}
              }
            }
          }
        }
        if(epoch!==remote.playbackEpoch)return;
        if(canonical)remote.playbackAliases.set(state.item.id,canonical.id);
      }
      [current] = cache([state.item],true);
      if (remote.shuffleOrder.length) {
        if (state.shuffle_state||(state.context?.uri||null)!==remote.shuffleExpectedContext||(state.device?.id||null)!==remote.shuffleDevice) {
          remote.shuffleOrder=[];remote.shuffleSource=[];remote.shuffleContext=null;remote.playbackAliases.clear();
        } else {
          const index = remote.shuffleOrder.findIndex(
            (t) => t.id === current.id,
          );
          if (
            index === 0 &&
            previousId !== current.id &&
            state.repeat_state === "context"
          )
            remote.shuffleSeen.clear();
          if (index >= 0)
            remote.shuffleOrder
              .slice(0, index + 1)
              .forEach((t) => remote.shuffleSeen.add(t.id));
        }
      }
      playing = state.is_playing;
      elapsed = (state.progress_ms || 0) / 1000;
      duration = current.duration;
      remote.deviceId = state.device?.id;
      const volume = state.device?.volume_percent;
      if (volume != null) audio.volume = volume / 100;
      muted = volume === 0;
      await checkSaved([current]);
    } else {
      current = null;
      playing = false;
      elapsed = 0;
      duration = 0;
    }
    if (!document.querySelector(".player input:focus")) renderPlayer();
    renderPanel();
    if (previousId !== current?.id || panel === "queue" || panel === "now")
      await refreshQueue();
  } catch (error) {
    if (!silent && !error.stale) toast(error, true);
  } finally {
    remote.refreshing = false;
  }
}
async function refreshQueue() {
  if (!connected()) return;
  const result = await api("GET", "/me/player/queue");
  remote.queue = cache(result.queue || [],true);
  renderPanel();
}
async function playerCommand(method, path, body) {
  await api(method, path, body);
  await refreshState(false);
  if (panel === "queue") await refreshQueue();
}
function deviceQuery() {
  return remote.deviceId
    ? `?device_id=${encodeURIComponent(remote.deviceId)}`
    : "";
}
function shuffleContext() {
  if (remote.shuffleContext) return { ...remote.shuffleContext };
  const match = (remote.state?.context?.uri || "").match(
    /^spotify:(playlist|album):([^:]+)$/,
  );
  if (match) return { type: match[1], id: match[2] };
  if (
    ["liked", "local", "playlist", "album"].includes(route.type) &&
    (!current || viewTracks().some((t) => t.id === current.id))
  )
    return { ...route };
  return null;
}
function cancelledPlayback() {
  const error = new Error("A newer playback action replaced this request.");
  error.stale = true;
  return error;
}
function shuffleSourceName() {
  if (!isSpotify()) return localPlaybackContext || "Local collection";
  const context = remote.shuffleContext;
  if (!context) return "Start a collection to create an order";
  if (context.type === "liked" || context.type === "local")
    return "Liked Songs";
  if (context.type === "search")
    return `Search results for “${context.query || searchQuery}”`;
  if (context.type === "playlist")
    return (
      remote.playlists.find((p) => p.id === context.id)?.title ||
      "Selected playlist"
    );
  return remote.shuffleSource[0]?.album || "Selected album";
}
function shuffleControls() {
  const remainingKnown = !isSpotify() || remote.shuffleSource.length > 0;
  return `${ib("shuffle", "True shuffle", "shuffle", "", trueShuffle)}${trueShuffle ? `<button class="shuffle-label" data-action="reshuffle" title="${remainingKnown ? "Shuffle the remaining songs again" : "Start a new shuffle cycle"}">True shuffle <span>${remainingKnown ? "Reshuffle" : "Start new cycle"}</span></button>` : ""}`;
}
async function startLocalCollection(list, id = null) {
  const sequence = ++playSequence;
  remote.pendingSequential = null;
  remote.pendingReshuffle = false;
  localPlaybackContext =
    route.type === "search"
      ? `Search results for “${searchQuery}”`
      : ["playlist", "album", "liked", "local"].includes(route.type)
        ? viewInfo().title
        : "Local collection";
  const selected = [...new Map(list.map((t) => [t.id, t])).values()];
  if (!selected.length) return;
  const order = trueShuffle
    ? await shuffleTracks(
        selected.map((t) => t.id),
        id,
      )
    : null;
  if (sequence !== playSequence) return;
  queue._shuffle = trueShuffle;
  queue.start(
    selected.map((t) => t.id),
    id,
    order,
  );
  await loadAndPlay(trackById(queue.current));
}
async function resolveTrackMetadata(id){
  if(!id)return null;
  if(!remote.trackMetadata.has(id)){
    const pending=api('GET',`/tracks/${encodeURIComponent(id)}`).catch(error=>{remote.trackMetadata.delete(id);throw error;});
    remote.trackMetadata.set(id,pending);
  }
  return remote.trackMetadata.get(id);
}
async function confirmRemoteOrder(ordered,sequence){
  const aliases=new Map();
  const resolve=async id=>{
    if(sequence!==playSequence)throw cancelledPlayback();
    const metadata=await resolveTrackMetadata(id);
    if(sequence!==playSequence)throw cancelledPlayback();return metadata;
  };
  const matches=async(expected,actual)=>{
    if(!await sameRecording(expected,actual,resolve))return false;
    if(actual?.id){
      const existing=aliases.get(actual.id);
      if(existing&&existing!==expected.id)throw new Error('Spotify mapped multiple releases to one recording. Remove duplicate releases from this collection before using True shuffle.');
      aliases.set(actual.id,expected.id);
    }
    return true;
  };
  const expected=ordered.slice(1,21);
  for(let attempt=0;attempt<20;attempt++){
    if(sequence!==playSequence)throw cancelledPlayback();
    const state=await api('GET','/me/player');
    if(await matches(ordered[0],state?.item)&&!state.shuffle_state){
      const queued=await api('GET','/me/player/queue');
      if(sequence!==playSequence)throw cancelledPlayback();
      let correct=true;
      for(let i=0;i<expected.length;i++){if(!await matches(expected[i],queued.queue?.[i])){correct=false;break;}}
      if(correct)return {state,aliases};
    }
    await new Promise(resolve=>setTimeout(resolve,200));
  }
  throw new Error('Spotify has not confirmed this order. Clear other manually queued songs in Spotify, then try again.');
}
async function startRemoteShuffle(
  context,
  keepFirst = null,
  keepPosition = 0,
  reshuffle = false,
  preserveCurrent = false,
  providedTracks = null,
) {
  const sequence = ++playSequence;
  remote.pendingSequential = null;
  remote.pendingReshuffle = false;
  const loaded = providedTracks
    ? { tracks: providedTracks, unavailable: 0, duplicates: 0 }
    : reshuffle && remote.shuffleSource.length
      ? { tracks: remote.shuffleSource, unavailable: 0, duplicates: 0 }
      : await allCollectionTracks(context, async (...args) => {
          if (sequence !== playSequence) throw cancelledPlayback();
          const result = await api(...args);
          if (sequence !== playSequence) throw cancelledPlayback();
          return result;
        });
  const source =
    providedTracks ||
    (reshuffle && remote.shuffleSource.length
      ? remote.shuffleSource
      : cache(loaded.tracks));
  const candidates = reshuffle
    ? source.filter((t) => !remote.shuffleSeen.has(t.id) || t.id === keepFirst)
    : source;
  if (!candidates.length)
    throw new Error(
      "No unplayed songs remain. Start the collection again for a new cycle.",
    );
  if (keepFirst && !candidates.some((t) => t.id === keepFirst)) {
    toast("True shuffle is ready. Play this collection to start.");
    return;
  }
  const order = await shuffleTracks(
    candidates.map((t) => t.id),
    keepFirst,
  );
  if (sequence !== playSequence) return;
  const lookup = new Map(source.map((t) => [t.id, t]));
  const ordered = order.map((id) => lookup.get(id));
  const suffix = remote.deviceId
    ? "&device_id=" + encodeURIComponent(remote.deviceId)
    : "";
  if (preserveCurrent) {
    const fresh = await api("GET", "/me/player");
    const rawId = fresh?.item?.linked_from?.id || fresh?.item?.id;
    const freshId = remote.playbackAliases.get(rawId)||rawId;
    if (
      freshId !== keepFirst ||
      (preserveCurrent === "playing" && !fresh?.is_playing)
    )
      throw new Error(
        "Playback changed while the collection loaded. Try True shuffle again.",
      );
    keepPosition = (fresh.progress_ms || 0) / 1000;
  }
  if (sequence !== playSequence) return;
  await api("PUT", `/me/player/shuffle?state=false${suffix}`);
  if (sequence !== playSequence) return;
  remote.playbackEpoch++;
  const targetDevice = remote.deviceId;
  let confirmed;
  try {
    await api("PUT", `/me/player/play${deviceQuery()}`, {
      uris: ordered.map((t) => t.uri),
      offset: { position: 0 },
      ...(keepFirst
        ? { position_ms: Math.max(0, Math.floor(keepPosition * 1000)) }
        : {}),
    });
    confirmed = await confirmRemoteOrder(ordered, sequence);
  } catch (error) {
    // Don't leave a foreign/unconfirmed order playing, or pause a newer intent/device.
    if (sequence === playSequence && remote.deviceId === targetDevice) {
      try {
        await api("PUT", `/me/player/pause${deviceQuery()}`);
        await refreshState(false);
      } catch {
        if (!error.stale)
          error.message +=
            " Check your Spotify device; Rustify could not confirm that it paused.";
      }
    }
    throw error;
  }
  if (sequence !== playSequence) return;
  remote.playbackEpoch++;
  remote.state = confirmed.state;
  remote.playbackAliases=confirmed.aliases;
  remote.shuffleExpectedContext=confirmed.state.context?.uri||null;remote.shuffleDevice=confirmed.state.device?.id||null;
  [current] = cache([confirmed.state.item],true);
  playing = confirmed.state.is_playing;
  elapsed = (confirmed.state.progress_ms || 0) / 1000;
  duration = current.duration;
  remote.pendingReshuffle = false;
  remote.shuffleSource = source;
  remote.shuffleOrder = ordered;
  remote.shuffleContext = { ...context };
  if (!reshuffle) remote.shuffleSeen = new Set();
  remote.shuffleSeen.add(ordered[0].id);
  await refreshState(false);
  renderContent();
  renderPanel();
  renderPlayer();
  toast(
    `True shuffle: ${ordered.length} ${context.type === "search" ? (ordered.length === 1 ? "loaded search result" : "loaded search results") : ordered.length === 1 ? "unique song" : "unique songs"}${loaded.unavailable ? `, ${loaded.unavailable} unavailable items skipped` : ""}`,
  );
}
async function toggleTrueShuffle() {
  const sequence = ++playSequence;
  remote.pendingSequential = null;
  remote.pendingReshuffle = false;
  trueShuffle = !trueShuffle;
  localStorage.setItem("rustify-true-shuffle", String(trueShuffle));
  try {
    if (isSpotify()) {
      if (connected() && current) {
        const context = shuffleContext();
        if (trueShuffle && context) {
          if (playing)
            await startRemoteShuffle(
              context,
              current.id,
              elapsed,
              false,
              "playing",
            );
          else {
            remote.pendingReshuffle = true;
            remote.shuffleContext = context;
            toast("True shuffle will start when you press Play.");
          }
        } else if (!trueShuffle) {
          await api(
            "PUT",
            `/me/player/shuffle?state=false${remote.deviceId ? "&device_id=" + encodeURIComponent(remote.deviceId) : ""}`,
          );
          if (sequence !== playSequence) return;
          if (
            remote.shuffleContext &&
            remote.shuffleSource.some((t) => t.id === current.id)
          ) {
            const c = remote.shuffleContext;
            const body = ["playlist", "album"].includes(c.type)
              ? {
                  context_uri: `spotify:${c.type}:${c.id}`,
                  offset: { uri: current.uri },
                  position_ms: Math.floor(elapsed * 1000),
                }
              : {
                  offset: { position: 0 },
                  uris: remote.shuffleSource
                    .slice(
                      remote.shuffleSource.findIndex(
                        (t) => t.id === current.id,
                      ),
                    )
                    .map((t) => t.uri),
                  position_ms: Math.floor(elapsed * 1000),
                };
            if (playing)
              await playerCommand(
                "PUT",
                `/me/player/play${deviceQuery()}`,
                body,
              );
            else remote.pendingSequential = body;
          }
          if (sequence !== playSequence) return;
          remote.shuffleOrder = [];
          remote.shuffleContext = null;
          remote.shuffleSource = [];
        } else toast("True shuffle enabled. Play a collection to begin.");
      }
    } else {
      const order = trueShuffle
        ? await shuffleTracks(queue.remainingPool())
        : null;
      if (sequence !== playSequence) return;
      queue.setShuffle(trueShuffle, order);
    }
  } finally {
    renderPlayer();
    renderContent();
    renderPanel();
  }
}
async function reshuffleRemaining() {
  if (!trueShuffle) {
    await toggleTrueShuffle();
    return;
  }
  if (isSpotify()) {
    const context = shuffleContext();
    if (!context) {
      toast("Play a collection to start True shuffle.");
      return;
    }
    if (current && !playing) {
      remote.pendingReshuffle = true;
      toast("The remaining songs will reshuffle when you press Play.");
      return;
    }
    if (current && remote.shuffleSource.length)
      await startRemoteShuffle(context, current.id, elapsed, true, "playing");
    else await startRemoteShuffle(context);
  } else {
    if (!current) {
      await startLocalCollection(viewTracks());
      return;
    }
    const sequence = ++playSequence,
      currentId = queue.current;
    const order = await shuffleTracks(queue.remainingPool());
    if (sequence !== playSequence || currentId !== queue.current) return;
    queue.reshuffle(order);
    renderPanel();
    renderContent();
    toast(`${queue.upcoming().length} remaining songs reshuffled`);
  }
}
async function playTrack(id, list = viewTracks(), useContext = true) {
  const sequence = ++playSequence;
  remote.pendingSequential = null;
  remote.pendingReshuffle = false;
  const t = trackById(id);
  if (!t) return;
  if (isSpotify()) {
    if (!t.uri || t.available === false)
      throw new Error("This item is unavailable for playback.");
    if (trueShuffle && useContext) {
      const context = ["playlist", "album", "liked", "local"].includes(
        route.type,
      )
        ? { ...route }
        : null;
      if (context) {
        await startRemoteShuffle(context, id);
        return;
      }
      await startRemoteShuffle(
        { type: "search", query: searchQuery },
        id,
        0,
        false,
        false,
        list.filter((t) => t.available !== false),
      );
      return;
    }
    remote.shuffleOrder = [];
    remote.shuffleSource = [];
    remote.shuffleContext = null;
    remote.shuffleSeen.clear();
    let body;
    if (useContext && (route.type === "playlist" || route.type === "album"))
      body = {
        context_uri: `spotify:${route.type}:${route.id}`,
        offset: { uri: t.uri },
      };
    else {
      const items = list.length ? list : [t];
      const index = Math.max(
        0,
        items.findIndex((item) => item.id === id),
      );
      body = {
        offset: { position: 0 },
        uris: items
          .slice(index)
          .map((t) => t.uri)
          .filter(Boolean),
      };
      if (!body.uris.includes(t.uri))
        body = { uris: [t.uri], offset: { position: 0 } };
    }
    await playerCommand("PUT", `/me/player/play${deviceQuery()}`, body);
    return;
  }
  await startLocalCollection(list.length ? list : [t], id);
}
async function loadAndPlay(t) {
  const sequence = ++playSequence;
  current = t;
  elapsed = 0;
  duration = t.duration;
  audio.pause();
  playing = false;
  renderPlayer();
  renderPanel();
  const src = await source(t);
  if (sequence !== playSequence) return;
  audio.src = src;
  try {
    await audio.play();
  } catch {
    if (sequence !== playSequence) return;
    playing = false;
    renderPlayer();
    throw new Error(
      "This audio could not play. Try a supported MP3, WAV, M4A or OGG file.",
    );
  }
  if (sequence !== playSequence) return;
  library.recent = [t.id, ...library.recent.filter((id) => id !== t.id)].slice(
    0,
    12,
  );
  await save();
  renderContent();
}
async function advance(previous = false, ended = false) {
  if (isSpotify()) {
    playSequence++;
    remote.pendingSequential = null;
    remote.pendingReshuffle = false;
    await playerCommand(
      "POST",
      `/me/player/${previous ? "previous" : "next"}${deviceQuery()}`,
    );
    return;
  }
  if (previous && audio.currentTime > 3) {
    audio.currentTime = 0;
    return;
  }
  const id = previous ? queue.previous() : queue.next(ended);
  if (id) {
    const t = trackById(id);
    if (t) await loadAndPlay(t);
  } else {
    playing = false;
    audio.pause();
    if (ended) audio.currentTime = 0;
    renderPlayer();
    renderPanel();
  }
}
async function togglePlay() {
  if (isSpotify()) {
    playSequence++;
    if (!connected()) {
      openConnect();
      return;
    }
    if (!playing && remote.pendingSequential) {
      const body = remote.pendingSequential;
      await playerCommand("PUT", `/me/player/play${deviceQuery()}`, body);
      remote.pendingSequential = null;
      return;
    }
    if (
      !playing &&
      trueShuffle &&
      (!remote.shuffleOrder.length || remote.pendingReshuffle)
    ) {
      const context = shuffleContext();
      if (context) {
        await startRemoteShuffle(
          context,
          current?.id || null,
          elapsed,
          Boolean(remote.shuffleSource.length && remote.pendingReshuffle),
          "resume",
        );
        return;
      }
    }
    await playerCommand(
      "PUT",
      `/me/player/${playing ? "pause" : "play"}${deviceQuery()}`,
    );
    return;
  }
  if (!current) {
    const first = viewTracks()[0] || library.tracks[0];
    if (first)
      await playTrack(
        first.id,
        viewTracks().length ? viewTracks() : library.tracks,
      );
    return;
  }
  if (audio.paused) await audio.play();
  else audio.pause();
}
async function toggleLike(id) {
  if (isSpotify()) {
    const t = trackById(id);
    if (!t?.uri) return;
    await checkSaved([t]);
    const wasLiked = liked(id);
    await api(
      wasLiked ? "DELETE" : "PUT",
      `/me/library?uris=${encodeURIComponent(t.uri)}`,
    );
    remote.liked = wasLiked
      ? remote.liked.filter((v) => v !== id)
      : [id, ...remote.liked];
    remote.saved.set(id, !wasLiked);
    remote.likedTotal += wasLiked ? -1 : 1;
    await fetchLiked();
    toast(wasLiked ? "Removed from Liked Songs" : "Added to Liked Songs");
  } else {
    library.liked = liked(id)
      ? library.liked.filter((v) => v !== id)
      : [id, ...library.liked];
    await save();
  }
  renderLibrary();
  renderPlayer();
  renderPanel();
  if (
    route.type === "liked" ||
    route.type === "search" ||
    route.type === "playlist"
  )
    renderContent();
}
function openModal(title, body, actions = "") {
  closeModal();
  modalReturnFocus = document.activeElement;
  const container = document.createElement("div");
  container.className = "modal-backdrop";
  container.innerHTML = `<section class="modal" role="dialog" aria-modal="true" aria-label="${h(title)}"><div class="modal-head"><h2>${h(title)}</h2>${ib("close", "Close dialog", "close-modal")}</div>${body}<div class="status-message" role="alert"></div>${actions ? `<div class="modal-actions">${actions}</div>` : ""}</section>`;
  document.body.append(container);
  setTimeout(() => container.querySelector("input,button")?.focus(), 0);
}
function closeModal() {
  document.querySelector(".modal-backdrop")?.remove();
  modalReturnFocus?.focus();
}
function openConnect() {
  if (connected()) {
    openSettings();
    return;
  }
  const id =
    localStorage.getItem("rustify-client-id") ||
    import.meta.env.VITE_SPOTIFY_CLIENT_ID ||
    "";
  openModal(
    "Connect to Spotify",
    `<p>Sign in securely in your browser. Rustify plays Spotify on this computer by itself or controls your other Spotify devices.</p><label for="client-id">Spotify Developer Client ID</label><input id="client-id" value="${h(id)}" maxlength="32" autocomplete="off" spellcheck="false"><p>Register this exact redirect URI in your Spotify app settings:</p><code>http://127.0.0.1:43821/callback</code><p>${native ? "Spotify audio requires Premium. Rustify plays it without the Spotify app." : "Browser preview: sign-in is available in the Tauri desktop app. Run npm run desktop."}</p>`,
    `<button class="green-button" data-action="do-connect">Continue to Spotify</button>`,
  );
}
function openSettings() {
  openModal(
    "Settings",
    `<p><strong>${h(remote.profile?.display_name || "Rustify")}</strong><br>${connected() ? "Connected to Spotify. Your login is saved securely on this device." : "Connect Spotify or listen to music stored on this device."}</p><p>Playback source</p><div class="chips"><button class="chip ${isSpotify() ? "selected" : ""}" data-mode="spotify">Spotify</button><button class="chip ${!isSpotify() ? "selected" : ""}" data-mode="local">Local files</button></div><p>Spotify plays through Rustify’s built-in player; no browser tab needed. Local files play directly in Rustify.</p><div class="shuffle-setting"><div><strong>True shuffle</strong><p>Equal odds for every unique song. No artist weighting or repeats within a cycle. Duplicate copies count once; songs you add manually and Repeat One can still repeat. On Spotify, Repeat All replays this order. Use Reshuffle for a new order.</p></div><button class="chip ${trueShuffle ? "selected" : ""}" data-action="shuffle" aria-pressed="${trueShuffle}">${trueShuffle ? "On" : "Off"}</button></div><button class="white-button" data-action="import">Import local music</button><p style="margin-top:24px">Rustify is an independent Rust/Tauri app. The bundled music and artwork are original demos.</p>`,
    `<button class="${connected() ? "white-button" : "green-button"}" data-action="${connected() ? "disconnect" : "connect"}">${connected() ? "Disconnect Spotify" : "Connect Spotify"}</button>`,
  );
}
async function changeMode(next) {
  generation++;
  if (next === "local") {
    await spotify.stopPlayer();
    remote.deviceId = null;
  }
  searchSequence++;
  routeSequence++;
  libraryFilter = "all";
  playSequence++;
  audio.pause();
  current = null;
  playing = false;
  elapsed = 0;
  duration = 0;
  mode = next;
  localStorage.setItem("rustify-mode", mode);
  route = { type: "home" };
  history = [route];
  historyIndex = 0;
  searchQuery = "";
  document.querySelector("#global-search").value = "";
  closeModal();
  renderAll();
  if (isSpotify() && connected()) await refreshState(false);
}
function playlistDialog(edit = false) {
  if (isSpotify() && !connected()) {
    openConnect();
    return;
  }
  const p = edit ? playlists().find((p) => p.id === route.id) : null;
  openModal(
    edit ? "Edit playlist" : "Create playlist",
    `<label for="playlist-name">Name</label><input id="playlist-name" maxlength="100" value="${h(p?.title || "")}" placeholder="My playlist"><label for="playlist-description">Description</label><input id="playlist-description" maxlength="300" value="${h(p?.description || "")}" placeholder="Add an optional description">`,
    `<button class="white-button" data-action="close-modal">Cancel</button><button class="green-button" data-action="save-playlist" ${p ? `data-edit-id="${h(p.id)}"` : ""}>${edit ? "Save" : "Create"}</button>`,
  );
}
async function savePlaylist(id) {
  const title = document.querySelector("#playlist-name").value.trim();
  const description = document
    .querySelector("#playlist-description")
    .value.trim();
  if (!title) throw new Error("Give your playlist a name.");
  let created;
  if (isSpotify()) {
    if (id) {
      await api("PUT", `/playlists/${encodeURIComponent(id)}`, {
        name: title,
        description,
      });
      const p = remote.playlists.find((p) => p.id === id);
      if (p) Object.assign(p, { title, description });
    } else {
      const p = await api("POST", "/me/playlists", {
        name: title,
        description,
        public: false,
      });
      created = normPlaylist(p);
      remote.playlists.unshift(created);
    }
  } else {
    if (id) {
      Object.assign(
        library.playlists.find((p) => p.id === id),
        { title, description },
      );
    } else {
      created = {
        id: crypto.randomUUID(),
        title,
        description,
        cover: "/art/local.svg",
        track_ids: [],
      };
      library.playlists.unshift(created);
    }
    await save();
  }
  closeModal();
  renderLibrary();
  if (created) await navigate({ type: "playlist", id: created.id });
  else renderContent();
}
function addToPlaylistDialog(id) {
  openModal(
    "Add to playlist",
    `${
      playlists().length
        ? playlists()
            .map(
              (p) =>
                `<button class="playlist-pick" data-add-to="${h(p.id)}" data-song="${h(id)}">${cover(p.cover)}<span>${h(p.title)}</span></button>`,
            )
            .join("")
        : "<p>Create a playlist first.</p>"
    }`,
    `<button class="white-button" data-action="create-playlist">New playlist</button>`,
  );
}
async function addToPlaylist(playlistId, trackId) {
  const t = trackById(trackId);
  if (!t) return;
  if (isSpotify())
    await api("POST", `/playlists/${encodeURIComponent(playlistId)}/items`, {
      uris: [t.uri],
    });
  else {
    const p = library.playlists.find((p) => p.id === playlistId);
    if (!p.track_ids.includes(trackId)) {
      p.track_ids.push(trackId);
      p.cover = p.track_ids.length === 1 ? t.cover : p.cover;
      await save();
    }
  }
  closeModal();
  renderLibrary();
  if (route.type === "playlist" && route.id === playlistId) {
    if (isSpotify()) await fetchRemoteView(route);
    renderContent();
  }
  toast("Added to playlist");
}
function contextMenu(button, items) {
  document.querySelector(".context-menu")?.remove();
  const rect = button.getBoundingClientRect();
  const menu = document.createElement("div");
  menu.className = "context-menu";
  menu.setAttribute("role", "menu");
  menu.innerHTML = items;
  menu.style.left = `${Math.max(8, Math.min(rect.left, innerWidth - 260))}px`;
  menu.style.top = `${Math.max(8, Math.min(rect.bottom, innerHeight - 220))}px`;
  document.body.append(menu);
  menu.querySelector("button")?.focus();
}
function trackMenu(button, id) {
  contextMenu(
    button,
    `<button data-enqueue="${h(id)}">Add to queue</button><button data-add-playlist="${h(id)}">Add to playlist</button>${isSpotify() && trackById(id)?.artistId ? `<button data-route="artist" data-id="${h(trackById(id).artistId)}">Go to artist</button>` : ""}${isSpotify() && trackById(id)?.albumId ? `<button data-route="album" data-id="${h(trackById(id).albumId)}">Go to album</button>` : ""}<button data-like="${h(id)}">${liked(id) ? "Remove from" : "Add to"} Liked Songs</button>${route.type === "playlist" ? `<button data-remove-playlist-track="${h(id)}">Remove from this playlist</button>` : ""}`,
  );
}
async function search(more = false) {
  const sequence = ++searchSequence;
  if (!searchQuery.trim()) {
    searchData = {
      tracks: [],
      albums: [],
      artists: [],
      playlists: [],
      offset: 0,
      more: false,
    };
    renderSearch();
    return;
  }
  if (!isSpotify() || !connected()) {
    renderSearch();
    return;
  }
  const offset = more ? searchData.offset : 0;
  const type =
    searchType === "all" ? "track,artist,album,playlist" : searchType;
  const data = await api(
    "GET",
    `/search?q=${encodeURIComponent(searchQuery)}&type=${type}&limit=10&offset=${offset}`,
  );
  if (sequence !== searchSequence) return;
  if (searchType === "all") {
    const songs = cache((data.tracks?.items || []).filter(Boolean));
    await checkSaved(songs);
    if (sequence !== searchSequence) return;
    searchData = {
      tracks: songs,
      artists: (data.artists?.items || []).filter(Boolean),
      albums: (data.albums?.items || []).filter(Boolean).map(normAlbum),
      playlists: (data.playlists?.items || [])
        .filter(Boolean)
        .map(normPlaylist),
      offset: 0,
      more: false,
    };
  } else {
    const result = data[`${searchType}s`],
      items = (result?.items || []).filter(Boolean);
    if (searchType === "track") {
      const list = cache(items);
      await checkSaved(list);
      if (sequence !== searchSequence) return;
      searchData.tracks = more ? [...searchData.tracks, ...list] : list;
    } else if (searchType === "album") {
      const list = items.map(normAlbum);
      searchData.albums = more ? [...searchData.albums, ...list] : list;
    } else if (searchType === "artist")
      searchData.artists = more
        ? [...(searchData.artists || []), ...items]
        : items;
    else {
      const list = items.map(normPlaylist);
      searchData.playlists = more ? [...searchData.playlists, ...list] : list;
    }
    searchData.more = Boolean(result?.next);
    searchData.offset = offset + items.length;
  }
  if (route.type === "search") renderSearch();
}
async function doAction(action, button) {
  switch (action) {
    case "home":
      await navigate({ type: "home" });
      break;
    case "back":
      if (historyIndex > 0) await navigate(history[--historyIndex], false);
      break;
    case "forward":
      if (historyIndex < history.length - 1)
        await navigate(history[++historyIndex], false);
      break;
    case "connect":
      openConnect();
      break;
    case "settings":
      openSettings();
      break;
    case "close-modal":
      closeModal();
      break;
    case "switch-mode":
      await changeMode(isSpotify() ? "local" : "spotify");
      break;
    case "collapse-library": {
      const shell = document.querySelector(".app-shell");
      shell.classList.toggle("library-collapsed");
      localStorage.setItem(
        "rustify-collapsed",
        shell.classList.contains("library-collapsed"),
      );
      window.dispatchEvent(new Event("resize"));
      break;
    }
    case "library-search": {
      librarySearchOpen = true;
      let input = document.querySelector("#library-search");
      if (!input) {
        const el = document.createElement("input");
        el.className = "library-search";
        el.id = "library-search";
        el.setAttribute("aria-label", "Search your library");
        document.querySelector(".library-sort").after(el);
        input = el;
      }
      input.focus();
      break;
    }
    case "clear-search":
      searchQuery = "";
      searchSequence++;
      document.querySelector("#global-search").value = "";
      searchData = {
        tracks: [],
        albums: [],
        playlists: [],
        offset: 0,
        more: false,
      };
      await navigate({ type: "search" });
      document.querySelector("#global-search").focus();
      break;
    case "focus-search":
      document.querySelector("#global-search").focus();
      await navigate({ type: "search" });
      break;
    case "play":
      await togglePlay();
      break;
    case "play-view": {
      playSequence++;
      remote.pendingSequential = null;
      remote.pendingReshuffle = false;
      const list = viewTracks();
      if (trueShuffle) {
        if (isSpotify()) await startRemoteShuffle({ ...route });
        else await startLocalCollection(list);
      } else if (isSpotify() && route.type === "playlist") {
        await playerCommand("PUT", `/me/player/play${deviceQuery()}`, {
          context_uri: `spotify:playlist:${route.id}`,
        });
      } else if (isSpotify() && route.type === "album") {
        await playerCommand("PUT", `/me/player/play${deviceQuery()}`, {
          context_uri: `spotify:album:${route.id}`,
        });
      } else if (list.length) await playTrack(list[0].id, list);
      else toast("Add songs to start listening.");
      break;
    }
    case "next":
      await advance();
      break;
    case "previous":
      await advance(true);
      break;
    case "shuffle":
      await toggleTrueShuffle();
      break;
    case "reshuffle":
      await reshuffleRemaining();
      break;
    case "repeat":
      if (isSpotify()) {
        const repeat = { off: "context", context: "track", track: "off" }[
          remote.state?.repeat_state || "off"
        ];
        await playerCommand(
          "PUT",
          `/me/player/repeat?state=${repeat}${remote.deviceId ? "&device_id=" + encodeURIComponent(remote.deviceId) : ""}`,
        );
      } else {
        queue.cycleRepeat();
        renderPlayer();
      }
      break;
    case "queue":
      panel =
        panel === "queue" && (innerWidth > 960 || mobilePanelRequested)
          ? ""
          : "queue";
      mobilePanelRequested = innerWidth <= 960 && Boolean(panel);
      localStorage.setItem("rustify-panel", panel);
      renderTop();
      renderPanel();
      renderPlayer();
      if (isSpotify() && panel === "queue") await refreshQueue();
      break;
    case "now-panel":
      panel =
        panel === "now" && (innerWidth > 960 || mobilePanelRequested)
          ? ""
          : "now";
      mobilePanelRequested = innerWidth <= 960 && Boolean(panel);
      localStorage.setItem("rustify-panel", panel);
      renderTop();
      renderPanel();
      renderPlayer();
      break;
    case "close-panel":
      mobilePanelRequested = false;
      panel = "";
      localStorage.setItem("rustify-panel", panel);
      renderTop();
      renderPlayer();
      break;
    case "mute":
      if (isSpotify() && remote.state?.device?.supports_volume === false) {
        toast("This device controls its own volume.");
        break;
      }
      if (!muted) {
        previousVolume = audio.volume;
        audio.volume = 0;
        muted = true;
      } else {
        audio.volume = previousVolume || 0.65;
        muted = false;
      }
      if (isSpotify())
        await api(
          "PUT",
          `/me/player/volume?volume_percent=${Math.round(audio.volume * 100)}`,
        );
      audio.muted = muted;
      renderPlayer();
      break;
    case "import":
      if (native) {
        await importFiles();
      } else document.querySelector("#file-import").click();
      break;
    case "create-playlist":
      playlistDialog();
      break;
    case "save-playlist":
      await savePlaylist(button.dataset.editId);
      break;
    case "playlist-menu":
      contextMenu(
        button,
        '<button data-action="edit-playlist">Edit details</button><button data-action="delete-playlist">Delete playlist</button>',
      );
      break;
    case "edit-playlist":
      playlistDialog(true);
      break;
    case "delete-playlist":
      openModal(
        "Delete playlist?",
        `<p>Remove “${h(viewInfo().title)}” from your library? Your songs will remain available.</p>`,
        '<button class="white-button" data-action="close-modal">Cancel</button><button class="green-button" data-action="confirm-delete-playlist">Delete</button>',
      );
      break;
    case "confirm-delete-playlist":
      if (isSpotify()) {
        await api(
          "DELETE",
          `/me/library?uris=${encodeURIComponent(`spotify:playlist:${route.id}`)}`,
        );
        remote.playlists = remote.playlists.filter((p) => p.id !== route.id);
      } else {
        library.playlists = library.playlists.filter((p) => p.id !== route.id);
        await save();
      }
      closeModal();
      await navigate({ type: "home" });
      renderLibrary();
      toast("Playlist removed");
      break;
    case "save-album":
      await toggleSavedAlbum();
      break;
    case "more-albums":
      await fetchAlbums(true);
      if (route.type === "home" || route.type === "albums") renderContent();
      break;
    case "more-artist":
      await fetchArtist(route.id, true);
      renderContent();
      break;
    case "more-playlists":
      await fetchPlaylists(true);
      if (route.type === "home" || route.type === "playlists") renderContent();
      break;
    case "more-tracks":
      if (route.type === "liked" || route.type === "local")
        await fetchLiked(true);
      else await fetchRemoteView(route, true);
      renderContent();
      break;
    case "more-search":
      await search(true);
      break;
    case "do-connect": {
      const id = document.querySelector("#client-id").value.trim();
      if (!/^[a-f\d]{32}$/i.test(id))
        throw new Error(
          "Enter the 32-character public Client ID from your Spotify dashboard.",
        );
      localStorage.setItem("rustify-client-id", id);
      button.disabled = true;
      button.textContent = "Waiting for browser sign-in…";
      try {
        remote.profile = await spotify.connect(id);
        await changeMode("spotify");
        const results = await Promise.allSettled([
          fetchPlaylists(),
          fetchLiked(),
          fetchAlbums(),
          refreshState(false),
        ]);
        for (const result of results)
          if (result.status === "rejected") toast(result.reason, true);
        renderAll();
        toast("Connected to Spotify");
      } finally {
        if (button.isConnected) {
          button.disabled = false;
          button.textContent = "Continue to Spotify";
        }
      }
      break;
    }
    case "disconnect":
      playSequence++;
      generation++;
      searchSequence++;
      routeSequence++;
      await spotify.disconnect();
      remote = freshRemote();
      if (isSpotify()) {
        current = null;
        playing = false;
        elapsed = 0;
        duration = 0;
        route = { type: "home" };
        history = [route];
        historyIndex = 0;
        searchQuery = "";
        document.querySelector("#global-search").value = "";
      }
      closeModal();
      renderAll();
      break;
    default: {
      // Actions defined by feature modules (src/features/).
      const run = features.action(action);
      if (run) await run(button);
    }
  }
}
async function importFiles(files) {
  const imported = await importTracks(files);
  if (!imported.length) return;
  library.tracks.push(...imported);
  await save();
  if (mode !== "local") await changeMode("local");
  closeModal();
  await navigate({ type: "local" });
  renderLibrary();
  toast(
    `Imported ${imported.length} ${imported.length === 1 ? "song" : "songs"}`,
  );
}
function handleError(error) {
  if (error?.stale) return;
  const message = error?.message || String(error);
  const status = document.querySelector(".modal .status-message");
  if (status) status.textContent = message;
  else toast(message, true);
}
// Context handed to feature modules. Getters keep reassigned state current.
const featureContext = {
  get generation() { return generation; },
  get remote() { return remote; },
  get mode() { return mode; },
  get current() { return current; },
  get library() { return library; },
  isSpotify,
  connected,
  api,
  spotify,
  toast,
  openModal,
  closeModal,
  openConnect,
  renderAll,
  navigate,
  playTrack,
  handleError,
  h,
  icon,
  stale: () => Object.assign(new Error("Source changed."), { stale: true }),
};
const features = loadFeatures(featureList, featureContext);
document.addEventListener("click", async (event) => {
  const button = event.target.closest("button,[data-track]");
  const existingMenu = document.querySelector(".context-menu");
  if (existingMenu && !existingMenu.contains(event.target))
    existingMenu.remove();
  if (event.target.classList.contains("modal-backdrop")) {
    closeModal();
    return;
  }
  if (!button || button.disabled) return;
  try {
    if (button.dataset.action) {
      await doAction(button.dataset.action, button);
    } else if (button.dataset.mode) await changeMode(button.dataset.mode);
    else if (button.dataset.route) {
      if (isSpotify() && !connected() && button.dataset.route !== "home") {
        openConnect();
        return;
      }
      await navigate({ type: button.dataset.route, id: button.dataset.id });
    } else if (button.dataset.like) {
      await toggleLike(button.dataset.like);
    } else if (button.dataset.menuTrack)
      trackMenu(button, button.dataset.menuTrack);
    else if (button.dataset.enqueue) {
      const t = trackById(button.dataset.enqueue);
      if (isSpotify()) {
        await api("POST", `/me/player/queue?uri=${encodeURIComponent(t.uri)}`);
        await refreshQueue();
      } else {
        queue.enqueue(t.id);
        if (!current) {
          queue.start([t.id]);
          await loadAndPlay(t);
        }
      }
      renderPanel();
      toast("Added to queue");
    } else if (button.dataset.addPlaylist)
      addToPlaylistDialog(button.dataset.addPlaylist);
    else if (button.dataset.addTo)
      await addToPlaylist(button.dataset.addTo, button.dataset.song);
    else if (button.dataset.removePlaylistTrack) {
      if (isSpotify()) {
        const t = trackById(button.dataset.removePlaylistTrack);
        await api(
          "DELETE",
          `/playlists/${encodeURIComponent(route.id)}/items`,
          { items: [{ uri: t.uri }] },
        );
        await fetchRemoteView(route);
      } else {
        const p = library.playlists.find((p) => p.id === route.id);
        p.track_ids = p.track_ids.filter(
          (id) => id !== button.dataset.removePlaylistTrack,
        );
        await save();
      }
      renderContent();
      toast("Removed from playlist");
    } else if (button.dataset.device) {
      await api("PUT", "/me/player", {
        device_ids: [button.dataset.device],
        play: false,
      });
      remote.deviceId = button.dataset.device;
      closeModal();
      await refreshState(false);
      toast("Device selected");
    } else if (button.dataset.filter) {
      libraryFilter =
        libraryFilter === button.dataset.filter ? "all" : button.dataset.filter;
      renderLibrary();
    } else if (button.dataset.searchType) {
      searchType = button.dataset.searchType;
      await search();
    } else if (button.dataset.queuePlay) {
      if (!isSpotify()) {
        queue.start([button.dataset.queuePlay]);
        await loadAndPlay(trackById(button.dataset.queuePlay));
      } else
        await playTrack(
          button.dataset.queuePlay,
          [trackById(button.dataset.queuePlay)],
          false,
        );
    } else if (button.dataset.queueRemove != null) {
      playSequence++;
      const index = Number(button.dataset.queueRemove);
      queue.removeUpcoming(index);
      renderPanel();
    } else if (button.dataset.track) await playTrack(button.dataset.track);
    if (existingMenu?.contains(button)) existingMenu.remove();
  } catch (error) {
    handleError(error);
  }
});
document.addEventListener("input", (event) => {
  if (event.target.id === "global-search") {
    searchQuery = event.target.value;
    clearTimeout(searchTimer);
    searchSequence++;
    if (route.type !== "search") {
      route = { type: "search" };
      history = history.slice(0, historyIndex + 1);
      history.push(route);
      historyIndex++;
    }
    if (!isSpotify()) renderSearch();
    else searchTimer = setTimeout(() => search().catch(handleError), 350);
  } else if (event.target.id === "library-search") {
    librarySearch = event.target.value;
    const start = event.target.selectionStart;
    renderLibrary();
    const input = document.querySelector("#library-search");
    input?.focus();
    input?.setSelectionRange(start, start);
  } else if (event.target.type === "range") {
    event.target.style.setProperty(
      "--pct",
      `${(event.target.value / event.target.max) * 100}%`,
    );
    if (event.target.id === "seek") {
      document.querySelector("#elapsed").textContent = formatTime(
        Number(event.target.value),
      );
    } else if (event.target.id === "volume") {
      audio.volume = Number(event.target.value) / 100;
      audio.muted = false;
      muted = false;
      localStorage.setItem("rustify-volume", audio.volume);
    }
  }
});
document.addEventListener("change", async (event) => {
  try {
    if (event.target.id === "library-sort") {
      librarySort = event.target.value;
      renderLibrary();
    }
    if (event.target.id === "file-import") {
      await importFiles(event.target.files);
      event.target.value = "";
    }
    if (event.target.id === "seek") {
      const seconds = Number(event.target.value);
      if (isSpotify())
        await api(
          "PUT",
          `/me/player/seek?position_ms=${Math.round(seconds * 1000)}`,
        );
      else audio.currentTime = seconds;
      elapsed = seconds;
      updateTime();
    }
    if (event.target.id === "volume") {
      if (isSpotify() && remote.state?.device?.supports_volume === false) {
        toast("This device controls its own volume.");
        renderPlayer();
        return;
      }
      if (isSpotify())
        await api(
          "PUT",
          `/me/player/volume?volume_percent=${Math.round(audio.volume * 100)}`,
        );
      renderPlayer();
    }
  } catch (error) {
    handleError(error);
  }
});
document.addEventListener("keydown", (event) => {
  const dialog = document.querySelector(".modal");
  if (event.key === "Escape") {
    if (dialog) closeModal();
    else document.querySelector(".context-menu")?.remove();
    return;
  }
  if (dialog && event.key === "Tab") {
    const elements = [
      ...dialog.querySelectorAll("button:not(:disabled),input,select,a[href]"),
    ];
    const first = elements[0],
      last = elements.at(-1);
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
    return;
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
    event.preventDefault();
    document.querySelector("#global-search")?.focus();
    return;
  }
  if (/INPUT|TEXTAREA|SELECT/.test(event.target.tagName) || dialog) return;
  if (features.shortcut(event)) return;
  if (event.key === "Enter" && event.target.dataset.track) {
    event.preventDefault();
    playTrack(event.target.dataset.track).catch(handleError);
    return;
  }
  if (event.code === "Space" && event.target.tagName !== "BUTTON") {
    event.preventDefault();
    togglePlay().catch(handleError);
  }
  if (event.key.toLowerCase() === "m") doAction("mute").catch(handleError);
  if (event.altKey && event.shiftKey && event.key.toLowerCase() === "q")
    doAction("queue").catch(handleError);
  if ((event.ctrlKey || event.metaKey) && event.key === "ArrowRight") {
    event.preventDefault();
    advance().catch(handleError);
  }
  if ((event.ctrlKey || event.metaKey) && event.key === "ArrowLeft") {
    event.preventDefault();
    advance(true).catch(handleError);
  }
});
let dragId, dragIndex;
document.addEventListener("dragstart", (event) => {
  const row = event.target.closest("[data-track]");
  if (row && !isSpotify()) {
    dragId = row.dataset.track;
    dragIndex = Number(row.dataset.index);
    event.dataTransfer.setData("text/plain", dragId);
  }
});
document.addEventListener("dragover", (event) => {
  if (
    !isSpotify() &&
    (event.target.closest("[data-drop-playlist]") ||
      event.target.closest("[data-track]"))
  ) {
    event.preventDefault();
  }
});
document.addEventListener("drop", (event) => {
  const p = event.target.closest("[data-drop-playlist]");
  const row = event.target.closest("[data-track]");
  if (!dragId || isSpotify()) return;
  event.preventDefault();
  if (p) {
    addToPlaylist(p.dataset.dropPlaylist, dragId).catch(handleError);
  } else if (row && route.type === "playlist") {
    const p = library.playlists.find((p) => p.id === route.id);
    const to = Number(row.dataset.index);
    p.track_ids.splice(dragIndex, 1);
    p.track_ids.splice(to, 0, dragId);
    save().then(renderContent).catch(handleError);
  }
  dragId = null;
});
audio.addEventListener("play", () => {
  if (isSpotify()) return;
  playing = true;
  renderPlayer();
});
audio.addEventListener("pause", () => {
  if (isSpotify()) return;
  playing = false;
  renderPlayer();
});
audio.addEventListener("loadedmetadata", () => {
  if (isSpotify()) return;
  duration = audio.duration;
  if (current) {
    current.duration = duration;
    const t = library.tracks.find((t) => t.id === current.id);
    if (t) t.duration = duration;
    save().catch(handleError);
  }
  updateTime();
});
audio.addEventListener("timeupdate", () => {
  if (isSpotify()) return;
  elapsed = audio.currentTime;
  updateTime();
});
audio.addEventListener("ended", () => {
  if (!isSpotify()) advance(false, true).catch(handleError);
});
audio.addEventListener("error", () => {
  if (!isSpotify() && current) {
    playing = false;
    renderPlayer();
    toast(
      "This file could not be decoded. Try importing a supported audio format.",
      true,
    );
  }
});
const poll = setInterval(() => {
  if (
    isSpotify() &&
    connected() &&
    !document.hidden &&
    !document.querySelector(".modal")
  )
    refreshState();
}, 5000);
const tick = setInterval(() => {
  if (isSpotify() && playing) {
    elapsed = Math.min(duration, elapsed + 1);
    updateTime();
  }
}, 1000);
window.addEventListener("beforeunload", () => {
  clearInterval(poll);
  clearInterval(tick);
  audio.pause();
});
async function restoreSavedLogin() {
  const restoreGeneration = generation;
  const profile = await spotify.restore();
  if (profile && restoreGeneration === generation) {
    remote.profile = profile;
    const results = await Promise.allSettled([
      fetchPlaylists(),
      fetchLiked(),
      fetchAlbums(),
      refreshState(false),
    ]);
    for (const result of results)
      if (result.status === "rejected" && !result.reason?.stale)
        toast(result.reason, true);
    renderAll();
  }
}
window.addEventListener("online", () => {
  if (library && !connected()) restoreSavedLogin().catch(handleError);
});
try {
  library = await loadLibrary();
  shell();
  // Session restoration errors must not replace the independent local library.
  try {
    await restoreSavedLogin();
  } catch (error) {
    handleError(error);
  }
} catch (error) {
  root.innerHTML = `<div class="empty-state"><h1>Your library could not be opened</h1><p>${h(error?.message || error)}</p><p>Your saved files have been preserved.</p><button class="white-button" onclick="location.reload()">Retry</button></div>`;
}
