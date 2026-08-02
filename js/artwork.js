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

// v3. v1 took the first search hit and so pinned the wrong person on ~1 in 4
// artists (JADE -> "Jäde", Adele -> "Adèle & Robin"). v2 fixed the matching but
// clearing v1 caused every lookup to fire at once, and the resulting quota
// errors were saved as "no photo" — leaving album covers frozen in for 30 days.
// v3 has the throttle and the answered/unanswered split below, so a cold start
// is safe. Bumping the key also discards v2's poisoned entries.
const KEY = 'bmtm.art.v3';
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

/* ---------------- Deezer request throttle ----------------
   Deezer's public API allows roughly 50 requests per 5 seconds per IP. A cold
   Home screen wants a lookup for every artist on every visible card — a few
   hundred at once. Firing them unthrottled makes about a THIRD come back as a
   quota error or time out, and the old code read that silence as "this artist
   has no photo", quietly downgrading them to an iTunes album cover and then
   caching that mistake for 30 days. So: cap how many calls are in flight and
   space out their starts, keeping us comfortably under the quota. */
const MAX_INFLIGHT = 5;
const MIN_GAP_MS = 130;      // ~7.7 requests/sec, quota is ~10/sec
let inflight = 0, lastStart = 0, timer = null;
const queue = [];

/* Exactly ONE pending wake-up at a time, and the wake-up always schedules the
   next one. An earlier version scheduled a timer per queued item; they all came
   due together, only the first few found a free slot and the rest returned
   without rescheduling. Losing enough of those wake-ups left work sitting in
   the queue with nothing left to start it, and the whole thing stalled. */
function pump() {
  if (timer || !queue.length || inflight >= MAX_INFLIGHT) return;
  const wait = Math.max(0, lastStart + MIN_GAP_MS - Date.now());
  timer = setTimeout(() => {
    timer = null;
    if (queue.length && inflight < MAX_INFLIGHT) {
      lastStart = Date.now();
      inflight++;
      queue.shift()();
    }
    pump();                       // keep the loop alive while work remains
  }, wait);
}
/* Run fn() once a slot is free. Every settled call frees its slot and pumps,
   so a full pipeline is always restarted by the next completion. */
function throttled(fn) {
  return new Promise((resolve) => {
    queue.push(() => resolve(fn().finally(() => { inflight--; pump(); })));
    pump();
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* Ask Deezer for a page of artists.
   -> array  when Deezer actually answered (possibly an empty array)
   -> null   when we never got through (quota error / timeout / network).
   Keeping those two cases apart is the whole point: "Deezer says there is no
   such artist" is worth remembering, "we couldn't reach Deezer" is not. */
async function deezerSearch(name, tries = 3) {
  const url = `https://api.deezer.com/search/artist?q=${encodeURIComponent(name)}&limit=10&output=jsonp&callback={cb}`;
  for (let i = 0; i < tries; i++) {
    const d = await throttled(() => jsonp(url).catch(() => null));
    if (d && !d.error && Array.isArray(d.data)) return d.data;
    await sleep(500 * (i + 1) + Math.random() * 400);   // back off, then retry
  }
  return null;
}

/* Deezer's own ranking is not name-first: searching "JADE" put the French
   rapper "Jäde" ahead of JADE, and "Adele" put "Adèle & Robin" first. So pull
   a page of results and pick the best NAME match, breaking ties on follower
   count (which reliably separates the real artist from copycat/duplicate
   pages). Only if nothing matches by name — usually a typo in the catalog
   ("Imagine Dragon") or a combined "X ft. Y" credit — do we fall back to the
   top hit, which is all the old code ever did.
   Returns { answered, url }. */
async function fromDeezer(name) {
  const data = await deezerSearch(name);
  if (!data) return { answered: false, url: null };
  const list = data.filter(deezerPic);
  if (!list.length) return { answered: true, url: null };
  const matches = list.map((a) => ({ a, s: nameScore(name, a.name) })).filter((x) => x.s > 0);
  matches.sort((x, y) => y.s - x.s || (y.a.nb_fan || 0) - (x.a.nb_fan || 0));
  return { answered: true, url: deezerPic(matches.length ? matches[0].a : list[0]) };
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

/* A cache entry keeps the two sources apart: `d` = Deezer artist photo,
   `i` = iTunes album cover, either of which may be null meaning "asked, there
   is nothing". A field that is ABSENT means "not asked yet / never got a real
   answer" — so a quota blip is retried on the next visit instead of being
   frozen in as a fact. */
const live = (k) => { const c = cache[k]; return c && c.e > Date.now() ? c : null; };
function record(k, field, url) {
  const c = live(k) || {};
  cache[k] = { ...c, [field]: url, e: Date.now() + (url ? HIT_MS : MISS_MS) };
  persist();
}

/** The artist's own photo, or null. Never falls back to an album cover. */
export async function artistPhoto(name) {
  const k = norm(name);
  if (!k) return null;
  if (OVERRIDES[k]) return OVERRIDES[k];
  const c = live(k);
  if (c && 'd' in c) return c.d;
  const r = await fromDeezer(name);
  if (!r.answered) return null;          // couldn't reach Deezer — don't remember this
  record(k, 'd', r.url);
  return r.url;
}

/** Album cover for the artist, or null. Last resort — it is not their photo. */
async function albumCover(name) {
  const k = norm(name);
  if (!k) return null;
  const c = live(k);
  if (c && 'i' in c) return c.i;
  let url = null;
  try { url = await fromITunes(name); } catch { return null; }   // transient — don't remember
  record(k, 'i', url);
  return url;
}

/** One artist name -> image URL (or null). Photo first, cover as a fallback. */
export async function artistImage(name) {
  return (await artistPhoto(name)) || (await albumCover(name));
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

/** All available images for a track's artists (parallel, order kept). The
    player background is a montage of FACES, so album covers are not mixed in
    unless not one artist on the track has a photo. */
export async function collageFor(track) {
  const names = artistsOf(track);
  if (!names.length) return [];
  const photos = (await Promise.all(names.map((n) => artistPhoto(n)))).filter(Boolean);
  if (photos.length) return photos;
  const covers = await Promise.all(names.map((n) => artistImage(n)));
  return covers.filter(Boolean);
}

/** First available image — used for the card art, mini-player thumb and lock
    screen. Two passes on purpose: a photo of ANY artist on the track beats an
    album cover for the first one, because a cover in a row of faces reads as
    the wrong picture. */
export async function firstArtFor(track) {
  const names = artistsOf(track);
  for (const n of names) {
    const u = await artistPhoto(n);
    if (u) return u;
  }
  for (const n of names) {
    const u = await artistImage(n);
    if (u) return u;
  }
  return null;
}
