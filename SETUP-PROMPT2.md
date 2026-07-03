# Prompt 2 setup — accounts, playlists, backend & app

Everything is coded and ready. These are the one-time steps only you can do
(they need your accounts). Total time: ~20 minutes.

## 1. Create the Supabase project (~5 min)

1. Go to https://supabase.com → **Start your project** → sign up (GitHub login is easiest).
2. Click **New project**. Name: `bring-me-the-mashup`. Pick any password (it's for the database, save it somewhere). Region: East US. Plan: **Free**.
3. Wait ~2 minutes for it to provision.

## 2. Run the database setup (~2 min)

1. In the Supabase dashboard, open **SQL Editor** (left sidebar) → **New query**.
2. Open `supabase/schema.sql` from this folder, copy ALL of it, paste, press **Run**.
3. You should see "Success. No rows returned."

## 3. Connect the site to Supabase (~2 min)

1. In Supabase: **Project Settings** (gear icon) → **API**.
2. Copy the **Project URL** and the **anon public** key.
3. Open `js/config.js` in this folder and paste them into the two empty strings.
   (The anon key is safe to publish — permissions are enforced by the database.)

Optional but recommended: in Supabase **Authentication → Sign In / Up →
Email**, turn OFF "Confirm email" so signups work instantly without an email
step.

## 4. Push, then create your account (~3 min)

1. In PowerShell, from this folder:
   `git add -A ; git commit -m "Prompt 2: accounts, playlists, submissions, PWA + Android app" ; git push`
2. Open https://bringmethemashup.github.io/new-mashup-site/ → account button
   (top right) → **Sign up** with the email you want as admin.
3. Back in the Supabase **SQL Editor**, run this (with your real email):

   ```sql
   update public.profiles set is_admin = true, role = 'artist',
     display_name = 'Bring Me The Mashup'
   where id = (select id from auth.users where email = 'YOUR_EMAIL');
   ```

4. Refresh the site, sign out/in once — the account menu now shows **Admin**.

## 5. Import the catalog (~1 min)

Account menu → **Admin** → **⬆ Import catalog.json**. This copies all 965+
tracks into the database, attributed to you, marked approved. The database is
now the single source of truth (catalog.json stays as the offline fallback).

## 6. Android APK (~5 min, once)

1. On GitHub: repo → **Settings → Secrets and variables → Actions → New repository secret**. Add two:
   - `ANDROID_KEYSTORE_B64` — paste the contents of `android-signing/KEYSTORE_BASE64.txt`
   - `ANDROID_KEYSTORE_PASS` — paste the contents of `android-signing/KEYSTORE_PASSWORD.txt`
   (That folder is git-ignored — keep it safe locally; it's the app's signing
   identity. Without the secrets you still get a working debug APK.)
2. Repo → **Actions** tab → **Build Android APK** → **Run workflow**.
3. ~10 minutes later the APK appears under **Releases** ("Bring Me The Mashup —
   Android app"). The site's account menu already links to it.
4. Heads-up: Google's developer-verification requirement for sideloaded apps
   starts rolling out around September 2026 — installing your own APK stays
   possible, but you may eventually need a (free) verification step in your
   Google account.

**iPhone:** nothing to build — visit the site in Safari → Share → **Add to
Home Screen**. It installs full-screen with the app icon (that's the PWA).

## 7. Verify sync

Sign in on the website AND in the Android app with the same account. Like a
track on one, pull-to-refresh / reopen the other — the like is there. Same
database, no separate sync layer.

---

### What went where

| Thing | File(s) |
|---|---|
| Database schema + security rules | `supabase/schema.sql` |
| Supabase keys | `js/config.js` |
| Backend wrapper (auth/likes/playlists/submissions) | `js/backend.js` |
| Sign-in, account menu, playlists UI | `index.html`, `js/app.js`, `css/style.css` |
| Artist submission form + my-submissions list | `submit.html` (+ `js/trackform.js`) |
| Admin: review queue, edit any track, catalog import | `admin.html` |
| PWA | `manifest.webmanifest`, `sw.js`, `icons/` |
| Android app | `capacitor.config.json`, `.github/workflows/build-apk.yml` |
| APK signing identity (git-ignored!) | `android-signing/` |
