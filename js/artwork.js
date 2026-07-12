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

const KEY = 'bmtm.art.v1';
let cache = {};
try { cache = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch { cache = {}; }
const persist = () => { try { localStorage.setItem(KEY, JSON.stringify(cache)); } catch {} };

const norm = (s) => (s || '').toLowerCase().normalize('NFKD')
  .replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();

const HIT_MS = 30 * 864e5;   // cache successful lookups 30 days
const MISS_MS = 7 * 864e5;   // retry failed lookups after 7 days

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

async function fromDeezer(name) {
  const d = await jsonp(`https://api.deezer.com/search/artist?q=${encodeURIComponent(name)}&limit=1&output=jsonp&callback={cb}`);
  const a = d?.data?.[0];
  return a?.picture_xl || a?.picture_big || null;
}

async function fromITunes(name) {
  const d = await jsonp(`https://itunes.apple.com/search?term=${encodeURIComponent(name)}&entity=album&limit=1&callback={cb}`);
  const r = d?.results?.[0];
  return r?.artworkUrl100 ? r.artworkUrl100.replace('100x100', '600x600') : null;
}

/** One artist name -> image URL (or null). Cached. */
export async function artistImage(name) {
  const k = norm(name);
  if (!k) return null;
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
