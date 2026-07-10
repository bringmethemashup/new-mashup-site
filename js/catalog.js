/**
 * catalog.js — load catalog.json, provide search, browse albums + the Mashup Explorer
 * co-occurrence index (computed ONCE at load, per the project brief).
 */
let tracks = [];
const byId = new Map();

// Explorer graph: node = artist or song. key: "a:normname" | "s:normname"
const nodes = new Map(); // key -> { key, kind:'artist'|'song', name, trackIds:Set }
const edges = new Map(); // key -> Map(otherKey -> Set(trackId))

export const norm = (s) => (s || '').toLowerCase().normalize('NFKD')
  .replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();

/** "Artist A; Artist B" -> ["Artist A","Artist B"]. Semicolon ONLY — commas
    appear inside real artist names (Tyler, The Creator), so never split on them. */
export const splitArtists = (s) => (s || '').split(';').map((p) => p.trim()).filter(Boolean);

function nodeKeysForTrack(t) {
  const keys = new Set();
  for (const s of t.sourceSongs || []) {
    for (const a of splitArtists(s.artist)) keys.add('a:' + norm(a));
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
  // Backend (Supabase) is the single source of truth when configured;
  // catalog.json remains the offline/no-backend fallback.
  let list = null;
  try {
    const backend = await import('./backend.js');
    if (backend.enabled()) {
      await backend.init();
      list = await backend.fetchTracks();
    }
  } catch (e) {
    console.warn('Backend unavailable, falling back to catalog.json', e);
  }
  if (!list || !list.length) {
    const res = await fetch(url);
    list = await res.json();
  }
  tracks = list;
  reindex();
  return tracks;
}

function reindex() {
  byId.clear(); nodes.clear(); edges.clear();

  for (const t of tracks) {
    byId.set(t.id, t);
    t._search = norm([
      t.displayTitle, t.mashupArtist,
      ...(t.sourceSongs || []).flatMap((s) => [s.title, s.artist]),
      ...(t.tags || []),
    ].join(' '));

    // build nodes
    for (const s of t.sourceSongs || []) {
      for (const a of splitArtists(s.artist)) addNode('a:' + norm(a), 'artist', a, t.id);
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

/** Explorer: the artist/song nodes appearing in one track (for "inside this mashup"). */
export function nodesOfTrack(trackId) {
  const t = byId.get(trackId);
  if (!t) return [];
  return [...nodeKeysForTrack(t)].map((k) => nodes.get(k)).filter(Boolean);
}

/** All nodes of one kind ('artist' | 'song') — for the Home browse indexes. */
export function nodesByKind(kind) {
  return [...nodes.values()].filter((n) => n.kind === kind);
}

/** Distinct mashup artists with their tracks — for the Home browse index.
    Collaborations use ";" in mashupArtist ("A; B") — the track is listed
    under EACH collaborator. */
export function mashupArtists() {
  const m = new Map();
  for (const t of tracks) {
    for (const name of splitArtists(t.mashupArtist)) {
      const k = norm(name);
      if (!m.has(k)) m.set(k, { key: 'ma:' + k, name, tracks: [] });
      m.get(k).tracks.push(t);
    }
  }
  return [...m.values()];
}

/* ---------------- browse: albums derived from catalog fields -------------
   Auto-generated — one album per distinct `year`, one per distinct
   `specialAlbum`. No manual lists to maintain. */
export function albumsByYear() {
  const m = new Map();
  for (const t of tracks) {
    const y = String(t.year || '').trim();
    if (!y) continue;
    if (!m.has(y)) m.set(y, []);
    m.get(y).push(t);
  }
  return [...m.entries()]
    .map(([year, list]) => ({ key: 'y:' + year, name: year, tracks: list }))
    .sort((a, b) => b.name.localeCompare(a.name, undefined, { numeric: true }));
}

export function specialAlbums() {
  // "; " separates collections (same rule as artists) — a track can belong
  // to several, and it's listed under EACH one.
  const m = new Map();
  for (const t of tracks) {
    for (const name of splitArtists(t.specialAlbum)) {
      const k = norm(name);
      if (!m.has(k)) m.set(k, { key: 'sp:' + k, name, tracks: [] });
      m.get(k).tracks.push(t);
    }
  }
  return [...m.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/* ---------------- recommendations: REUSES the Explorer index -------------
   Tracks related to a seed track = every track sharing an artist/song node
   with it, scored by how many nodes they share. Reads the `nodes` map built
   once at load — no separate recommendation structure. */
export function relatedTo(trackId, limit = 12) {
  const t = byId.get(trackId);
  if (!t) return [];
  const scores = new Map();
  for (const key of nodeKeysForTrack(t)) {
    const n = nodes.get(key);
    if (!n) continue;
    for (const id of n.trackIds) {
      if (id === trackId) continue;
      scores.set(id, (scores.get(id) || 0) + 1);
    }
  }
  return [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([id, score]) => ({ track: byId.get(id), score }));
}
