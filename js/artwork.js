/**
 * artwork.js — artist imagery for the player background, mini thumb and
 * media-session (lock screen) art.
 *
 * Sources (no API keys, both work from the browser via JSONP so CORS never
 * applies — and the site-wide no-referrer meta doesn't matter here):
 *   1. Deezer  /search/artist  — real artist PHOTOS (1000px), first choice.
 *   2. iTunes  /search album   — album cover fallback when Deezer has nothing.
 *
 * Lookups are cached in localStorage: hits for 30 days, misses for 7, so each
 * artist is fetched once. Every failure degrades to null — the player simply
 * keeps its classic gradient + visualizer look.
 */

// v2: v1 was filled by a "take the first search hit" lookup that pinned the
// wrong person on ~1 in 4 artists (JADE -> "Jäde", Adele -> "Adèle & Robin").
// Bumping the key throws those saved mistakes away on every device.
const KEY = 'bmtm.art.v2';
let cache = {};
try { cache = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch { cache = {}; }
const persist = () => { try { localStorage.setItem(KEY, JSON.stringify(cache)); } catch {} };

const norm = (s) => (s || '').toLowerCase().normalize('NFKD')
  .replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
const loose = (s) => norm(s).replace(/[^a-z0-9]/g, '');

const HIT_MS = 30 * 864e5;   // cache successful lookups 30 days
const MISS_MS = 7 * 864e5;   // retry failed lookups after 7 days

/* Deezer's placeholder avatar (the grey silhouette) — the path segment is the
   MD5 of an empty string. Treat it as "no photo" so we fall through to iTunes
   or the next artist instead of showing a blank blob on a card. */
const BLANK_ART = 'd41d8cd98f00b204e9800998ecf8427e';

/* Hand-pinned photos for artists search still gets wrong. Keys are matched
   with norm(), so case and accents don't matter: { 'artist name': 'https://…' } */
const OVERRIDES = {};

/* How confident are we that a search result is the artist we asked for?
     3 = identical  2 = identical ignoring accents  1 = identical ignoring
     punctuation/spacing  0 = a different artist. */
function nameScore(want, got) {
  const a = (want || '').toLowerCase().trim();
  const b = (got || '').toLowerCase().trim();
  if (!a || !b) return 0;
  if (a === b) return 3;
  if (norm(a) === norm(b)) return 2;
  if (loose(a) === loose(b)) return 1;
  return 0;
}

const deezerPic = (a) => {
  const u = a?.picture_xl || a?.picture_big || null;
  return u && !u.includes(BLANK_ART) ? u : null;
};

/* ---------------- JSONP (script-tag) fetch ---------------- */
let cbSeq = 0;
function jsonp(urlWithCbToken, timeout = 8000) {
  return new Promise((resolve, reject) => {
    const cb = '__bmtmArt' + (++cbSeq);
    const s = document.createElement('script');
    const t = setTimeout(() => { cleanup(); reject(new Error('jsonp timeout')); }, timeout);
    function cleanup() { clearTimeout(t); try { delete window[cb]; } catch {} s.remove(); }
    window[cb] = (data) => { cleanup(); resolve(data); };
    s.onerror = () => { cleanup(); reject(new Error('jsonp failed')); };
    s.src = urlWithCbToken.replace('{cb}', cb);
    document.head.appendChild(s);
  });
}

/* Deezer's own ranking is not name-first: searching "JADE" put the French
   rapper "Jäde" ahead of JADE, and "Adele" put "Adèle & Robin" first. So pull
   a page of results and pick the best NAME match, breaking ties on follower
   count (which reliably separates the real artist from copycat/duplicate
   pages). Only if nothing matches by name — usually a typo in the catalog
   ("Imagine Dragon") or a combined "X ft. Y" credit — do we fall back to the
   top hit, which is all the old code ever did. */
async function fromDeezer(name) {
  const d = await jsonp(`https://api.deezer.com/search/artist?q=${encodeURIComponent(name)}&limit=10&output=jsonp&callback={cb}`);
  const list = (d?.data || []).filter(deezerPic);
  if (!list.length) return null;
  const matches = list.map((a) => ({ a, s: nameScore(name, a.name) })).filter((x) => x.s > 0);
  matches.sort((x, y) => y.s - x.s || (y.a.nb_fan || 0) - (x.a.nb_fan || 0));
  return deezerPic(matches.length ? matches[0].a : list[0]);
}

/* Album-cover fallback. attribute=artistTerm keeps iTunes from matching the
   name against song/album titles, and we still verify the artist name before
   accepting a cover. */
async function fromITunes(name) {
  const d = await jsonp(`https://itunes.apple.com/search?term=${encodeURIComponent(name)}&entity=album&attribute=artistTerm&limit=10&callback={cb}`);
  const list = d?.results || [];
  const r = list.find((x) => nameScore(name, x.artistName) > 0) || list[0];
  return r?.artworkUrl100 ? r.artworkUrl100.replace('100x100', '600x600') : null;
}

/** One artist name -> image URL (or null). Cached. */
export async function artistImage(name) {
  const k = norm(name);
  if (!k) return null;
  if (OVERRIDES[k]) return OVERRIDES[k];
  const c = cache[k];
  if (c && c.e > Date.now()) return c.u;
  let url = null;
  try { url = await fromDeezer(name); } catch {}
  if (!url) { try { url = await fromITunes(name); } catch {} }
  cache[k] = { u: url, e: Date.now() + (url ? HIT_MS : MISS_MS) };
  persist();
  return url;
}

/** Unique source-song artists of a track, in order (max 14 for the montage —
    big "main" mashups can have 7-8 songs / a dozen+ artists, and we want them
    all to appear in the background rotation).
    Splits multi-artist fields on ";" (never commas — see catalog.js) so
    "Artist A; Artist B" becomes two separate image lookups. */
export function artistsOf(track) {
  const seen = new Set(), out = [];
  for (const s of track?.sourceSongs || []) {
    for (const part of (s.artist || '').split(';')) {
      const name = part.trim();
      const k = norm(name);
      if (!k || seen.has(k)) continue;
      seen.add(k);
      out.push(name);
      if (out.length >= 14) return out;
    }
  }
  return out;
}

/** All available images for a track's artists (parallel, order kept). */
export async function collageFor(track) {
  const names = artistsOf(track);
  if (!names.length) return [];
  const urls = await Promise.all(names.map((n) => artistImage(n)));
  return urls.filter(Boolean);
}

/** First available image — used for the mini-player thumb + lock screen art. */
export async function firstArtFor(track) {
  for (const n of artistsOf(track)) {
    const u = await artistImage(n);
    if (u) return u;
  }
  return null;
}
