#!/usr/bin/env node
/**
 * build_catalog.mjs — one-time (re-runnable) generator for data/catalog.json
 *
 * Sources (in scripts/source/):
 *   pcloud_tracks.js   — old site track list: { display, folder, file, year, yt }
 *   pcloud_direct.js   — map of lowercase mp3 filename -> pCloud public share link
 *   yt_tracklists.tsv  — ytVideoId <TAB> "Artist - Song" <TAB> ... (parsed from YouTube
 *                        Data API v3 video descriptions, videos.list part=snippet)
 *
 * sourceSongs priority per the project brief:
 *   1. YouTube description tracklist (best data — full artist/title pairs)
 *   2. Confident filename parse: "Artist A vs. Artist B - Title" gives artists
 *      (titles unknown -> empty string, flagged needsMetadata)
 *   3. Album-context inference for known album folders (artist-only, flagged)
 *   4. Nothing -> punch-list (data/punchlist.json) for manual editing in editor.html
 *
 * pCloud playback note: publicLink values are share-page links. At play time the
 * client resolves them to a temporary direct URL via pCloud's public API:
 *   GET https://api.pcloud.com/getpublinkdownload?code=<code>
 * (unauthenticated; works with just the link code). Direct URLs expire after some
 * hours, so resolution happens per-play in js/pcloud.js, never baked into this file.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const src = (f) => readFileSync(join(here, 'source', f), 'utf8');

const loadConst = (code, name) => {
  const fn = new Function(`${code}; return ${name};`);
  return fn();
};
const tracks = loadConst(src('pcloud_tracks.js'), 'PCLOUD_TRACKS');
const direct = loadConst(src('pcloud_direct.js'), 'PCLOUD_DIRECT');

const ytSongs = new Map();
for (const line of src('yt_tracklists.tsv').split('\n')) {
  if (!line.trim()) continue;
  const [id, ...pairs] = line.split('\t');
  ytSongs.set(id, pairs.map((p) => {
    const m = p.match(/^(.*?)\s+-\s+(.*)$/);
    return m ? { title: m[2].trim(), artist: m[1].trim() } : { title: p.trim(), artist: '' };
  }));
}

const slugify = (s) => s.toLowerCase()
  .replace(/['’]/g, '')
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '');

const ALBUM_CONTEXT = {
  'Mash The Fatale Up': ['Britney Spears'],
  'Mash The Fatale Up 2': ['Britney Spears'],
  'K-12 Mashup Album': ['Melanie Martinez'],
  '1989-Night Visions Mashup Album': ['Taylor Swift', 'Imagine Dragons'],
};

const splitVs = (s) => s.split(/\s+vs\.?\s+/i).map((a) => a.trim()).filter(Boolean);

function parseFilename(display) {
  const m = display.match(/^(.+?\s+vs\.?\s+.+?)\s+-\s+(.+)$/i);
  if (!m) return null;
  const artists = splitVs(m[1]);
  if (artists.length < 2) return null;
  if (artists.some((a) => a.length > 60)) return null;
  return artists.map((artist) => ({ title: '', artist }));
}

function parseAlbumContext(display, folder) {
  const base = ALBUM_CONTEXT[folder];
  if (!base) return null;
  const m = display.match(/\(vs\.?\s+([^)]+)\)/i);
  const others = m ? splitVs(m[1]) : [];
  const artists = [...base, ...others];
  if (!artists.length) return null;
  return artists.map((artist) => ({ title: '', artist }));
}

// fuzzy link lookup: exact -> "name_1.mp3" duplicate suffix -> normalized key
const normKey = (s) => s.toLowerCase()
  .replace(/\.mp3$/, '')
  .replace(/^\d+\s*-\s*/, '')        // "10 - " album track prefixes
  .replace(/\(reversed\)/g, '')
  .replace(/\$/g, 's')                 // ke$ha -> kesha
  .replace(/[^a-z0-9]+/g, '');
const titleKey = (s) => {
  const base = s.toLowerCase().replace(/\.mp3$/, '').replace(/\(reversed\)/g, '');
  const i = base.lastIndexOf(' - ');
  return i > 0 ? base.slice(i + 3).replace(/[^a-z0-9]+/g, '') : null;
};
const directNorm = new Map(), directTitle = new Map();
for (const k of Object.keys(direct)) {
  const nk = normKey(k.replace(/_\d+(?=\.mp3$)/, ''));
  if (!directNorm.has(nk)) directNorm.set(nk, direct[k]);
  const tk = titleKey(k);
  if (tk && !directTitle.has(tk)) directTitle.set(tk, direct[k]);
}
const LINK_OVERRIDES = {   // one-off filename typos between the two old data files
  "this is how don't.mp3": "this is how we don't.mp3",
  "shut up minimix (bep, kesha, pink, adele, charlie puth).mp3":
    "shut up minimix (bep, kesha, pink, adele, charlie puth) - [bringmethemashup].mp3.mp3",
};
function findLink(file) {
  const lc = LINK_OVERRIDES[file.toLowerCase()] || file.toLowerCase();
  return direct[lc]
    || direct[lc.replace(/\.mp3$/, '_1.mp3')]
    || directNorm.get(normKey(lc))
    || directTitle.get(normKey(lc))          // bare title vs "artist - title" keys
    || (titleKey(lc) ? directNorm.get(titleKey(lc)) || directTitle.get(titleKey(lc)) : null)
    || null;
}

// --- build
const seen = new Map();
const catalog = [];
const punchlist = [];
let missingAudio = 0, fromYt = 0, fromFilename = 0, fromAlbum = 0, empty = 0;

for (const t of tracks) {
  let id = slugify(`${t.folder} ${t.display}`);
  if (seen.has(id)) { const n = seen.get(id) + 1; seen.set(id, n); id = `${id}-${n}`; }
  else seen.set(id, 1);

  const publicLink = findLink(t.file);
  if (!publicLink) missingAudio++;

  let sourceSongs = null, songSource = null;
  if (t.yt && ytSongs.has(t.yt)) { sourceSongs = ytSongs.get(t.yt); songSource = 'youtube-description'; fromYt++; }
  if (!sourceSongs) { sourceSongs = parseFilename(t.display); if (sourceSongs) { songSource = 'filename'; fromFilename++; } }
  if (!sourceSongs) { sourceSongs = parseAlbumContext(t.display, t.folder); if (sourceSongs) { songSource = 'album-context'; fromAlbum++; } }
  if (!sourceSongs) { sourceSongs = []; empty++; }

  const needsMetadata = songSource !== 'youtube-description';
  const entry = {
    id,
    mashupArtist: 'Bring Me The Mashup',
    sourceSongs,
    displayTitle: t.display,
    isOwnUpload: true,
    ...(publicLink ? { audio: { type: 'pcloud', publicLink } } : {}),
    ...(t.yt ? { video: { type: 'youtube', sourceId: t.yt } } : {}),
    tags: [t.folder, ...(t.year !== '0000' ? [t.year] : [])],
    year: t.year !== '0000' ? t.year : null,
    dateAdded: t.year !== '0000' ? `${t.year}-01-01` : null,
    meta: { songSource, needsMetadata, file: t.file, folder: t.folder },
  };
  catalog.push(entry);
  if (!sourceSongs.length || needsMetadata) {
    punchlist.push({ id, displayTitle: t.display, folder: t.folder, songSource });
  }
}

mkdirSync(join(here, '..', 'data'), { recursive: true });
writeFileSync(join(here, '..', 'data', 'catalog.json'), JSON.stringify(catalog, null, 1));
writeFileSync(join(here, '..', 'data', 'punchlist.json'), JSON.stringify(punchlist, null, 1));

console.log(`tracks: ${catalog.length}`);
console.log(`sourceSongs from YouTube descriptions: ${fromYt}`);
console.log(`sourceSongs from filename parse:       ${fromFilename}`);
console.log(`sourceSongs from album context:        ${fromAlbum}`);
console.log(`no song data (punch-list):             ${empty}`);
console.log(`missing pCloud link:                   ${missingAudio}`);
console.log(`punch-list total (incl. partial):      ${punchlist.length}`);
