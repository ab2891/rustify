// Follow every page before generating an order. Never silently truncate a shuffle.
export async function allCollectionTracks(context, request) {
  let album = null;
  if (context.type === "album")
    album = await request("GET", `/albums/${encodeURIComponent(context.id)}`);
  const tracks = [],
    seen = new Set();
  let offset = 0,
    unavailable = 0,
    duplicates = 0;
  for (;;) {
    const path =
      context.type === "playlist"
        ? `/playlists/${encodeURIComponent(context.id)}/items`
        : context.type === "album"
          ? `/albums/${encodeURIComponent(context.id)}/tracks`
          : "/me/tracks";
    const data = await request("GET", `${path}?limit=50&offset=${offset}`);
    const items = data.items || [];
    for (const entry of items) {
      const track =
        context.type === "playlist"
          ? entry.item
          : context.type === "album"
            ? { ...entry, album }
            : entry.track;
      if (
        !track?.id ||
        !track.uri ||
        (track.type && track.type !== "track") ||
        track.is_playable === false ||
        track.is_local
      ) {
        unavailable++;
        continue;
      }
      if (seen.has(track.uri)) {
        duplicates++;
        continue;
      }
      seen.add(track.uri);
      tracks.push(track);
    }
    if (!data.next) break;
    if (!items.length)
      throw new Error(
        "Spotify pagination stopped before the collection was complete. Try again.",
      );
    offset += items.length;
    if (offset > 100000)
      throw new Error("This collection is too large to load safely.");
  }
  return { tracks, unavailable, duplicates };
}
