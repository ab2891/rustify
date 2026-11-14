// Real Tauri/WebKit smoke test. Start tauri-driver first (see README).
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir, copyFile, unlink } from "node:fs/promises";
import { resolve, join } from "node:path";
const base = process.env.TAURI_DRIVER_URL || "http://127.0.0.1:4444";
const binary =
  process.env.RUSTIFY_BINARY || resolve("src-tauri/target/debug/spotify-rust");
const media = resolve(
  "../../docs/design/reviews/rustify-2026-11-13/native-playing.png",
);
let session, original, ownedFile;
async function request(path, method = "POST", body) {
  const response = await fetch(base + path, {
    method,
    headers: { "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const result = await response.json();
  if (result.value?.error)
    throw Error(`${result.value.error}: ${result.value.message}`);
  return result.value;
}
const wd = (path, body) => request(`/session/${session}/${path}`, "POST", body);
const exec = (script, args = []) => wd("execute/sync", { script, args });
async function invoke(command, args = {}) {
  const response = await wd("execute/async", {
    script: `const done=arguments[arguments.length-1];window.__TAURI_INTERNALS__.invoke(arguments[0],arguments[1]).then(value=>done({ok:true,value})).catch(error=>done({ok:false,error:String(error)}));`,
    args: [command, args],
  });
  if (!response.ok) throw Error(response.error);
  return response.value;
}
async function wait(script, label) {
  const until = Date.now() + 15000;
  while (Date.now() < until) {
    if (await exec(script)) return;
    await new Promise((r) => setTimeout(r, 150));
  }
  throw Error(`Timed out: ${label}`);
}
async function click(selector) {
  await exec(
    'document.querySelector(arguments[0]).scrollIntoView({block:"center"});return true;',
    [selector],
  );
  await wd("execute/async", {
    script:
      "const done=arguments[arguments.length-1];requestAnimationFrame(()=>requestAnimationFrame(()=>done(true)));",
    args: [],
  });
  const el = await wd("element", { using: "css selector", value: selector });
  await wd(`element/${el["element-6066-11e4-a52e-4f735466cecf"]}/click`, {});
}
try {
  const created = await request("/session", "POST", {
    capabilities: { alwaysMatch: { "tauri:options": { application: binary } } },
  });
  session = created.sessionId;
  await wait(
    'return Boolean(document.querySelector(".app-shell"))',
    "native app rendered",
  );
  assert.equal(await exec("return window.isTauri"), true);
  original = await invoke("get_library");
  assert.equal(original.version, 1);
  // Prove JSON crosses real Rust IPC and writes/reloads without replacing user choices.
  const temporary = structuredClone(original);
  temporary.playlists.push({
    id: "native-smoke-check",
    title: "Native UTF-8 café",
    description: "Temporary native round trip",
    cover: "/art/local.svg",
    track_ids: [],
  });
  await invoke("persist_library", { library: temporary });
  assert.equal(
    (await invoke("get_library")).playlists.at(-1).title,
    "Native UTF-8 café",
  );
  await invoke("persist_library", { library: original });
  console.log("PASS: native library IPC and persisted UTF-8 round trip");
  await exec(
    'localStorage.setItem("rustify-mode","local");location.reload();return true;',
  );
  await wait(
    "return Boolean(document.querySelector('.library-item[data-id=\"late-nights\"]'))",
    "local library",
  );
  await click('.library-item[data-id="late-nights"]');
  await wait(
    "return Boolean(document.querySelector('tr[data-track=\"night-drive\"] .song-title'))",
    "playlist rows",
  );
  await click('tr[data-track="night-drive"] .song-title');
  await wait(
    'const a=document.querySelector("#audio-engine");return a.duration===16&&a.currentTime>.1&&!a.paused',
    "actual WebKit audio decoding and progression",
  );
  const shot = await request(`/session/${session}/screenshot`, "GET");
  await mkdir(resolve(media, ".."), { recursive: true });
  await writeFile(media, Buffer.from(shot, "base64"));
  await click('[data-action="play"].main-play');
  assert.equal(
    await exec('return document.querySelector("#audio-engine").paused'),
    true,
  );
  await exec(
    'const seek=document.querySelector("#seek");seek.value=7;seek.dispatchEvent(new Event("change",{bubbles:true}));return true;',
  );
  await wait(
    'return document.querySelector("#audio-engine").currentTime>=7',
    "native seek",
  );
  await click('[data-action="next"]');
  await wait(
    'return document.querySelector(".current-track strong")?.textContent==="Soft Focus"',
    "native next",
  );
  await wait(
    'return document.querySelector("#audio-engine").currentTime>.1',
    "next audio progression",
  );
  await click('[data-action="play"].main-play');
  console.log("PASS: native bundled audio, pause, seek, next and screenshot");
  // Place a test-owned WAV in managed media and verify the asset-protocol playback path.
  // This exercises import results, not the OS picker itself.
  const dataRoot = await invoke("plugin:path|resolve_directory", {
    directory: 14,
  });
  const ownedDir = join(dataRoot, "media");
  await mkdir(ownedDir, { recursive: true });
  ownedFile = join(ownedDir, "native-smoke-audio.wav");
  await copyFile(resolve("public/audio/night-drive.wav"), ownedFile);
  const assetLibrary = structuredClone(original);
  assetLibrary.tracks.push({
    id: "native-smoke-audio",
    title: "Native owned audio",
    artist: "Rustify test",
    album: "Native verification",
    duration: 16,
    src: ownedFile,
    cover: "/art/local.svg",
    imported: true,
  });
  await invoke("persist_library", { library: assetLibrary });
  await exec("location.reload();return true;");
  await wait(
    'return Boolean(document.querySelector(".app-shell"))',
    "reload with owned media",
  );
  await exec(
    "document.querySelector('[data-route=\"local\"]').click();return true;",
  );
  await wait(
    "return Boolean(document.querySelector('tr[data-track=\"native-smoke-audio\"] .song-title'))",
    "owned audio row",
  );
  await click('tr[data-track="native-smoke-audio"] .song-title');
  await wait(
    'const a=document.querySelector("#audio-engine");return a.duration===16&&a.currentTime>.1&&!a.paused',
    "owned asset audio decoding",
  );
  await click('[data-action="play"].main-play');
  console.log("PASS: managed media asset protocol after app reload");
} finally {
  if (session) {
    try {
      await exec(
        'document.querySelector("#audio-engine")?.pause();return true;',
      );
      if (original) await invoke("persist_library", { library: original });
    } finally {
      await request(`/session/${session}`, "DELETE");
    }
  }
  if (ownedFile) await unlink(ownedFile);
}
