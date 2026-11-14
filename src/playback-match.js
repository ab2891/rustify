// Spotify may play a market-specific track ID and omit linked_from in Player responses.
// Accept an alias only when Spotify's recording identifier (ISRC) proves equivalence.
export async function sameRecording(expected,actual,resolve){
  if(!expected||!actual)return false;
  const expectedURI=expected.uri,actualURI=actual.linked_from?.uri||actual.uri;
  if(expectedURI&&expectedURI===actualURI)return true;
  const left=expected.isrc||expected.external_ids?.isrc||(await resolve(expected.id))?.external_ids?.isrc;
  if(!left)return false;
  const right=actual.isrc||actual.external_ids?.isrc||(await resolve(actual.id))?.external_ids?.isrc;
  return Boolean(right)&&left.toUpperCase()===right.toUpperCase();
}
