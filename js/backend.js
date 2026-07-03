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

export async function init() {
  if (!enabled()) return null;
  if (sb) return sb;
  const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
  sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const { data } = await sb.auth.getSession();
  session = data.session || null;
  if (session) await loadProfile();
  sb.auth.onAuthStateChange(async (_ev, s) => {
    session = s || null;
    profile = null;
    if (session) await loadProfile();
    authListeners.forEach((f) => f(user(), profile));
  });
  return sb;
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

/** Google OAuth — redirects away and back; session is picked up on return. */
export async function signInWithGoogle() {
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
      .select('id, owner, status, data')
      .order('id')
      .range(from, from + page - 1);
    if (error) throw error;
    for (const row of data) out.push({ ...row.data, id: row.id, _status: row.status, _owner: row.owner });
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
