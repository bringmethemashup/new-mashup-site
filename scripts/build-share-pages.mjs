/**
 * build-share-pages.mjs — generate one static share page per mashup.
 *
 * Why this exists: the share endpoint used to be the Supabase edge function
 * `share`, which returned per-track Open Graph HTML. Supabase now forces
 * `content-type: text/plain` on HTML responses from functions, so that page
 * stopped redirecting — friends just saw the page source. GitHub Pages serves
 * real HTML, so the share page lives here instead.
 *
 * The card IMAGE is still rendered by the Supabase function (`?t=<id>&img=1`),
 * which is unaffected — it returns image/png.
 *
 * Output: s/<id>.html for every approved mashup. Run via
 * .github/workflows/build-share-pages.yml (schedule + manual dispatch).
 */
import { mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const SITE = 'https://bringmethemashup.github.io/new-mashup-site/';
const IMG = 'https://txkmwsnvtwobhrdrablw.supabase.co/functions/v1/share';
const SB_URL = 'https://txkmwsnvtwobhrdrablw.supabase.co';
// The anon key is public (it already ships in js/config.js), so read it from
// there — no workflow secret needed.
const SB_KEY = process.env.SUPABASE_ANON_KEY
  || (await readFile('js/config.js', 'utf8')
        .then((t) => (t.match(/SUPABASE_ANON_KEY\s*=\s*'([^']+)'/) || [])[1] || '')
        .catch(() => ''));
const OUT = 's';

const esc = (s) => String(s ?? '').replace(/[<>&'"]/g, (c) =>
  ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));

// unique source-song artists, in order (split on ";" only — see js/catalog.js)
function artistsOf(t) {
  const seen = new Set(), out = [];
  for (const s of t?.sourceSongs ?? []) {
    for (const part of String(s?.artist ?? '').split(';')) {
      const name = part.trim();
      if (!name || seen.has(name.toLowerCase())) continue;
      seen.add(name.toLowerCase());
      out.push(name);
      if (out.length >= 6) return out;
    }
  }
  return out;
}

async function fromSupabase() {
  if (!SB_KEY) return null;
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const r = await fetch(
      `${SB_URL}/rest/v1/tracks?status=eq.approved&select=id,data`,
      { headers: { apikey: SB_KEY, authorization: `Bearer ${SB_KEY}`, range: `${from}-${from + 999}` } },
    );
    if (!r.ok) throw new Error(`supabase ${r.status} ${await r.text()}`);
    const page = await r.json();
    rows.push(...page);
    if (page.length < 1000) break;
  }
  return rows.map((row) => ({ id: row.id, ...(row.data || {}) })).filter((t) => t.id);
}

async function fromCatalog() {
  const raw = JSON.parse(await readFile('data/catalog.json', 'utf8'));
  return Array.isArray(raw) ? raw : (raw.tracks || []);
}

function page(t) {
  const id = t.id;
  const title = t.displayTitle || 'Mashup';
  const mashupArtist = t.mashupArtist || 'Bring Me The Mashup';
  const mainArtist = artistsOf(t)[0] || mashupArtist;
  const desc = `${mainArtist} · mashed by ${mashupArtist}`;
  const appUrl = SITE + '#track=' + encodeURIComponent(id);
  const imgUrl = `${IMG}?t=${encodeURIComponent(id)}&img=1`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} — Bring Me The Mashup</title>
<link rel="canonical" href="${esc(appUrl)}">
<meta property="og:type" content="music.song">
<meta property="og:site_name" content="Bring Me The Mashup">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${esc(appUrl)}">
<meta property="og:image" content="${esc(imgUrl)}">
<meta property="og:image:secure_url" content="${esc(imgUrl)}">
<meta property="og:image:type" content="image/png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="${esc(desc)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(desc)}">
<meta name="twitter:image" content="${esc(imgUrl)}">
<meta name="theme-color" content="#0e0f13">
<meta http-equiv="refresh" content="0; url=${esc(appUrl)}">
<script>location.replace(${JSON.stringify(appUrl)});</script>
<style>body{background:#0e0f13;color:#eee;font-family:system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;text-align:center;padding:24px}a{color:#f39237;font-weight:700;text-decoration:none}</style>
</head><body>
<div><p>Opening <b>${esc(title)}</b>…</p>
<p><a href="${esc(appUrl)}">Tap here if it doesn't open</a></p></div>
</body></html>`;
}

const tracks = (await fromSupabase().catch((e) => {
  console.warn('Supabase fetch failed, falling back to data/catalog.json:', e.message);
  return null;
})) || await fromCatalog();

if (!tracks.length) throw new Error('no tracks — refusing to wipe share pages');

// clear stale pages so unapproved / deleted mashups stop resolving
if (existsSync(OUT)) {
  for (const f of await readdir(OUT)) {
    if (f.endsWith('.html') && f !== 'index.html') await rm(path.join(OUT, f));
  }
}
await mkdir(OUT, { recursive: true });

let n = 0;
for (const t of tracks) {
  if (!/^[A-Za-z0-9._-]+$/.test(t.id)) { console.warn('skipping odd id:', t.id); continue; }
  await writeFile(path.join(OUT, `${t.id}.html`), page(t));
  n++;
}
console.log(`wrote ${n} share pages to ${OUT}/`);
