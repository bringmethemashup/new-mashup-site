# BRING ME THE MASHUP — site, player & aggregator

A static, no-framework music site for the Bring Me The Mashup catalog: 965+ mashups,
streamed **directly from pCloud audio** with a real-time audio-reactive visualizer,
plus an aggregator schema for other artists' work (embed-only).

**Prompt 2 additions:** free accounts (listener / mashup artist) on Supabase,
likes + private playlists synced across web and app, artist submissions with a
review queue (`submit.html`), an admin console (`admin.html`), a PWA
(installable on iPhone via Add to Home Screen), and an Android APK built by
GitHub Actions. One-time setup steps live in **`SETUP-PROMPT2.md`**. With
`js/config.js` left empty the site runs in Prompt 1 mode (catalog.json, no
accounts) — nothing breaks.

## Run locally

Any static server from the repo root works:

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

(No build step, no dependencies. `npx serve` works too.)

## Deploy — GitHub Pages

The repo deploys as-is (all paths are relative):

```bash
gh auth login                                  # one-time
gh repo create bringmethemashup-v2 --public --source . --push
# GitHub → repo Settings → Pages → Deploy from branch → main / (root)
```

Or push to the existing `bringmethemashup.github.io/bringmethemashup` repo and Pages
keeps serving from `main`.

## How playback works (important)

- **pCloud audio is the primary source.** Each track stores a pCloud *share link*.
  At play time `js/pcloud.js` resolves it to a temporary direct URL via pCloud's
  public, unauthenticated API (`getpublinkdownload`). Direct URLs **expire after a
  few hours**, so they're resolved lazily, cached in localStorage with their expiry,
  and re-resolved automatically if an `<audio>` error suggests the link went stale.
- **YouTube is a video *view*, not a source.** Tracks with a matched video get an
  Audio/Video toggle in the full player (like Spotify's podcast toggle). Switching
  to video pauses the audio; switching back resumes it.
- **Other artists' entries (`isOwnUpload:false`) are embed-only** — official
  YouTube/TikTok embeds, never downloaded or rehosted. This is a hard constraint;
  don't work around it.
- The **visualizer** uses a Web Audio `AnalyserNode` on the real audio stream. If a
  pCloud host ever fails CORS, playback continues without the analyser and the
  visualizer falls back to an ambient (non-reactive) animation automatically.

### Per-platform behavior

| Platform | Audio mode | Video toggle |
|---|---|---|
| Desktop (Chrome/Edge/Firefox/Safari) | Full playback + Media Session (media keys) | Works while tab visible |
| Android (Chrome) | Continues in background; lock-screen controls via Media Session | Pauses when backgrounded (YouTube iframe limitation) |
| iOS (Safari) | Continues in background with lock-screen controls in most cases; autoplaying the *next* queued track while locked can be inconsistent (iOS policy) | Pauses when backgrounded (expected) |

## Catalog data (`data/catalog.json`)

One JSON array; schema per entry:

```json
{
  "id": "unique-slug",
  "mashupArtist": "Bring Me The Mashup",
  "sourceSongs": [ { "title": "Song A", "artist": "Artist A" } ],
  "displayTitle": "Shown in lists",
  "isOwnUpload": true,
  "audio":  { "type": "pcloud", "publicLink": "https://u.pcloud.link/publink/show?code=…" },
  "video":  { "type": "youtube", "sourceId": "VIDEOID" },
  "tags": ["Mashups 2016", "2016"],
  "year": "2016",
  "dateAdded": "2016-01-01",
  "meta": { "songSource": "youtube-description|filename|album-context|manual", "needsMetadata": false }
}
```

- Omit `audio` entirely for other artists (embed-only).
- Omit `video` if no video exists.
- `sourceSongs` powers the **Mashup Explorer** — keep it structured (one row per
  song), never a free-text blob.

### Editing / adding entries — `editor.html`

Open `/editor.html` on the deployed site (or locally). It lets you:

- filter to entries with **no song data** (603 at build time) or auto-parsed ones
  worth reviewing, and fill in song/artist rows;
- **link a YouTube video** to any track that wasn't matched yet;
- add new entries — yours or other artists' (aggregator, embed-only).

Edits live in a browser draft until you press **Download catalog.json**; replace
`data/catalog.json` with the download, commit, push. (Accounts, review queues and
in-place editing arrive with the Prompt 2 backend.)

### Rebuilding from source data — `scripts/build_catalog.mjs`

`node scripts/build_catalog.mjs` regenerates `data/catalog.json` from the old site's
data files in `scripts/source/`. Song data priority: YouTube description tracklist →
filename `A vs. B - Title` parse → album-context inference → punch-list
(`data/punchlist.json`). The YouTube API key lives in `.env` (gitignored) — it is
only needed if you re-harvest descriptions, not at runtime.

## Site features

- **Library** — search (title / source song / artist / mashup artist), sort,
  sunset-glow hover rows with right-side play button (Spotify convention).
- **Mashup Explorer** — Miller columns over a co-occurrence index built once at
  load: pick a song/artist, open its connections, keep chaining; every connection
  lists the exact mashups that link the pair, playable in one tap.
- **Player** — full-screen (seek bar, shuffle, prev/next, repeat off/all/one,
  like) with the visualizer as the artwork; persistent mini-player with a live
  mini-visualizer; queue drawer with jump/remove.
- **Liked** — heart anything; stored in localStorage (accounts come in Prompt 2).
- **Light/dark themes**, mouse-reactive ambient background, keyboard controls
  (Space, Shift+←/→, Esc).

## Repo map

```
index.html          app shell
editor.html         catalog editor (local drafts → download JSON)
css/style.css       design system, both themes
js/app.js           UI, views, explorer, players
js/player.js        queue/shuffle/repeat, Media Session, pCloud-primary logic
js/pcloud.js        share-link → direct-URL resolution (+ expiry cache)
js/visualizer.js    AnalyserNode aurora visualizer (full + mini)
js/catalog.js       search index + explorer co-occurrence graph
data/catalog.json   the catalog (source of truth for the site)
data/punchlist.json tracks still missing song data
scripts/            one-time catalog builder + source data
PLAN.md             stage checklist / checkpoint file
```

Two `DEMO —` aggregator entries (tag `demo`) exist to demonstrate the embed-only
UI — replace or delete them via `editor.html` when real aggregator entries arrive.
