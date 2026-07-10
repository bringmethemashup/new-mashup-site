# Multi-Artist Build Plan

Turning Bring Me The Mashup from a personal catalog into a shared, admin-curated
database that other mashup artists can contribute to. No uploads are removed, no
money changes hands, no support/tip links. The whole thing stays embed-first and
never rehosts other artists' work.

Grounded in the current code (`supabase/schema.sql`, `js/backend.js`,
`js/ytmeta.js`, `js/trackform.js`, `admin.html`, `submit.html`). Items are
ordered so each phase ships and works on its own.

---

## The model, decided

- **Contributors are approved once, not per track.** If you approve a mashup
  artist's *account*, everything they submit goes live immediately. Your own
  submissions always go live. You keep a **remove-any-track** button as the only
  safety valve (no pre-review queue for approved artists).
- **Entries can be link-only OR have audio.** Audio versions add legitimacy and
  stay available (optional), but an artist can also just paste a YouTube / drive
  link. Uploads are *not* removed — they're just never required.
- **Source songs/artists are wanted for categorization**, but you don't hand-type
  them. YouTube autofill fills the rows; the artist confirms/fixes. If a link has
  nothing to scrape (e.g. a bare drive link), the entry still saves with just
  mashup artist + title.
- **Layered on top:** mashup-artist profile pages, follow, "New This Week",
  comments, reposts, and creator-facing analytics. Verification badges are
  nice-to-have, deferred (account approval already implies legitimacy).

---

## Phase 1 — Approve the artist, not the track  *(smallest change, biggest payoff)*

Right now the plumbing forces every non-admin submission to `status = 'pending'`
and blocks self-approve (schema.sql insert policy + `protect_track_status`
trigger + `submitTrack()` in backend.js). We flip it so an **approved** artist's
submissions land as `approved`.

- **DB (new migration `migration-artist-autopublish.sql`):** change the insert
  policy `"approved artists insert own pending tracks"` so an approved artist may
  insert `status = 'approved'` (not just `'pending'`). Loosen
  `protect_track_status` to permit an approved-artist owner to set their *own new*
  row to approved, while still blocking a random user from approving.
  Keep the admin-only delete + owner-pending-delete policy as the safety valve.
- **backend.js:** in `submitTrack()`, set `status: isArtist() ? 'approved' :
  'pending'` (admins already bypass). No other call sites change.
- **admin.html:** the review queue stays, but for *approved artists* it becomes a
  "recently added" feed you can delete from, not an approval gate. Add a visible
  **Remove track** action on any track (calls the existing
  `adminDeleteTrack()` / `adminSetStatus(id,'rejected')`).
- **Net effect:** you approve a person in *Artist requests* (already built:
  `adminSetArtistStatus`), and from then on their mashups appear with no clicks
  from you.

## Phase 2 — Make adding a mashup nearly typing-free

The parser already exists (`ytmeta.js`: `fetchVideoMeta` + `parseSourceSongs`);
it just needs to be the front-and-center path in the artist form.

- **submit.html / trackform.js:** paste-a-YouTube-URL is the primary flow. On
  paste → call `fetchVideoMeta` → prefill title, thumbnail, and the source-song
  rows from `parseSourceSongs`. Artist reviews and edits inline.
- **Make source songs optional, not blocking.** Encourage (a gentle "add the
  songs so people can find this" nudge), but let an entry save with none — needed
  for bare drive links. Categorization still works off whatever's filled.
- **Link-only vs audio toggle:** keep the existing media-source handling
  (pCloud/Dropbox/OneDrive/GDrive/direct/YouTube/TikTok). Default for
  contributors is embed-only YouTube; audio is an optional upgrade.
- **Batch/paste-many (optional, later):** a "paste several YouTube URLs" box that
  creates one draft row per link, each pre-autofilled — this is how someone with
  a back catalog adds dozens quickly without your original 1-song-at-a-time pain.

## Phase 3 — Mashup-artist profiles, follow, and New This Week

You already have `artist_pages` (bio/youtube per mashup-artist name) and
`fetchArtistPages` / `saveArtistPage`. Extend it into a real profile + a follow graph.

- **Profiles:** a profile view per mashup artist = their bio + full catalog in one
  place (group tracks by `mashupArtist`, which `catalog.js` already does). Add
  avatar + links to the `artist_pages` row.
- **Follow (new `follows` table):** `(follower_id, artist_key)`, RLS = users
  manage their own follows. Add follow/unfollow on the profile and a "Following"
  filter in the library.
- **New This Week:** derive from `tracks.created_at` (already selected in
  `fetchTracks` as `_created`). Show it as a home-screen shelf **only when there's
  enough** — e.g. hide the section if fewer than ~5 new entries in the window, so
  it doesn't look empty early on.

## Phase 4 — Social layer (comments + reposts)

The community piece. Two small tables, both public-read, owner/admin-moderated.

- **Comments (new `comments` table):** `(id, track_id, user_id, body,
  created_at)`. RLS: anyone signed in can post; author, track owner, and admin can
  delete. Render under the full player. Include a report/delete affordance so you
  can moderate.
- **Reposts (new `reposts` table):** `(user_id, track_id, created_at)`. A repost
  surfaces the track on the reposter's profile and (later) in followers' feeds.
  RLS = users manage their own reposts. Show a repost count + button on each track.
- **Moderation:** you (admin) can delete any comment/repost and remove any track —
  same safety-valve principle as Phase 1.

## Phase 5 — Creator-facing analytics

Give each approved artist a simple dashboard for their own tracks.

- **Data:** likes (`likes` table) and plays (`plays` table) already exist, but both
  are per-user and RLS-scoped to the viewer. For per-track *totals* across all
  users, add a **security-definer RPC/view** (e.g. `track_stats_for_owner`) that
  returns `{track_id, play_total, like_total, repost_total, comment_total}` for
  tracks the caller owns (admin sees all).
- **UI:** an "Analytics" panel on the artist's own profile / a stats tab in
  submit.html — top tracks, plays & likes over time, totals. Low effort once the
  RPC exists; the data's already being written.

---

## Cross-cutting / don't forget

- **Service worker:** bump `VERSION` in `sw.js` and add any new JS files to the
  `SHELL` array whenever a shell file changes, or clients keep the cached copy.
- **APK:** bump `app-version.txt` for any APK-worthy change (triggers the update
  banner).
- **Deploy path:** per project history, deploys go through the GitHub web UI /
  browser extension, **not** a sandbox `git push` (the sandbox can't push and the
  mount can truncate large files like `catalog.json`). Reconcile the local repo in
  GitHub Desktop before any programmatic push.
- **Legal posture stays intact:** aggregator/other-artist entries are embed-only,
  never downloaded or rehosted (`isOwnUpload: false`). No support/tip links
  anywhere.

## Explicitly out of scope

- Removing the upload capability (kept, just optional).
- Any monetization, tipping, or "support this artist" links.
- Verification badges (deferred — approval already gates who can contribute).

---

## Suggested build order (each ships independently)

1. **Phase 1** — approval flip + remove-any-track. Unlocks contributors at all.
2. **Phase 2** — YouTube-autofill-first submit + optional source songs. Removes the
   data-entry pain.
3. **Phase 3** — profiles + follow + New This Week. Makes contributors discoverable.
4. **Phase 4** — comments + reposts. Turns it into a community.
5. **Phase 5** — creator analytics. Retention/reward for contributors.

Phases 1–2 are the true prerequisites for opening the doors; 3–5 make it worth
staying.
