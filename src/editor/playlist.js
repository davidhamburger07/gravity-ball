// playlist.js — an ordered, editable list of levels used to rehearse progression.
//
// It starts empty: you add your own levels from the editor, reorder them, then play the whole
// list back-to-back so the pacing (and difficulty curve) can be judged the way a player meets it.
// Stored in localStorage so it survives the editor → game → editor round trip.

const KEY = 'gravityball:playlist';

/** @returns {object[]} the stored levels, or [] if nothing valid is saved. */
export function loadPlaylist() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY));
    return Array.isArray(raw) ? raw.filter((l) => l && l.spawn && l.goal) : [];
  } catch {
    return [];
  }
}

export function savePlaylist(list) {
  try { localStorage.setItem(KEY, JSON.stringify(list)); } catch { /* quota — nothing to do */ }
  return list;
}

/** Append a level. Levels are deep-copied so later editing doesn't mutate the saved entry. */
export function addToPlaylist(level) {
  const list = loadPlaylist();
  list.push(JSON.parse(JSON.stringify(level)));
  return savePlaylist(list);
}

export function removeAt(index) {
  const list = loadPlaylist();
  if (index >= 0 && index < list.length) list.splice(index, 1);
  return savePlaylist(list);
}

/** Move an entry by `delta` slots, clamped to the ends. Returns the new index. */
export function moveEntry(index, delta) {
  const list = loadPlaylist();
  const to = index + delta;
  if (index < 0 || index >= list.length || to < 0 || to >= list.length) return index;
  const [item] = list.splice(index, 1);
  list.splice(to, 0, item);
  savePlaylist(list);
  return to;
}

/** Replace the level at `index` (used when re-saving one you just edited). */
export function replaceAt(index, level) {
  const list = loadPlaylist();
  if (index >= 0 && index < list.length) list[index] = JSON.parse(JSON.stringify(level));
  return savePlaylist(list);
}

export function clearPlaylist() {
  return savePlaylist([]);
}

export { KEY as PLAYLIST_KEY };
