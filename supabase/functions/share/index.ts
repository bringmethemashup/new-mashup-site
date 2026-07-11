/**
 * share — per-track social share cards for Bring Me The Mashup.
 *
 * Two responsibilities, one public endpoint (verify_jwt = false):
 *   GET /share?t=<id>          -> tiny HTML page carrying per-track Open Graph /
 *                                 Twitter tags. Crawlers (Twitterbot,
 *                                 facebookexternalhit, Slackbot, Discordbot …)
 *                                 read the tags; real browsers are redirected
 *                                 straight into the app at #track=<id>.
 *   GET /share?t=<id>&img=1    -> a 1200x630 PNG card: the main source artist's
 *                                 Deezer photo, darkened, with a stylized
 *                                 per-track waveform + the title overlaid.
 *
 * No audio is decoded. The waveform is a deterministic look derived from the
 * track id (stylized, not the real signal). The artist photo comes from
 * Deezer's public artist search (same source as js/artwork.js), falling back
 * across the mashup's other source artists, then to a plain branded card.
 *
 * Renders by hand-building an SVG and rasterizing with resvg-wasm — no satori /
 * yoga, so the whole thing is one wasm dependency and fully deterministic.
 */

import { Resvg, initWasm } from "npm:@resvg/resvg-wasm@2.6.2";
import { FONT_B64 } from "./font.ts";

const SITE = "https://bringmethemashup.github.io/new-mashup-site/";
const RESVG_WASM = "https://unpkg.com/@resvg/resvg-wasm@2.6.2/index_bg.wasm";

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const FONT = Uint8Array.from(atob(FONT_B64), (c) => c.charCodeAt(0));

// init resvg wasm once per cold start
let wasmReady: Promise<unknown> | null = null;
function ensureWasm() {
  if (!wasmReady) wasmReady = initWasm(fetch(RESVG_WASM));
  return wasmReady;
}

/* ---------------- helpers ---------------- */

function esc(s: unknown): string {
  return String(s ?? "").replace(/[<>&'"]/g, (c) =>
    ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" }[c]!));
}
function clip(s: unknown, n: number): string {
  const t = String(s ?? "");
  return t.length > n ? t.slice(0, n - 1).trim() + "…" : t;
}
function seeded(seed: string) {
  let s = 0;
  for (const c of seed) s = (s * 31 + c.charCodeAt(0)) >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

// base64-encode bytes in chunks (btoa on a huge string blows the stack)
function b64(bytes: Uint8Array): string {
  let out = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    out += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(out);
}

// unique source-song artists, in order (split on ";" only — see js/catalog.js)
function artistsOf(track: any): string[] {
  const seen = new Set<string>(), out: string[] = [];
  for (const s of track?.sourceSongs ?? []) {
    for (const part of String(s?.artist ?? "").split(";")) {
      const name = part.trim();
      const k = name.toLowerCase();
      if (!k || seen.has(k)) continue;
      seen.add(k);
      out.push(name);
      if (out.length >= 6) return out;
    }
  }
  return out;
}

async function getTrack(id: string): Promise<any | null> {
  const r = await fetch(
    `${SB_URL}/rest/v1/tracks?id=eq.${encodeURIComponent(id)}&status=eq.approved&select=data&limit=1`,
    { headers: { apikey: SB_KEY, authorization: `Bearer ${SB_KEY}` } },
  );
  if (!r.ok) return null;
  const rows = await r.json().catch(() => null);
  return rows?.[0]?.data ?? null;
}

async function deezerPhoto(name: string): Promise<string | null> {
  try {
    const r = await fetch(
      `https://api.deezer.com/search/artist?q=${encodeURIComponent(name)}&limit=1`,
    );
    if (!r.ok) return null;
    const d = await r.json();
    const a = d?.data?.[0];
    return a?.picture_xl || a?.picture_big || null;
  } catch { return null; }
}

// first source artist with a fetchable photo -> data URI (or null)
async function photoDataUriFor(artists: string[]): Promise<string | null> {
  for (const name of artists) {
    const url = await deezerPhoto(name);
    if (!url) continue;
    try {
      const img = await fetch(url);
      if (!img.ok) continue;
      const buf = new Uint8Array(await img.arrayBuffer());
      const ct = img.headers.get("content-type") || "image/jpeg";
      return `data:${ct};base64,${b64(buf)}`;
    } catch { /* try next */ }
  }
  return null;
}

function buildSvg(
  { title, mainArtist, mashupArtist, photoDataUri, seed }:
  { title: string; mainArtist: string; mashupArtist: string; photoDataUri: string | null; seed: string },
): string {
  const W = 1200, H = 630;
  const rnd = seeded(seed || (title + mainArtist));
  const N = 42, gap = 6, bw = 12, totalW = N * bw + (N - 1) * gap;
  const startX = (W - totalW) / 2, midY = 300;
  let bars = "";
  for (let i = 0; i < N; i++) {
    const env = Math.sin((i / N) * Math.PI) * 0.6 + 0.4;
    const h = Math.max(18, Math.min(120, Math.round(env * (0.55 + rnd() * 0.7) * 120)));
    const x = startX + i * (bw + gap), y = midY - h / 2;
    const fill = i % 3 === 2 ? "rgba(255,255,255,0.92)" : "#f39237";
    bars += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bw}" height="${h}" rx="6" fill="${fill}"/>`;
  }
  const photo = photoDataUri
    ? `<image href="${photoDataUri}" x="0" y="0" width="${W}" height="${H}" preserveAspectRatio="xMidYMid slice"/>`
    : `<rect width="${W}" height="${H}" fill="#1a1420"/>` +
      `<rect width="${W}" height="${H}" fill="#c64a2d" fill-opacity="0.25"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<defs><linearGradient id="v" x1="0" y1="0" x2="0" y2="1">
<stop offset="0" stop-color="#0a080e" stop-opacity="0.35"/>
<stop offset="0.4" stop-color="#0a080e" stop-opacity="0.15"/>
<stop offset="1" stop-color="#0a080e" stop-opacity="0.9"/></linearGradient></defs>
${photo}
<rect width="${W}" height="${H}" fill="url(#v)"/>
<text x="48" y="60" font-family="DejaVu Sans" font-weight="bold" font-size="22" letter-spacing="3" fill="#ffffff" fill-opacity="0.92">BRING ME THE MASHUP</text>
${bars}
<text x="48" y="512" font-family="DejaVu Sans" font-weight="bold" font-size="86" fill="#ffffff">${esc(clip(title, 20))}</text>
<text x="50" y="560" font-family="DejaVu Sans" font-weight="bold" font-size="32" fill="#ffffff" fill-opacity="0.85">${esc(clip(mainArtist, 28))}  ·  mashed by ${esc(clip(mashupArtist, 26))}</text>
</svg>`;
}

/* ---------------- request handler ---------------- */

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const id = url.searchParams.get("t");
  const isImg = url.searchParams.get("img") === "1";
  if (!id) return Response.redirect(SITE, 302);

  const track = await getTrack(id);
  if (!track) return Response.redirect(SITE, 302);

  const title = track.displayTitle || "Mashup";
  const mashupArtist = track.mashupArtist || "Bring Me The Mashup";
  const artists = artistsOf(track);
  const mainArtist = artists[0] || mashupArtist;
  const appUrl = SITE + "#track=" + encodeURIComponent(id);

  if (isImg) {
    try {
      await ensureWasm();
      const photoDataUri = await photoDataUriFor(artists);
      const svg = buildSvg({ title, mainArtist, mashupArtist, photoDataUri, seed: id });
      const png = new Resvg(svg, {
        font: { fontBuffers: [FONT], defaultFontFamily: "DejaVu Sans" },
        fitTo: { mode: "width", value: 1200 },
      }).render().asPng();
      return new Response(png, {
        headers: {
          "content-type": "image/png",
          "cache-control": "public, max-age=86400, s-maxage=604800",
        },
      });
    } catch (_e) {
      // if anything fails, fall back to the static branded banner
      return Response.redirect(SITE + "icons/og-image.png", 302);
    }
  }

  const imgUrl = `${url.origin}${url.pathname}?t=${encodeURIComponent(id)}&img=1`;
  const desc = `${mainArtist} · mashed by ${mashupArtist}`;
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>${esc(title)} — Bring Me The Mashup</title>
<meta property="og:type" content="music.song">
<meta property="og:site_name" content="Bring Me The Mashup">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${esc(appUrl)}">
<meta property="og:image" content="${esc(imgUrl)}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(desc)}">
<meta name="twitter:image" content="${esc(imgUrl)}">
<meta http-equiv="refresh" content="0; url=${esc(appUrl)}">
</head><body style="background:#0e0f13;color:#eee;font-family:sans-serif">
<script>location.replace(${JSON.stringify(appUrl)});</script>
<a href="${esc(appUrl)}" style="color:#f39237">Open ${esc(title)} in Bring Me The Mashup</a>
</body></html>`;
  return new Response(html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "public, max-age=3600",
    },
  });
});
