/**
 * catalog.js — load catalog.json, provide search + the Mashup Explorer
 * co-occurrence index (computed ONCE at load, per the project brief).
 */
let tracks = [];
const byId = new Map();

// Explorer graph: node = artist or song. key: "a:normname" | "s:normname"
const nodes = new Map(); // key -> { key, kind:'artist'|'song', name, trackIds:Set }
const edges = new Map(); // key -> Map(otherKey -> Set(trackId))

export const norm = (s) => (s || '').toLowerCase().normalize('NFKD')
  .replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();

function nodeKeysForTrack(t) {
  const keys = new Set();
  for (const s of t.sourceSongs || []) {
    if (s.artist) keys.add('a:' + norm(s.artist));
    if (s.title) keys.add('s:' + norm(s.title) + '' + norm(s.artist));
  }
  return keys;
}

function addNode(key, kind, name, trackId) {
  let n = nodes.get(key);
  if (!n) { n = { key, kind, name, trackIds: new Set() }; nodes.set(key, n); }
  n.trackIds.add(trackId);
  return n;
}

export async function loadCatalog(url = 'data/catalog.json') {
  const res = await fetch(url);
  tracks = await res.json();

  for (const t of tracks) {
    byId.set(t.id, t);
    t._search = norm([
      t.displayTitle, t.mashupArtist,
      ...(t.sourceSongs || []).flatMap((s) => [s.title, s.artist]),
      ...(t.tags || []),
    ].join(' '));

    // build nodes
    for (const s of t.sourceSongs || []) {
      if (s.artist) addNode('a:' + norm(s.artist), 'artist', s.artist, t.id);
      if (s.title) addNode('s:' + norm(s.title) + '' + norm(s.artist), 'song',
        s.title + (s.artist ? ` — ${s.artist}` : ''), t.id);
    }
    // build edges between every pair of nodes co-occurring in this track
    const keys = [...nodeKeysForTrack(t)];
    for (let i = 0; i < keys.length; i++) {
      for (let j = 0; j < keys.length; j++) {
        if (i === j) continue;
        let m = edges.get(keys[i]);
        if (!m) { m = new Map(); edges.set(keys[i], m); }
        let set = m.get(keys[j]);
        if (!set) { set = new Set(); m.set(keys[j], set); }
        set.add(t.id);
      }
    }
  }
  return tracks;
}

export const all = () => tracks;
export const get = (id) => byId.get(id);

export function search(q) {
  const nq = norm(q);
  if (!nq) return tracks;
  const terms = nq.split(' ');
  return tracks.filter((t) => terms.every((term) => t._search.includes(term)));
}

/** Explorer: find nodes matching a query (for the explorer search box). */
export function searchNodes(q, limit = 12) {
  const nq = norm(q);
  if (nq.length < 2) return [];
  const out = [];
  for (const n of nodes.values()) {
    if (norm(n.name).includes(nq)) {
      out.push(n);
      if (out.length >= limit * 3) break;
    }
  }
  // artists first, then by how many mashups they appear in
  out.sort((a, b) => (a.kind === b.kind ? b.trackIds.size - a.trackIds.size : a.kind === 'artist' ? -1 : 1));
  return out.slice(0, limit);
}

/** Explorer: connections of a node -> [{ node, viaTrackIds }] sorted by strength. */
export function connectionsOf(key) {
  const m = edges.get(key);
  if (!m) return [];
  const out = [];
  for (const [otherKey, set] of m) {
    const n = nodes.get(otherKey);
    if (n) out.push({ node: n, via: [...set] });
  }
  out.sort((a, b) => b.via.length - a.via.length || a.node.name.localeCompare(b.node.name));
  return out;
}

export const getNode = (key) => nodes.get(key);
