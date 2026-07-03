# PLAN — Bring Me The Mashup (rebuild)

Checkpoint file. If resuming: read this + `git log --oneline` before touching code.

## Decisions (locked)
- **Hosting:** GitHub Pages (already in use, static-only site, free).
- **Stack:** No framework. Vanilla ES modules + CSS + Canvas. No build step — repo root deploys as-is.
- **Audio:** pCloud primary via `getpublinkdownload` (unauthenticated, client-side, resolved at play time since URLs are temporary). YouTube = optional video toggle only.
- **Data:** single `data/catalog.json`. Old repo (`pcloud_tracks.js`, `pcloud_direct.js`) was the seed source: 965 tracks, 1365 publinks, 178 YouTube matches.
- **Metadata (per Ian, 2026-07-02):** skip ID3/bulk metadata pass for now. Auto-parse only: (a) YouTube description tracklists for matched tracks, (b) filenames matching "Artist vs. Artist - Title". Everything else stays empty and editable later via editor tool. Editor must also support linking YouTube IDs to unmatched tracks. Account-based artist editing = Prompt 2.

## Stage 0 — Environment
- [x] git init (sandbox repo, synced to user folder), .gitignore excludes .env, key in .env only

## Stage 1 — Core site
- [x] 1. Audio-reactive visualizer (AnalyserNode; full player + mini form)
- [x] 2. Searchable catalogue (title / source artist / mashup artist)
- [x] 3. Mashup Explorer — Miller columns over co-occurrence index (built once at load)
- [x] 4. Shuffle/queue system with visible queue UI
- [x] 5. pCloud-audio-primary playback + YouTube video toggle (Spotify-podcast style)
- [x] 6. catalog.json population script (`scripts/build_catalog.mjs`) + punch-list output

## Stage 2 — Aggregator
- [x] 7. `isOwnUpload:false` entries — YouTube/TikTok embed-only (hard constraint: never rehost)
- [x] 8. Editor tool (`editor.html`): add entries, edit sourceSongs rows, link YT IDs; exports catalog.json

## Stage 3 — Polish & ship
- [x] 9. Mobile pass, README (deploy steps, per-platform playback behavior notes)

## Definition of done
Local run: `python3 -m http.server` (or any static server) from repo root.
Search/shuffle/play polished; aggregator test entries render; PLAN + commits show state; README has deploy steps.

## Prompt 2 — accounts, playlists, backend & app (built 2026-07-03)
Backend: **Supabase** (auth + Postgres + storage on one free tier; no custom auth).
- [x] `supabase/schema.sql` — profiles (listener/artist role, is_admin), tracks
      (full catalog entry in `data` jsonb, status pending/approved/rejected),
      likes, plays, playlists (+tracks, private default), storage bucket +
      RLS everywhere. Admin promoted by one SQL line (see SETUP-PROMPT2.md).
- [x] `js/config.js` (Ian pastes URL + anon key), `js/backend.js` wrapper.
      Empty config = site runs exactly like Prompt 1 (catalog.json fallback).
- [x] Auth UI + account menu in index.html/app.js; likes & play counts sync
      (one-time local merge, then write-through); Playlists tab (create/
      rename/delete/reorder/remove, private); ＋-to-playlist on every row.
- [x] `submit.html` — artist submissions: upload to storage OR own-host link
      (YouTube/TikTok/pCloud), REQUIRED structured sourceSongs rows; lands
      status=pending, visible only to submitter. Listener→artist self-toggle.
- [x] `admin.html` — review queue approve/reject, edit ANY track anytime
      (independent of approval), one-click catalog.json import (attributed to
      admin, approved). DB = single source of truth after import.
- [x] PWA: manifest.webmanifest, icons/, sw.js (shell cache + catalog
      network-first). iPhone = Add to Home Screen.
- [x] Android: capacitor.config.json (wraps live site URL) +
      .github/workflows/build-apk.yml (manual trigger → signed APK on release
      `app-latest`). Keystore in git-ignored android-signing/ → GitHub secrets.
- [ ] Ian's one-time setup: SETUP-PROMPT2.md (Supabase project, keys, SQL,
      admin promotion, catalog import, APK secrets + first build).

## Future ideas (not this pass)
- ID3 harvest pass when mp3 folder is shareable; remote ID3 via ranged pCloud reads in editor
- Social login (Google/Apple); public/shared playlists (is_public column already there)
- Refetch catalog on sign-in so an artist's pending tracks appear without reload
