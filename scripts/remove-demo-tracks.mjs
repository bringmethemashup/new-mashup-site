/**
 * Strips the placeholder "Demo Artist (replace me)" seed tracks from
 * data/catalog.json (the offline fallback). Supabase is the live source of
 * truth — run supabase/remove-demo-tracks.sql for that.
 *
 * Usage:  node scripts/remove-demo-tracks.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';

const path = new URL('../data/catalog.json', import.meta.url);
const tracks = JSON.parse(readFileSync(path, 'utf8'));

const before = tracks.length;
const cleaned = tracks.filter((t) =>
  (t.mashupArtist || '').trim() !== 'Demo Artist (replace me)' &&
  !['demo-other-artist-youtube', 'demo-other-artist-tiktok'].includes(t.id));

writeFileSync(path, JSON.stringify(cleaned, null, 1) + '\n');
console.log(`Removed ${before - cleaned.length} demo track(s). ${cleaned.length} remain.`);
