/**
 * config.js — Supabase project settings.
 *
 * Fill these two values in from your Supabase dashboard
 * (Project Settings → API): the Project URL and the `anon` public key.
 * The anon key is SAFE to publish — it only allows what the database
 * row-level-security policies permit.
 *
 * Leave both empty and the site runs exactly like Prompt 1
 * (catalog.json only, no accounts).
 */
export const SUPABASE_URL = 'https://txkmwsnvtwobhrdrablw.supabase.co';
export const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR4a213c252dHdvYmhyZHJhYmx3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMwOTY0MjQsImV4cCI6MjA5ODY3MjQyNH0.S4gQFyfNUhcUbIh5vBaNEj3VxQONTYcuc9VaSCxN74c';

/**
 * Audio relay for listeners whose ISP DNS blocks pCloud (see
 * cloudflare/worker.js). Set to the deployed worker URL, e.g.
 * 'https://bmtm-audio.yourname.workers.dev'. Empty = relay disabled.
 */
export const PCLOUD_RELAY_URL = '';

/**
 * Direct download of the newest APK. GitHub's `releases/latest/download/<name>`
 * always redirects to the most recent release's asset, so this never goes
 * stale — no hardcoded version, no per-release URL edits.
 */
export const APK_URL = 'https://github.com/bringmethemashup/new-mashup-site/releases/latest/download/bring-me-the-mashup.apk';

/**
 * YouTube Data API v3 key — powers the "Autofill songs from YouTube" button
 * in the submit / admin / editor forms. It reads a video's title + description
 * and guesses the source songs.
 *
 * This key ships in the browser, so lock it down in Google Cloud Console:
 *   APIs & Services → Credentials → your key →
 *     • Application restrictions: HTTP referrers → add
 *         https://bringmethemashup.github.io/*   (and http://localhost:* for testing)
 *     • API restrictions: restrict to "YouTube Data API v3"
 * Leave empty to hide the Autofill button entirely.
 */
export const YT_API_KEY = '';
