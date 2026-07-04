/**
 * ytmeta.js — read a YouTube video's title + description and guess the
 * source songs from it, so the track form can autofill artist/title rows.
 *
 * This is the live, in-browser version of what scripts/build_catalog.mjs did
 * offline from yt_tracklists.tsv: most mashup artists list their sources in the
 * description as "Artist - Song" lines, and vs-style titles name the artists.
 *
 * The API key lives in js/config.js (YT_API_KEY). It is a *public* key, so it
 * must be locked to your domain with an HTTP-referrer restriction in Google
 * Cloud. Empty key = the Autofill button just no-ops with a friendly message.
 */
import { YT_API_KEY } from './config.js';

/** Whether autofill is even possible (a key is configured). */
export const ytEnabled = () => !!(YT_API_KEY && YT_API_KEY.trim());

/**
 * Fetch { title, description, channelTitle } for a video id.
 * Throws an Error with a user-readable message on any failure.
 */
export async function fetchVideoMeta(videoId) {
  if (!ytEnabled()) throw new Error('YouTube autofill is not set up yet (no API key in config.js).');
  if (!videoId) throw new Error('No YouTube video id.');
  const url = `https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${encodeURIComponent(videoId)}&key=${encodeURIComponent(YT_API_KEY.trim())}`;
  let res;
  try {
    res = await fetch(url);
  } catch {
    throw new Error('Could not reach YouTube. Check your connection.');
  }
  if (!res.ok) {
    if (res.status === 403) throw new Error('YouTube rejected the key (check the API key + its domain restriction / quota).');
    throw new Error(`YouTube API error (${res.status}).`);
  }
  const data = await res.json().catch(() => null);
  const snip = data?.items?.[0]?.snippet;
  if (!snip) throw new Error('No such video, or it is private/unavailable.');
  return { title: snip.title || '', description: snip.description || '', channelTitle: snip.channelTitle || '' };
}

// ---- parsing helpers ---------------------------------------------------

const DASH = '[-‐‑‒–—―~|]'; // hyphen, dashes, tilde, pipe
const clean = (s) => (s || '')
  .replace(/\s+/g, ' ')
  .replace(/^["'“”‘’(\[]+/, '')
  .replace(/["'“”‘’)\]]+$/, '')
  .trim();

const looksLikeName = (s) => s && s.length <= 80 && !/https?:\/\//i.test(s);

/** Split an "artists" chunk like "A vs B x C & D" into individual artists. */
export function splitArtists(chunk) {
  return (chunk || '')
    .split(/\s+(?:vs\.?|x|×|&|,|feat\.?|ft\.?|\+)\s+/i)
    .map(clean)
    .filter((a) => a && looksLikeName(a));
}

/** Parse one description line into {artist,title} or null. */
export function parseSongLine(raw) {
  let line = clean(raw);
  if (!line) return null;
  // drop a leading list number: "1." "12)" "1 -"
  line = line.replace(/^\d{1,3}[.)]\s*/, '');
  // drop a leading timestamp: "0:00", "1:02:33", optionally followed by a dash
  line = line.replace(new RegExp(`^\\d{1,2}:\\d{2}(?::\\d{2})?\\s*${DASH}?\\s*`), '');
  line = clean(line);
  if (!line || line.length > 120) return null;
  // skip obvious non-song / promo lines (either as a leading label or anywhere in the line)
  if (/^(track\s?list|tracklist|songs?\s+used|sources?|credits?|follow|subscribe|instagram|tiktok|spotify|download|buy|listen|stream|watch|check\s+out|new\s+video|©|all rights)/i.test(line)) return null;
  if (/\b(subscribe|instagram|tiktok|spotify|soundcloud|patreon|link\s+(below|in\s+bio)|all\s+rights\s+reserved|my\s+channel)\b/i.test(line)) return null;
  const m = line.match(new RegExp(`^(.*?)\\s+${DASH}\\s+(.*)$`));
  if (!m) return null;
  const artist = clean(m[1]);
  const title = clean(m[2]);
  if (!looksLikeName(artist) || !looksLikeName(title) || !artist || !title) return null;
  // reject "artist" chunks that are really a sentence
  if (artist.split(' ').length > 8 || title.split(' ').length > 12) return null;
  return { artist, title };
}

/**
 * Best-effort list of source songs from a video's snippet.
 * Priority: "Artist - Song" lines in the description; fall back to the
 * artists named in a "A vs B - ..." title (titles left blank for review).
 * Returns a de-duplicated array of { artist, title }.
 */
export function parseSourceSongs({ title = '', description = '' } = {}) {
  const out = [];
  const seen = new Set();
  const push = (s) => {
    const key = (s.artist + '|' + s.title).toLowerCase();
    if (!seen.has(key)) { seen.add(key); out.push(s); }
  };

  for (const rawLine of String(description).split(/\r?\n/)) {
    const song = parseSongLine(rawLine);
    if (song) push(song);
    if (out.length >= 20) break;
  }

  // Fall back to the title's "A vs B - name" artists if the description gave nothing.
  if (!out.length) {
    const t = clean(title);
    const before = t.split(new RegExp(`\\s+${DASH}\\s+`))[0] || t;
    for (const artist of splitArtists(before)) push({ artist, title: '' });
  }
  return out;
}
