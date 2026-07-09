/**
 * backend.js — thin Supabase wrapper. Everything account-related lives here.
 *
 * Design rules:
 *  - If config.js is empty, every function degrades gracefully:
 *    enabled() is false and the app behaves exactly like Prompt 1.
 *  - Tracks live in the `tracks` table with the FULL catalog.json entry in
 *    the `data` jsonb column — the client-side shape never changed, so
 *    catalog.js / player.js / the Explorer all keep working untouched.
 *  - No custom auth: Supabase email/password only.
 */
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

let sb = null;               // supabase client (lazy)
let session = null;
let profile = null;          // { id, display_name, role, is_admin }
const authListeners = [];

export const enabled = () => !!(SUPABASE_URL && SUPABASE_ANON_KEY);

/* ---- Capacitor native app detection + plugin access ----
 * On the website window.Capacitor is undefined, so isNative() is false and
 * every branch below falls back to the plain-web behaviour. Inside the
 * Android app the OAuth round-trip must return via a custom URL scheme
 * (an https redirect would just open the site in Chrome and never come
 * back to the app). */
const cap = () => (typeof window !== 'undefined' ? window.Capacitor : null);
const isNative = () => !!cap()?.isNativePlatform?.();
const capPlugin = (name) => cap()?.Plugins?.[name] || null;
const NATIVE_REDIRECT = 'com.bringmethemashup.app://login-callback';

export async function init() {
  if (!enabled()) return null;
  if (sb) return sb;
  const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
  sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      flowType: 'pkce',        // works for both web redirect and native deep link
      detectSessionInUrl: true, // web: auto-exchange the ?code= on return
      persistSession: true,
      autoRefreshToken: true,
    },
  });
  const { data } = await sb.auth.getSession();
  session = data.session || null;
  if (session) await loadProfile();
  sb.auth.onAuthStateChange(async (_ev, s) => {
    session = s || null;
    profile = null;
    if (session) await loadProfile();
    authListeners.forEach((f) => f(user(), profile));
  });
  if (isNative()) registerDeepLinkAuth();
  return sb;
}

/** Native only: catch the com.bringmethemashup.app://login-callback deep link
 *  that Supabase redirects to after Google sign-in, and turn it into a
 *  session. Without this the app has no way to receive the OAuth result. */
function registerDeepLinkAuth() {
  const App = capPlugin('App');
  if (!App?.addListener) return;
  App.addListener('appUrlOpen', async ({ url }) => {
    if (!url || url.indexOf(NATIVE_REDIRECT) !== 0) return;
    // Dismiss the in-app browser tab if it's still showing.
    const Browser = capPlugin('Browser');
    if (Browser?.close) { try { await Browser.close(); } catch (_) {} }
    try {
      const u = new URL(url);
      const code = u.searchParams.get('code');
      if (code) {
        const { error } = await sb.auth.exchangeCodeForSession(code);
        if (error) throw error;
      } else if (u.hash && u.hash.includes('access_token')) {
        const p = new URLSearchParams(u.hash.replace(/^#/, ''));
        const { error } = await sb.auth.setSession({
          access_token: p.get('access_token'),
          refresh_token: p.get('refresh_token'),
        });
        if (error) throw error;
      }
    } catch (e) {
      console.error('[auth] deep-link sign-in failed', e);
    }
  });
}

async function loadProfile() {
  if (!session) { profile = null; return; }
  const { data } = await sb.from('profiles').select('*').eq('id', session.user.id).single();
  profile = data || null;
}

export const client = () => sb;
export const user = () => session?.user || null;
export const getProfile = () => profile;
export const isArtist = () => profile?.role === 'artist';
export const isAdmin = () => !!profile?.is_admin;
export function onAuth(fn) { authListeners.push(fn); }

/* ---------------- auth ---------------- */
export async function signUp(email, password, displayName) {
  const { error } = await sb.auth.signUp({
    email, password,
    options: { data: { display_name: displayName || '' } },
  });
  if (error) throw error;
}
export async function signIn(email, password) {
  const { error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw error;
}
export async function signOut() { await sb.auth.signOut(); }

/** Google OAuth.
 *  Web: redirect away and back; supabase-js exchanges the ?code= on return.
 *  Native app: open the consent page in the system browser and come back via
 *  the custom-scheme deep link (see registerDeepLinkAuth). */
export async function signInWithGoogle() {
  if (isNative()) {
    const { data, error } = await sb.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: NATIVE_REDIRECT, skipBrowserRedirect: true },
    });
    if (error) throw error;
    const Browser = capPlugin('Browser');
    if (Browser?.open) await Browser.open({ url: data.url });
    else window.location.href = data.url; // fallback if Browser plugin missing
    return;
  }
  const { error } = await sb.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: location.origin + location.pathname },
  });
  if (error) throw error;
}

/** Listener <-> Artist toggle (no separate signup flow). */
export async function setRole(role) {
  const { error } = await sb.from('profiles').update({ role }).eq('id', user().id);
  if (error) throw error;
  await loadProfile();
  authListeners.forEach((f) => f(user(), profile));
}

/** Update own profile fields (display_name, youtube_channel, …). */
export async function updateProfile(fields) {
  const { error } = await sb.from('profiles').update(fields).eq('id', user().id);
  if (error) throw error;
  await loadProfile();
  authListeners.forEach((f) => f(user(), profile));
}

/* ---------------- catalog ---------------- */
/** All tracks this viewer may see (approved + own pending), catalog.json shape. */
export async function fetchTracks() {
  const out = [];
  const page = 1000;
  for (let from = 0; ; from += page) {
    const { data, error } = await sb.from('tracks')
      .select('id, owner, status, data, created_at')
      .order('id')
      .range(from, from + page - 1);
    if (error) throw error;
    for (const row of data) out.push({ ...row.data, id: row.id, _status: row.status, _owner: row.owner, _created: row.created_at });
    if (data.length < page) break;
  }
  return out;
}

/* ---------------- likes ---------------- */
export async function fetchLikes() {
  const { data, error } = await sb.from('likes').select('track_id').order('created_at');
  if (error) throw error;
  return data.map((r) => r.track_id);
}
export async function addLike(trackId) {
  await sb.from('likes').upsert({ user_id: user().id, track_id: trackId });
}
export async function removeLike(trackId) {
  await sb.from('likes').delete().eq('user_id', user().id).eq('track_id', trackId);
}
/** One-time merge of pre-account localStorage likes into the server. */
export async function mergeLikes(ids) {
  if (!ids.length) return;
  await sb.from('likes').upsert(ids.map((track_id) => ({ user_id: user().id, track_id })),
    { ignoreDuplicates: true });
}

/* ---------------- play counts ---------------- */
export async function fetchPlays() {
  const { data, error } = await sb.from('plays').select('track_id, count');
  if (error) throw error;
  return Object.fromEntries(data.map((r) => [r.track_id, r.count]));
}
export async function syncPlays(map) {
  const rows = Object.entries(map).map(([track_id, count]) =>
    ({ user_id: user().id, track_id, count, updated_at: new Date().toISOString() }));
  if (rows.length) await sb.from('plays').upsert(rows);
}

/* ---------------- playlists ---------------- */
export async function fetchPlaylists() {
  const { data, error } = await sb.from('playlists')
    .select('id, name, is_public, created_at, playlist_tracks ( track_id, position )')
    .eq('owner', user().id).order('created_at');
  if (error) throw error;
  return data.map((p) => ({
    id: p.id, name: p.name, isPublic: p.is_public,
    trackIds: (p.playlist_tracks || []).sort((a, b) => a.position - b.position).map((t) => t.track_id),
  }));
}
export async function createPlaylist(name) {
  const { data, error } = await sb.from('playlists')
    .insert({ owner: user().id, name }).select().single();
  if (error) throw error;
  return data.id;
}
export async function renamePlaylist(id, name) {
  const { error } = await sb.from('playlists').update({ name }).eq('id', id);
  if (error) throw error;
}
export async function deletePlaylist(id) {
  const { error } = await sb.from('playlists').delete().eq('id', id);
  if (error) throw error;
}
export async function addToPlaylist(playlistId, trackId, position) {
  const { error } = await sb.from('playlist_tracks')
    .upsert({ playlist_id: playlistId, track_id: trackId, position });
  if (error) throw error;
}
export async function removeFromPlaylist(playlistId, trackId) {
  const { error } = await sb.from('playlist_tracks')
    .delete().eq('playlist_id', playlistId).eq('track_id', trackId);
  if (error) throw error;
}
/** Persist a full reorder: ids in their new order. */
export async function reorderPlaylist(playlistId, orderedIds) {
  const rows = orderedIds.map((track_id, i) =>
    ({ playlist_id: playlistId, track_id, position: i }));
  const { error } = await sb.from('playlist_tracks').upsert(rows);
  if (error) throw error;
}

/* ---------------- mashup-artist pages (bios) ----------------
 * Table: artist_pages (key = normalized mashup-artist name). Public read;
 * admins can edit any page, artists can edit the page matching their
 * display_name (enforced by RLS — see supabase/artist-pages.sql).
 * Degrades gracefully: if the table doesn't exist yet, pages just have
 * no bio and the section still works. */
export async function fetchArtistPages() {
  try {
    const { data, error } = await sb.from('artist_pages').select('key, name, bio, youtube');
    if (error) throw error;
    return Object.fromEntries(data.map((r) => [r.key, r]));
  } catch { return {}; }
}
export async function saveArtistPage(key, name, bio, youtube) {
  const { error } = await sb.from('artist_pages').upsert({
    key, name, bio: bio || null, youtube: youtube || null,
    updated_by: user().id, updated_at: new Date().toISOString(),
  });
  if (error) throw error;
}

/* ---------------- artist submissions ---------------- */
/** Upload a media file to storage; returns its public URL. */
export async function uploadMedia(file, onProgress) {
  const path = `${user().id}/${Date.now()}-${file.name.replace(/[^\w.\-]+/g, '_')}`;
  const { error } = await sb.storage.from('mashups').upload(path, file, {
    cacheControl: '31536000', upsert: false,
  });
  if (error) throw error;
  if (onProgress) onProgress(1);
  const { data } = sb.storage.from('mashups').getPublicUrl(path);
  return data.publicUrl;
}

/** Insert a submission (status forced to 'pending' by RLS for non-admins). */
export async function submitTrack(entry) {
  const id = entry.id || slugId(entry.displayTitle);
  const { error } = await sb.from('tracks').insert({
    id, owner: user().id,
    status: isAdmin() ? (entry._status || 'pending') : 'pending',
    data: stripPrivate({ ...entry, id }),
  });
  if (error) throw error;
  return id;
}

/** Owner edits their OWN track (any status). RLS restricts this to the
 *  track's owner, and a status-guard trigger keeps `status` unchanged — so an
 *  artist adding a video to their already-approved track stays live, no
 *  re-review, and can never self-approve a pending/rejected one. */
export async function updateOwnTrack(id, entry) {
  const { error } = await sb.from('tracks')
    .update({ data: stripPrivate({ ...entry, id }) }).eq('id', id);
  if (error) throw error;
}

export function slugId(title) {
  const base = (title || 'untitled').toLowerCase().normalize('NFKD')
    .replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return `sub-${base}-${Math.random().toString(36).slice(2, 7)}`;
}

/* ---------------- admin ---------------- */
export async function adminListByStatus(status) {
  const { data, error } = await sb.from('tracks')
    .select('id, owner, status, data, created_at, profiles:owner ( display_name, youtube_channel )')
    .eq('status', status).order('created_at', { ascending: false });
  if (error) throw error;
  return data;
}
export async function adminSetStatus(id, status) {
  const { error } = await sb.from('tracks').update({ status }).eq('id', id);
  if (error) throw error;
}
export async function adminUpdateTrack(id, entry) {
  const { error } = await sb.from('tracks')
    .update({ data: stripPrivate({ ...entry, id }) }).eq('id', id);
  if (error) throw error;
}
export async function adminDeleteTrack(id) {
  const { error } = await sb.from('tracks').delete().eq('id', id);
  if (error) throw error;
}

/** Bulk import of data/catalog.json, attributed to the signed-in admin. */
export async function adminImportCatalog(entries, onProgress) {
  const uid = user().id;
  const batchSize = 200;
  let done = 0;
  for (let i = 0; i < entries.length; i += batchSize) {
    const batch = entries.slice(i, i + batchSize).map((e) => ({
      id: e.id, owner: uid, status: 'approved', data: stripPrivate(e),
    }));
    const { error } = await sb.from('tracks').upsert(batch);
    if (error) throw error;
    done += batch.length;
    if (onProgress) onProgress(done, entries.length);
  }
  return done;
}

/* strip client-only fields (underscore-prefixed) before writing */
function stripPrivate(entry) {
  const out = {};
  for (const [k, v] of Object.entries(entry)) if (!k.startsWith('_')) out[k] = v;
  return out;
}
