/**
 * app.js — UI: views (Library / Browse / Explorer / Liked), track rows, queue drawer,
 * mini + full player, theme toggle, ambient background, YouTube video toggle.
 */
import { loadCatalog, all, get, search, searchNodes, getNode, nodesOfTrack, nodesByKind, mashupArtists, albumsByYear, specialAlbums, relatedTo, norm } from './catalog.js';
import * as player from './player.js';
import * as viz from './visualizer.js';
import * as backend from './backend.js';
import * as artwork from './artwork.js';
import { APK_URL } from './config.js';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

/* ---------------- svg sprites ---------------- */
const I = {
  play: '<svg viewBox="0 0 24 24" class="play-i"><path d="M8 5v14l11-7z"/></svg>',
  pause: '<svg viewBox="0 0 24 24" class="pause-i"><path d="M6 5h4v14H6zM14 5h4v14h-4z"/></svg>',
  heart: '<svg viewBox="0 0 24 24"><path d="M12 21c-4.8-3.6-9-6.9-9-11a5 5 0 0 1 9-3 5 5 0 0 1 9 3c0 4.1-4.2 7.4-9 11z"/></svg>',
  prev: '<svg viewBox="0 0 24 24"><path d="M6 6h2v12H6zM20 6v12L9.5 12z"/></svg>',
  next: '<svg viewBox="0 0 24 24"><path d="M16 6h2v12h-2zM4 6v12l10.5-6z"/></svg>',
  shuffle: '<svg viewBox="0 0 24 24"><path d="M17 4h4v4h-2V6.4l-4.6 4.6-1.4-1.4L17.6 5H17V4zm4 12v4h-4v-1h.6l-3.6-3.6 1.4-1.4L19 17.6V16h2zM3 6h4.2l3.2 3.2-1.4 1.4L6.2 8H3V6zm8.6 6.4 1.4 1.4L7.2 20H3v-2h3.2l5.4-5.6z"/></svg>',
  repeat: '<svg viewBox="0 0 24 24"><path d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z"/></svg>',
  queue: '<svg viewBox="0 0 24 24"><path d="M3 6h13v2H3zm0 5h13v2H3zm0 5h9v2H3zm15-3v-7h2v7h3l-4 4-4-4h3z"/></svg>',
  down: '<svg viewBox="0 0 24 24"><path d="M12 15.5 4.5 8l1.4-1.4L12 12.7l6.1-6.1L19.5 8z"/></svg>',
  close: '<svg viewBox="0 0 24 24"><path d="m6.4 5 5.6 5.6L17.6 5 19 6.4 13.4 12l5.6 5.6-1.4 1.4-5.6-5.6L6.4 19 5 17.6 10.6 12 5 6.4z"/></svg>',
  sun: '<svg viewBox="0 0 24 24"><path d="M12 17a5 5 0 1 1 0-10 5 5 0 0 1 0 10zm0-15h0l1 3h-2l1-3zm0 20 1-3h-2l1 3zM2 12l3-1v2l-3-1zm20 0-3 1v-2l3 1zM4.9 4.9l2.8 1.4-1.4 1.4L4.9 4.9zm14.2 14.2-2.8-1.4 1.4-1.4 1.4 2.8zM4.9 19.1l1.4-2.8 1.4 1.4-2.8 1.4zM19.1 4.9l-1.4 2.8-1.4-1.4 2.8-1.4z"/></svg>',
  moon: '<svg viewBox="0 0 24 24"><path d="M21 14.5A8.5 8.5 0 0 1 9.5 3 8.5 8.5 0 1 0 21 14.5z"/></svg>',
  video: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M4 5h12a2 2 0 0 1 2 2v2.5l4-2.5v10l-4-2.5V17a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z"/></svg>',
  audio: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 3a5 5 0 0 0-5 5v4a5 5 0 0 0 10 0V8a5 5 0 0 0-5-5zm-7 9a7 7 0 0 0 14 0h2a9 9 0 0 1-8 8.94V23h-2v-2.06A9 9 0 0 1 3 12h2z"/></svg>',
};

/* ---------------- state ---------------- */
const LIKES_KEY = 'bmtm.likes.v1';
let likes = new Set();
try { likes = new Set(JSON.parse(localStorage.getItem(LIKES_KEY) || '[]')); } catch {}
const saveLikes = () => localStorage.setItem(LIKES_KEY, JSON.stringify([...likes]));

/* local play history: simple id -> count map. (Prompt 2 note: when accounts
   arrive, this map is the thing that syncs to the server — keep it flat.) */
const PLAYS_KEY = 'bmtm.plays.v1';
let plays = {};
try { plays = JSON.parse(localStorage.getItem(PLAYS_KEY) || '{}') || {}; } catch {}
const bumpPlay = (id) => {
  plays[id] = (plays[id] || 0) + 1;
  localStorage.setItem(PLAYS_KEY, JSON.stringify(plays));
  if (backend.user()) backend.syncPlays({ [id]: plays[id] }).catch(() => {});
};

/* recently played (ordered, newest first) — drives the Home page */
const RECENTS_KEY = 'bmtm.recent.v1';
let recents = [];
try { recents = JSON.parse(localStorage.getItem(RECENTS_KEY) || '[]') || []; } catch {}
const bumpRecent = (id) => {
  recents = [id, ...recents.filter((x) => x !== id)].slice(0, 30);
  localStorage.setItem(RECENTS_KEY, JSON.stringify(recents));
};

/* ---------------- account state (synced when signed in) ---------------- */
let playlists = [];          // [{id, name, isPublic, trackIds:[]}]
let openPlaylist = null;     // playlist currently open in the Playlists view
let pendingAdd = null;       // track id waiting for "add to playlist" choice

function setAuthUi() {
  const u = backend.user();
  document.body.classList.toggle('cloud', backend.enabled());
  document.body.classList.toggle('authed', !!u);
  document.body.classList.toggle('artist', backend.isArtist());
  document.body.classList.toggle('admin', backend.isAdmin());
  $('#account').classList.toggle('hidden', !backend.enabled());
  $('#account').classList.toggle('on', !!u);
}

/** Called on sign-in / sign-out: pull server likes, playlists, plays. */
async function syncAccountState() {
  setAuthUi();
  // Google OAuth lands back here with the dialog still open (native app) or
  // after a redirect (web) — close it / confirm so it's clear you're in.
  const su = backend.user();
  if (su) {
    const dlg = $('#auth-dlg');
    if (dlg?.open) { dlg.close(); toast('✓ Signed in'); }
    else if (sessionStorage.getItem('bmtm.oauth')) {
      toast('✓ Signed in as ' + (backend.getProfile()?.display_name || su.email));
    }
    sessionStorage.removeItem('bmtm.oauth');
  }
  if (!backend.user()) { playlists = []; openPlaylist = null; rerender(); return; }
  try {
    // one-time merge of pre-account local likes into the server
    const mergeFlag = 'bmtm.merged.' + backend.user().id;
    if (!localStorage.getItem(mergeFlag)) {
      await backend.mergeLikes([...likes]);
      await backend.syncPlays(plays);
      localStorage.setItem(mergeFlag, '1');
    }
    likes = new Set(await backend.fetchLikes());
    saveLikes();
    const serverPlays = await backend.fetchPlays();
    for (const [id, n] of Object.entries(serverPlays)) plays[id] = Math.max(plays[id] || 0, n);
    localStorage.setItem(PLAYS_KEY, JSON.stringify(plays));
    playlists = await backend.fetchPlaylists();
  } catch (e) { console.warn('account sync failed', e); }
  rerender();
}

function rerender() {
  if (view === 'home') renderHome();
  else if (view === 'playlists') renderPlaylists();
  else if (view === 'browse') renderBrowse();
  else if (view === 'account') renderAccount();
  else if (view === 'artists') renderArtistsView();
  else if (view !== 'explorer') renderLibrary();
}

function toggleLike(id) {
  const had = likes.has(id);
  had ? likes.delete(id) : likes.add(id);
  saveLikes();
  if (backend.user()) (had ? backend.removeLike(id) : backend.addLike(id)).catch(() => {});
  return !had;
}

let view = 'library';
let sort = 'new';
let browseAlbum = null;      // currently open album on the Browse page
let visible = [];            // tracks currently listed (drives play-context + shuffle-all)
let expPath = [];            // explorer column path [nodeKey,...]
let artistPages = {};        // norm(name) -> { name, bio, youtube } from Supabase
let artistNav = null;        // null = grid, or the open mashup-artist key ('ma:...')

/* ---------------- theme + ambient ---------------- */
const THEME_KEY = 'bmtm.theme';
function setTheme(t) {
  document.documentElement.dataset.theme = t;
  localStorage.setItem(THEME_KEY, t);
  $('#theme-icon').innerHTML = t === 'dark' ? I.sun : I.moon;
}
window.addEventListener('pointermove', (e) => {
  const mx = e.clientX / innerWidth - 0.5, my = e.clientY / innerHeight - 0.5;
  document.documentElement.style.setProperty('--mx', mx.toFixed(3));
  document.documentElement.style.setProperty('--my', my.toFixed(3));
}, { passive: true });

/* ---------------- rendering: track rows ---------------- */
function songsSummary(t) {
  if (!t.sourceSongs?.length) return t.mashupArtist;
  const parts = t.sourceSongs.map((s) => s.title ? `${s.artist} – ${s.title}` : s.artist).filter(Boolean);
  return parts.join('  ×  ');
}

function canEditTrack(t) {
  if (backend.isAdmin()) return 'admin';
  if (backend.isArtist() && t._owner && t._owner === backend.user()?.id) return 'own';
  return null;
}

function rowHtml(t, i) {
  const liked = likes.has(t.id);
  const cur = player.current()?.id === t.id;
  const edit = canEditTrack(t);
  return `<div class="trow lib${cur ? ' current' : ''}${cur && !player.audio.paused ? ' playing' : ''}" data-id="${t.id}" data-i="${i}">
    <div class="num">${i + 1}</div>
    <div class="tmain">
      <div class="ttitle">${esc(t.displayTitle)}</div>
      <div class="tsub">${esc(songsSummary(t))}</div>
    </div>
    <div class="tyear">${t.year || ''}${!t.audio ? ' <span class="badge video">embed</span>' : ''}${t._status === 'pending' ? ' <span class="badge pending">pending</span>' : ''}</div>
    <div class="rowbtns">
      ${edit ? `<button class="editbtn" data-editkind="${edit}" title="Edit this track"><svg viewBox="0 0 24 24"><path d="M3 17.25V21h3.75L17.8 9.94l-3.75-3.75L3 17.25zM20.7 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg></button>` : ''}
      <button class="qaddbtn" title="Add to queue"><svg viewBox="0 0 24 24"><path d="M3 6h13v2H3zm0 5h13v2H3zm0 5h7v2H3zm14 0v-4h2v4h4v2h-4v4h-2v-4h-4v-2h4z"/></svg></button>
      <button class="plusbtn authonly" title="Add to playlist"><svg viewBox="0 0 24 24"><path d="M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6z"/></svg></button>
      <button class="heartbtn${liked ? ' liked' : ''}" title="Save to Liked">${I.heart}</button>
      <button class="rowplay" title="Play">${I.play}${I.pause}</button>
    </div>
  </div>`;
}
const esc = (s) => (s || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function sortTracks(list) {
  const l = [...list];
  if (sort === 'new') l.sort((a, b) => (b.year || '0') > (a.year || '0') ? 1 : (b.year || '0') < (a.year || '0') ? -1 : a.displayTitle.localeCompare(b.displayTitle));
  if (sort === 'old') l.sort((a, b) => (a.year || '9') > (b.year || '9') ? 1 : (a.year || '9') < (b.year || '9') ? -1 : a.displayTitle.localeCompare(b.displayTitle));
  if (sort === 'az') l.sort((a, b) => a.displayTitle.localeCompare(b.displayTitle));
  if (sort === 'za') l.sort((a, b) => b.displayTitle.localeCompare(a.displayTitle));
  return l;
}

function renderLibrary() {
  const q = $('#search').value;
  let list = view === 'liked' ? all().filter((t) => likes.has(t.id)) : search(q);
  if (view === 'liked' && q) list = list.filter((t) => search(q).includes(t));
  list = sortTracks(list);
  visible = list;
  $('#lib-title').textContent = view === 'liked' ? 'Liked' : (q ? 'Results' : 'Library');
  $('#lib-count').textContent = `${list.length} mashup${list.length === 1 ? '' : 's'}`;
  const el = $('#tracklist');
  el.innerHTML = list.length
    ? list.map(rowHtml).join('')
    : `<div class="empty">${view === 'liked' ? 'Nothing liked yet — tap the heart on any track.' : 'No matches. Try another search.'}</div>`;
}

/* row interactions (delegated) */
$('#view-library').addEventListener('click', onRowClick);
function onRowClick(e) {
  const row = e.target.closest('.trow'); if (!row) return;
  const id = row.dataset.id;
  if (e.target.closest('.qaddbtn')) {
    player.enqueue(id);
    toast('Added to queue');
    return;
  }
  const eb = e.target.closest('.editbtn');
  if (eb) {
    location.href = eb.dataset.editkind === 'admin'
      ? 'admin.html?edit=' + encodeURIComponent(id)
      : 'submit.html#edit=' + encodeURIComponent(id);
    return;
  }
  if (e.target.closest('.heartbtn')) {
    toggleLike(id);
    e.target.closest('.heartbtn').classList.toggle('liked');
    if (view === 'liked') renderLibrary();
    return;
  }
  if (e.target.closest('.plusbtn')) {
    openAddToPlaylist(id);
    return;
  }
  if (e.target.closest('.rowplay')) {
    const cur = player.current();
    if (cur?.id === id) { player.toggle(); return; }
    const idx = visible.findIndex((t) => t.id === id);
    player.playNow(visible.map((t) => t.id), idx);
    openFullPlayer();
    return;
  }
  // click elsewhere on row = play too (Spotify-ish double affordance kept simple)
  const idx = visible.findIndex((t) => t.id === id);
  player.playNow(visible.map((t) => t.id), idx);
}

/* ---------------- explorer (single-column drill-down) ----------------
   Flow (per Ian): pick an artist/song -> the screen lists the MASHUPS it
   appears in -> tap a mashup to play it and see the OTHER songs inside ->
   tap one of those to keep walking the web. One screen at a time, with a
   back step + breadcrumb (also driven by the Android hardware back button).
   expPath is a stack: node keys ('a:..'/'s:..') or track refs ('t:<id>'). */
const expSearch = $('#exp-search'), expSugg = $('#exp-sugg'), colsEl = $('#columns');
colsEl.classList.add('solo');

expSearch.addEventListener('input', () => {
  const res = searchNodes(expSearch.value);
  expSugg.innerHTML = res.map((n) =>
    `<button data-key="${esc(n.key)}"><span class="kind">${n.kind}</span><span>${esc(n.name)}</span><span class="cnt" style="margin-left:auto;color:var(--text-dim);font-size:11px">${n.trackIds.size}</span></button>`).join('');
  expSugg.classList.toggle('hidden', !res.length);
});
expSugg.addEventListener('click', (e) => {
  const b = e.target.closest('button[data-key]'); if (!b) return;
  expPath = [b.dataset.key];
  expSugg.classList.add('hidden');
  expSearch.value = '';
  renderExplorer();
});
document.addEventListener('click', (e) => {
  if (!e.target.closest('.exp-searchwrap')) expSugg.classList.add('hidden');
});

function expEntryName(entry) {
  if (entry.startsWith('t:')) return get(entry.slice(2))?.displayTitle || 'mashup';
  return getNode(entry)?.name || '';
}

/* Mashup rows in the Explorer: the play button PLAYS, the chevron opens a
   preview dropdown (Artists / Songs broken out) so you can see what's inside
   — and keep exploring from there — before anything starts playing. */
const expOpen = new Set();  // track ids with their dropdown expanded

function expTrackRowHtml(t) {
  const cur = player.current()?.id === t.id, playing = cur && !player.audio.paused;
  const open = expOpen.has(t.id);
  const inside = nodesOfTrack(t.id);
  const artists = inside.filter((n) => n.kind === 'artist');
  const songs = inside.filter((n) => n.kind === 'song');
  const linkHtml = (n) => `<button class="vialink" data-key="${esc(n.key)}">
      <span>${esc(n.name)}</span>
      <span class="vcnt">${n.trackIds.size} mashup${n.trackIds.size === 1 ? '' : 's'} ›</span>
    </button>`;
  return `<div class="conn exptrack${cur ? ' sel' : ''}${open ? ' open' : ''}" data-track="${esc(t.id)}">
    <div class="head">
      <button class="tplay" data-play="${esc(t.id)}" title="${playing ? 'Pause' : 'Play this mashup'}">${playing ? I.pause : I.play}</button>
      <span class="nm">${esc(t.displayTitle)}</span>
      <span class="cnt">${t.year || ''}</span>
      <button class="tmore" title="See the artists & songs inside">▾</button>
    </div>
    <div class="via">
      ${artists.length ? `<div class="viagrp">Artists</div>${artists.map(linkHtml).join('')}` : ''}
      ${songs.length ? `<div class="viagrp">Songs</div>${songs.map(linkHtml).join('')}` : ''}
      ${!inside.length ? '<div class="dhint">No song data for this mashup yet.</div>' : ''}
    </div>
  </div>`;
}

function expNodeRowHtml(n) {
  return `<div class="conn" data-key="${esc(n.key)}">
    <button class="head">
      <span class="nm">${esc(n.name)}</span>
      <span class="knd">${n.kind}</span>
      <span class="cnt">${n.trackIds.size} ›</span>
    </button>
  </div>`;
}

function expBreadcrumb() {
  if (expPath.length <= 1) return '';
  return `<div class="exp-crumbs">${expPath.map((e, i) =>
    `<button class="crumb" data-depth="${i}">${esc(expEntryName(e))}</button>`)
    .join('<span class="sep">›</span>')}</div>`;
}

/** Popular starting points shown when the Explorer is empty. */
function renderExplorerStart() {
  const top = nodesByKind('artist')
    .map((n) => ({ key: n.key, name: n.name, count: n.trackIds.size }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, 40);
  colsEl.innerHTML = `<div class="col full" data-depth="0">
    <header><div class="kind">start here</div><h3>Popular artists</h3>
    <div class="meta">Pick an artist — or search above — to see every mashup it appears in</div></header>
    <div class="items">${top.map((n) => `<div class="conn" data-key="${esc(n.key)}">
      <button class="head"><span class="nm">${esc(n.name)}</span><span class="cnt">${n.count} ›</span></button>
    </div>`).join('') || '<div class="empty" style="padding:24px 10px">Search for a song or artist above to begin.</div>'}</div>
  </div>`;
}

function renderExplorer() {
  if (!expPath.length) return renderExplorerStart();
  const depth = expPath.length - 1;
  const entry = expPath[depth];
  let inner;
  if (entry.startsWith('t:')) {
    const t = get(entry.slice(2));
    if (!t) { expPath.pop(); return renderExplorer(); }
    const cameFrom = expPath[depth - 1];
    const inside = nodesOfTrack(t.id).filter((n) => n.key !== cameFrom);
    const cur = player.current()?.id === t.id, playing = cur && !player.audio.paused;
    inner = `<div class="col full" data-depth="${depth}">
      <header>
        <div class="chead">
          ${depth ? '<button class="expback" title="Back">‹</button>' : ''}
          <div class="kind">mashup</div>
          <button class="expplay${playing ? ' on' : ''}" data-play="${esc(t.id)}" title="Play this mashup">${playing ? I.pause : I.play}</button>
        </div>
        <h3>${esc(t.displayTitle)}</h3>
        <div class="meta">${esc(t.mashupArtist || '')}${t.year ? ' · ' + t.year : ''} · tap a song to keep exploring</div>
      </header>
      <div class="items">${inside.map(expNodeRowHtml).join('')
        || '<div class="empty" style="padding:24px 10px">No song data for this mashup yet.</div>'}</div>
    </div>`;
  } else {
    const node = getNode(entry);
    if (!node) { expPath.pop(); return renderExplorer(); }
    const list = sortTracks([...node.trackIds].map(get).filter(Boolean));
    inner = `<div class="col full" data-depth="${depth}">
      <header>
        <div class="chead">
          ${depth ? '<button class="expback" title="Back">‹</button>' : ''}
          <div class="kind">${node.kind}</div>
        </div>
        <h3>${esc(node.name)}</h3>
        <div class="meta">in ${list.length} mashup${list.length === 1 ? '' : 's'} — ▶ plays it, tapping the row shows the artists &amp; songs inside</div>
      </header>
      <div class="items">${list.map(expTrackRowHtml).join('')}</div>
    </div>`;
  }
  colsEl.innerHTML = expBreadcrumb() + inner;
}

/** Used by the hardware back button: step up one level. Returns true if it did. */
function explorerBack() {
  if (view !== 'explorer' || !expPath.length) return false;
  expPath.pop();
  renderExplorer();
  return true;
}

colsEl.addEventListener('click', (e) => {
  if (e.target.closest('.expback')) { expPath.pop(); expOpen.clear(); renderExplorer(); return; }
  const crumb = e.target.closest('.crumb');
  if (crumb) { expPath = expPath.slice(0, +crumb.dataset.depth + 1); expOpen.clear(); renderExplorer(); return; }
  const playBtn = e.target.closest('.expplay');
  if (playBtn) {
    const id = playBtn.dataset.play;
    if (player.current()?.id === id) player.toggle();
    else { visible = [get(id)].filter(Boolean); player.playNow([id], 0); openFullPlayer(); }
    renderExplorer();
    return;
  }
  // play button on a mashup row: play it (queue = this screen), stay here
  const tplay = e.target.closest('.tplay');
  if (tplay) {
    const id = tplay.dataset.play;
    if (player.current()?.id === id) { player.toggle(); renderExplorer(); return; }
    const colIds = $$('.conn[data-track]', colsEl).map((c) => c.dataset.track);
    visible = colIds.map(get).filter(Boolean);
    player.playNow(colIds, colIds.indexOf(id));
    renderExplorer();
    return;
  }
  // artist/song inside the preview dropdown: keep walking the web
  const via = e.target.closest('.vialink');
  if (via?.dataset.key) {
    expPath = [...expPath, via.dataset.key];
    expOpen.clear();
    renderExplorer();
    return;
  }
  const conn = e.target.closest('.conn'); if (!conn) return;
  if (conn.dataset.track) {
    // tap the row (or its chevron) = toggle the what's-inside preview
    const id = conn.dataset.track;
    expOpen.has(id) ? expOpen.delete(id) : expOpen.add(id);
    conn.classList.toggle('open', expOpen.has(id));
  } else if (conn.dataset.key) {
    expPath = [...expPath, conn.dataset.key];
    expOpen.clear();
    renderExplorer();
  }
});

/* ---------------- browse: albums + recommendations ---------------- */
const browseEl = $('#view-browse');

function albumCardHtml(a, i) {
  const n = a.tracks.length;
  return `<button class="albumcard" data-album="${esc(a.key)}" style="--hue:${(i * 47) % 360}deg;--d:${Math.min(i * 35, 420)}ms">
    <div class="art"><span>${esc(a.name)}</span></div>
    <div class="anm">${esc(a.name)}</div>
    <div class="acnt">${n} mashup${n === 1 ? '' : 's'}</div>
  </button>`;
}

function recCardHtml(t, i) {
  return `<button class="reccard" data-id="${esc(t.id)}" style="--hue:${(hashHue(t.id))}deg;--d:${Math.min(i * 30, 360)}ms">
    <div class="rart">${I.play}</div>
    <div class="rt">${esc(t.displayTitle)}</div>
    <div class="rs">${esc(songsSummary(t))}</div>
  </button>`;
}
function hashHue(s) { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) % 360; return h; }

/* "Because you liked/played [X]" rows — seeds come from Likes + local play
   history; related tracks come straight from the Explorer's co-occurrence
   index via relatedTo(). */
function recommendationRows(maxRows = 3) {
  const likeQ = [...likes].reverse().map((id) => ({ id, why: 'liked' }));
  const playQ = Object.entries(plays).filter(([, n]) => n >= 2)
    .sort((a, b) => b[1] - a[1]).map(([id]) => ({ id, why: 'played' }));
  const cands = [];
  for (let i = 0; i < Math.max(likeQ.length, playQ.length); i++) {
    if (likeQ[i]) cands.push(likeQ[i]);
    if (playQ[i]) cands.push(playQ[i]);
  }
  const rows = [], seen = new Set();
  for (const c of cands) {
    if (rows.length >= maxRows) break;
    if (seen.has(c.id) || !get(c.id)) continue;
    seen.add(c.id);
    const rel = relatedTo(c.id, 12).map((r) => r.track).filter(Boolean);
    if (rel.length >= 3) rows.push({ seed: get(c.id), why: c.why, tracks: rel });
  }
  return rows;
}

function renderBrowse() {
  if (browseAlbum) return renderAlbumDetail();
  const years = albumsByYear();
  const specials = specialAlbums();
  const recs = recommendationRows();
  browseEl.innerHTML = `
    <div class="listhead"><h1>Browse</h1></div>
    ${recs.map((r) => `
      <section class="brsec">
        <h2 class="brh">Because you ${r.why} <em>${esc(r.seed.displayTitle)}</em></h2>
        <div class="reccards">${r.tracks.map(recCardHtml).join('')}</div>
      </section>`).join('')}
    ${recs.length ? '' : '<div class="brhint">Recommended-for-you rows appear here once you like or replay a few tracks.</div>'}
    ${specials.length ? `<section class="brsec">
      <h2 class="brh">Special Collections</h2>
      <div class="albumgrid">${specials.map(albumCardHtml).join('')}</div>
    </section>` : ''}
    ${years.length ? `<section class="brsec">
      <h2 class="brh">By Year</h2>
      <div class="albumgrid">${years.map(albumCardHtml).join('')}</div>
    </section>` : ''}`;
}

function renderAlbumDetail() {
  const a = browseAlbum;
  const list = sortTracks(a.tracks);
  visible = list;
  browseEl.innerHTML = `
    <div class="listhead">
      <button class="chip" id="br-back">‹ Browse</button>
      <h1>${esc(a.name)}</h1>
      <span class="count">${list.length} mashup${list.length === 1 ? '' : 's'}</span>
      <span class="spacer"></span>
      <button class="chip" id="br-playall">▶ Play all</button>
    </div>
    <div class="tracklist">${list.map(rowHtml).join('')}</div>`;
}

browseEl.addEventListener('click', (e) => {
  if (e.target.closest('#br-back')) { browseAlbum = null; renderBrowse(); return; }
  if (e.target.closest('#br-playall')) {
    if (visible.length) { player.playNow(visible.map((t) => t.id), 0); openFullPlayer(); }
    return;
  }
  const card = e.target.closest('.albumcard');
  if (card) {
    const a = [...specialAlbums(), ...albumsByYear()].find((x) => x.key === card.dataset.album);
    if (a) { browseAlbum = a; renderAlbumDetail(); }
    return;
  }
  const rec = e.target.closest('.reccard');
  if (rec) {
    const ids = $$('.reccard', rec.closest('.reccards')).map((c) => c.dataset.id);
    visible = ids.map(get).filter(Boolean);
    player.playNow(ids, ids.indexOf(rec.dataset.id));
    openFullPlayer();
    return;
  }
  onRowClick(e); // album track rows reuse the library row behaviour
});

/* ---------------- mashup artists: profile pages with bios ---------------- */
const artistsEl = $('#view-artists');
const maKey = (name) => norm(name);                  // DB key (no prefix)

function canEditArtistPage(name) {
  if (backend.isAdmin()) return true;
  const p = backend.getProfile();
  return backend.isArtist() && (p?.display_name || '').toLowerCase() === (name || '').toLowerCase();
}

function renderArtistsView() {
  if (artistNav) return renderArtistDetail();
  const list = mashupArtists().sort((a, b) => b.tracks.length - a.tracks.length || a.name.localeCompare(b.name));
  artistsEl.innerHTML = `
    <div class="listhead">
      <h1>Mashup Artists</h1>
      <span class="count">${list.length}</span>
      <span class="spacer"></span>
      <input class="catfilter" id="ma-filter" type="search" placeholder="Filter artists…" autocomplete="off">
    </div>
    <div class="albumgrid">${list.map((a, i) => {
      const page = artistPages[maKey(a.name)];
      return `<button class="albumcard macard" data-ma="${esc(a.key)}" data-name="${esc(a.name)}" style="--hue:${hashHue(a.name)}deg;--d:${Math.min(i * 30, 420)}ms">
        <div class="art"><span>${esc(a.name)}</span></div>
        <div class="anm">${esc(a.name)}</div>
        <div class="acnt">${a.tracks.length} mashup${a.tracks.length === 1 ? '' : 's'}${page?.bio ? ' · bio' : ''}</div>
      </button>`;
    }).join('')}</div>`;
  const fi = $('#ma-filter');
  fi.addEventListener('input', () => {
    const q = norm(fi.value);
    $$('.macard', artistsEl).forEach((el) =>
      el.classList.toggle('hidden', !!q && !norm(el.dataset.name).includes(q)));
  });
  fillArtistCardArt();
}

/** Try real photos on the artist cards (many mashup artists exist on Deezer). */
function fillArtistCardArt() {
  $$('.macard', artistsEl).slice(0, 60).forEach((card) => {
    artwork.artistImage(card.dataset.name).then((u) => {
      if (!u || !card.isConnected) return;
      const art = $('.art', card);
      art.style.background = `url('${u.replace(/'/g, '%27')}') center/cover`;
      art.style.filter = 'none';
      $('span', art).style.opacity = '0';
    }).catch(() => {});
  });
}

function renderArtistDetail() {
  const a = mashupArtists().find((x) => x.key === artistNav);
  if (!a) { artistNav = null; return renderArtistsView(); }
  const page = artistPages[maKey(a.name)];
  const list = sortTracks(a.tracks);
  visible = list;
  artistsEl.innerHTML = `
    <div class="listhead">
      <button class="chip" id="ma-back">‹ Artists</button>
      <h1>${esc(a.name)}</h1>
      <span class="count">${list.length} mashup${list.length === 1 ? '' : 's'}</span>
      <span class="spacer"></span>
      <button class="chip" id="ma-playall">▶ Play all</button>
      ${page?.youtube ? `<a class="chip" href="${esc(page.youtube)}" target="_blank" rel="noopener">▶ YouTube</a>` : ''}
      ${canEditArtistPage(a.name) ? `<button class="chip" id="ma-edit" data-name="${esc(a.name)}">✎ Edit page</button>` : ''}
    </div>
    ${page?.bio ? `<div class="acct-card"><div class="sub" style="margin:0;white-space:pre-wrap">${esc(page.bio)}</div></div>`
      : `<div class="brhint">${canEditArtistPage(a.name) ? 'No bio yet — tap “Edit page” to write one.' : ''}</div>`}
    <div class="tracklist">${list.map(rowHtml).join('')}</div>`;
}

artistsEl.addEventListener('click', (e) => {
  if (e.target.closest('#ma-back')) { artistNav = null; renderArtistsView(); return; }
  if (e.target.closest('#ma-playall')) {
    if (visible.length) { player.playNow(visible.map((t) => t.id), 0); openFullPlayer(); }
    return;
  }
  const ed = e.target.closest('#ma-edit');
  if (ed) { openBioDlg(ed.dataset.name); return; }
  const card = e.target.closest('.macard');
  if (card) { artistNav = card.dataset.ma; renderArtistDetail(); return; }
  onRowClick(e); // track rows reuse the library row behaviour
});

/* bio editor dialog */
const bioDlg = $('#bio-dlg');
let bioEditing = null;
function openBioDlg(name) {
  bioEditing = name;
  const page = artistPages[maKey(name)];
  $('#bio-who').textContent = name;
  $('#bio-text').value = page?.bio || '';
  $('#bio-yt').value = page?.youtube || '';
  $('#bio-err').classList.add('hidden');
  bioDlg.showModal();
}
$('#bio-cancel').addEventListener('click', () => bioDlg.close());
$('#bio-save').addEventListener('click', async () => {
  const err = $('#bio-err');
  err.classList.add('hidden');
  const yt = $('#bio-yt').value.trim();
  if (yt && !/^https?:\/\//.test(yt)) { err.textContent = 'The YouTube link should start with https://'; err.classList.remove('hidden'); return; }
  try {
    $('#bio-save').disabled = true;
    await backend.saveArtistPage(maKey(bioEditing), bioEditing, $('#bio-text').value.trim(), yt);
    artistPages[maKey(bioEditing)] = { key: maKey(bioEditing), name: bioEditing, bio: $('#bio-text').value.trim() || null, youtube: yt || null };
    bioDlg.close();
    toast('Artist page saved');
    if (view === 'artists') renderArtistsView();
  } catch (e2) {
    err.textContent = e2?.message || 'Could not save (has the artist_pages table been created?)';
    err.classList.remove('hidden');
  } finally { $('#bio-save').disabled = false; }
});

/* ---------------- home (Spotify-style landing) ---------------- */
const homeEl = $('#view-home');
let homeNav = null; // null | {cat} | {cat, key, name}

const HOME_CATS = [
  { cat: 'artists', name: 'Artists', unit: 'artist' },
  { cat: 'songs', name: 'Songs', unit: 'song' },
  { cat: 'years', name: 'Years', unit: 'year' },
  { cat: 'mashupArtists', name: 'Mashup Artists', unit: 'mashup artist' },
];

function homeCatItems(cat) {
  const byCount = (a, b) => b.count - a.count || a.name.localeCompare(b.name);
  if (cat === 'artists') return nodesByKind('artist').map((n) => ({ key: n.key, name: n.name, count: n.trackIds.size })).sort(byCount);
  if (cat === 'songs') return nodesByKind('song').map((n) => ({ key: n.key, name: n.name, count: n.trackIds.size })).sort(byCount);
  if (cat === 'years') return albumsByYear().map((a) => ({ key: a.key, name: a.name, count: a.tracks.length }));
  if (cat === 'mashupArtists') return mashupArtists().map((a) => ({ key: a.key, name: a.name, count: a.tracks.length })).sort(byCount);
  return [];
}

function homeItemTracks(cat, key) {
  if (cat === 'artists' || cat === 'songs') {
    const n = getNode(key);
    return n ? [...n.trackIds].map(get).filter(Boolean) : [];
  }
  if (cat === 'years') return albumsByYear().find((a) => a.key === key)?.tracks || [];
  if (cat === 'mashupArtists') return mashupArtists().find((a) => a.key === key)?.tracks || [];
  return [];
}

function renderHome() {
  if (homeNav?.key) return renderHomeTracks();
  if (homeNav?.cat) return renderHomeCategory();
  const recentTracks = recents.map(get).filter(Boolean).slice(0, 12);
  const recs = recommendationRows(2);
  const h = new Date().getHours();
  const greet = h < 5 ? 'Up late?' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
  homeEl.innerHTML = `
    <div class="listhead"><h1>${greet}</h1></div>
    <div class="home-quick">
      <button class="qbtn primary" id="hm-shuffle">⤨ Shuffle all mashups</button>
      <button class="qbtn" id="hm-surprise">✨ Surprise me</button>
      <button class="qbtn" data-cat="__explore">🕸 Explore connections</button>
      ${window.Capacitor?.isNativePlatform?.() ? '' : `<a class="qbtn" href="${APK_URL}" style="text-decoration:none">📱 Get the Android app</a>`}
    </div>
    ${recentTracks.length ? `<section class="brsec">
      <h2 class="brh">Recently played</h2>
      <div class="reccards">${recentTracks.map(recCardHtml).join('')}</div>
    </section>` : ''}
    ${recs.map((r) => `
      <section class="brsec">
        <h2 class="brh">Because you ${r.why} <em>${esc(r.seed.displayTitle)}</em></h2>
        <div class="reccards">${r.tracks.map(recCardHtml).join('')}</div>
      </section>`).join('')}
    <section class="brsec">
      <h2 class="brh">Browse</h2>
      <div class="albumgrid">
        ${HOME_CATS.map((c, i) => {
          const n = homeCatItems(c.cat).length;
          return `<button class="albumcard" data-cat="${c.cat}" style="--hue:${(i * 61 + 20) % 360}deg;--d:${Math.min(i * 35, 420)}ms">
            <div class="art"><span>${c.name}</span></div>
            <div class="anm">${c.name}</div>
            <div class="acnt">${n} ${c.unit}${n === 1 ? '' : 's'}</div>
          </button>`;
        }).join('')}
        <button class="albumcard" data-cat="all" style="--hue:300deg;--d:180ms">
          <div class="art"><span>All</span></div>
          <div class="anm">All mashups</div>
          <div class="acnt">${all().length} mashups</div>
        </button>
      </div>
    </section>
    ${recentTracks.length ? '' : '<div class="brhint">Play a few tracks and your recent plays + recommendations will show up here.</div>'}`;
}

function renderHomeCategory() {
  const cat = HOME_CATS.find((c) => c.cat === homeNav.cat);
  const items = homeCatItems(homeNav.cat);
  homeEl.innerHTML = `
    <div class="listhead">
      <button class="chip" id="hm-back">‹ Home</button>
      <h1>${cat.name}</h1>
      <span class="count">${items.length}</span>
      <span class="spacer"></span>
      <input class="catfilter" id="hm-filter" type="search" placeholder="Filter ${cat.name.toLowerCase()}…" autocomplete="off">
    </div>
    <div class="catlist">${items.map((i) => `
      <button class="catitem" data-key="${esc(i.key)}" data-name="${esc(i.name)}">
        <span class="nm">${esc(i.name)}</span><span class="cnt">${i.count}</span>
      </button>`).join('')}</div>`;
  const fi = $('#hm-filter');
  fi.addEventListener('input', () => {
    const q = norm(fi.value);
    $$('.catitem', homeEl).forEach((el) =>
      el.classList.toggle('hidden', !!q && !norm(el.dataset.name).includes(q)));
  });
  fi.focus();
}

function renderHomeTracks() {
  const cat = HOME_CATS.find((c) => c.cat === homeNav.cat);
  const list = sortTracks(homeItemTracks(homeNav.cat, homeNav.key));
  visible = list;
  homeEl.innerHTML = `
    <div class="listhead">
      <button class="chip" id="hm-back-cat">‹ ${cat.name}</button>
      <h1>${esc(homeNav.name)}</h1>
      <span class="count">${list.length} mashup${list.length === 1 ? '' : 's'}</span>
      <span class="spacer"></span>
      <button class="chip" id="hm-playall">▶ Play all</button>
    </div>
    <div class="tracklist">${list.map(rowHtml).join('')}</div>`;
}

homeEl.addEventListener('click', (e) => {
  if (e.target.closest('#hm-back')) { homeNav = null; renderHome(); return; }
  if (e.target.closest('#hm-back-cat')) { homeNav = { cat: homeNav.cat }; renderHome(); return; }
  if (e.target.closest('#hm-shuffle')) {
    const ids = all().map((t) => t.id);
    if (!ids.length) return;
    player.setShuffle(true); $('#pl-shuffle')?.classList.add('on');
    player.playNow(ids, Math.floor(Math.random() * ids.length));
    openFullPlayer();
    return;
  }
  if (e.target.closest('#hm-surprise')) {
    const ids = all().map((t) => t.id);
    if (!ids.length) return;
    const i = Math.floor(Math.random() * ids.length);
    visible = all(); player.playNow(ids, i); openFullPlayer();
    return;
  }
  if (e.target.closest('[data-cat="__explore"]')) { show('explorer'); return; }
  if (e.target.closest('#hm-playall')) {
    if (visible.length) { player.playNow(visible.map((t) => t.id), 0); openFullPlayer(); }
    return;
  }
  const catCard = e.target.closest('[data-cat]');
  if (catCard) {
    if (catCard.dataset.cat === 'all') { show('library'); return; }
    homeNav = { cat: catCard.dataset.cat };
    renderHome();
    return;
  }
  const item = e.target.closest('.catitem');
  if (item) {
    homeNav = { cat: homeNav.cat, key: item.dataset.key, name: item.dataset.name };
    renderHome();
    return;
  }
  const rec = e.target.closest('.reccard');
  if (rec) {
    const ids = $$('.reccard', rec.closest('.reccards')).map((c) => c.dataset.id);
    visible = ids.map(get).filter(Boolean);
    player.playNow(ids, ids.indexOf(rec.dataset.id));
    openFullPlayer();
    return;
  }
  onRowClick(e); // track rows reuse the library row behaviour
});

/* ---------------- views / tabs ---------------- */
function show(v) {
  if (v === 'playlists' && !backend.user()) { openAuth(); return; }
  view = v;
  $$('.tab').forEach((t) => t.classList.toggle('active', t.dataset.view === v));
  $('#view-home').classList.toggle('hidden', v !== 'home');
  $('#view-library').classList.toggle('hidden', v !== 'library' && v !== 'liked');
  $('#view-explorer').classList.toggle('hidden', v !== 'explorer');
  $('#view-browse').classList.toggle('hidden', v !== 'browse');
  $('#view-playlists').classList.toggle('hidden', v !== 'playlists');
  $('#view-account').classList.toggle('hidden', v !== 'account');
  $('#view-artists').classList.toggle('hidden', v !== 'artists');
  if (v === 'home') { homeNav = null; renderHome(); }
  else if (v === 'browse') renderBrowse();
  else if (v === 'playlists') renderPlaylists();
  else if (v === 'explorer') renderExplorer();
  else if (v === 'account') renderAccount();
  else if (v === 'artists') renderArtistsView();
  else renderLibrary();
}
$$('.tab').forEach((t) => t.addEventListener('click', () => show(t.dataset.view)));

$('#search').addEventListener('input', debounce(() => {
  $('#search-clear').style.display = $('#search').value ? 'block' : 'none';
  // typing a search from Home/Browse jumps to the results list
  if ($('#search').value && (view === 'home' || view === 'browse')) show('library');
  else renderLibrary();
}, 120));
$('#search-clear').addEventListener('click', () => { $('#search').value = ''; $('#search-clear').style.display = 'none'; renderLibrary(); });
$('#sort').addEventListener('change', (e) => { sort = e.target.value; renderLibrary(); });
$('#shuffle-all').addEventListener('click', () => {
  if (!visible.length) return;
  player.setShuffle(true);
  $('#pl-shuffle')?.classList.add('on');
  const ids = visible.map((t) => t.id);
  const start = Math.floor(Math.random() * ids.length);
  player.playNow(ids, start);
  toast('Shuffling ' + ids.length + ' mashups');
});
function debounce(f, ms) { let h; return (...a) => { clearTimeout(h); h = setTimeout(() => f(...a), ms); }; }

/* ---------------- mini player ---------------- */
const mini = $('#mini');
$('#mini .info').addEventListener('click', openFullPlayer);
$('#mini .viz').addEventListener('click', openFullPlayer);
$('#mini-play').addEventListener('click', (e) => { e.stopPropagation(); player.toggle(); });
$('#mini-prev').addEventListener('click', (e) => { e.stopPropagation(); player.prev(); });
$('#mini-next').addEventListener('click', (e) => { e.stopPropagation(); player.next(); });
$('#mini-queue').addEventListener('click', (e) => { e.stopPropagation(); $('#queue').classList.toggle('show'); });
$('#mini-prog').addEventListener('click', (e) => {
  const r = e.currentTarget.getBoundingClientRect();
  const p = (e.clientX - r.left) / r.width;
  if (videoMode && ytDur) { ytCur = p * ytDur; ytCmd('seekTo', [ytCur, true]); return; }
  if (player.audio.duration) player.seek(p * player.audio.duration);
});

/* ---------------- queue drawer ---------------- */
function renderQueue() {
  const q = player.state.queue;
  const pos = player.state.pos;
  $('#q-count').textContent = q.length ? `${q.length} track${q.length === 1 ? '' : 's'}` : '';
  const rowFor = (id, i) => {
    const t = get(id);
    const cur = i === pos;
    return `<div class="qrow${cur ? ' current' : ''}" data-i="${i}">
      <span class="qn">${i + 1}</span><span class="qt">${esc(t?.displayTitle || id)}</span>
      <span class="qbtns">
        <button class="qmv" data-mv="-1" title="Move up" ${i === 0 ? 'disabled' : ''}>↑</button>
        <button class="qmv" data-mv="1" title="Move down" ${i === q.length - 1 ? 'disabled' : ''}>↓</button>
        <button class="qx2" title="Remove from queue">✕</button>
      </span>
    </div>`;
  };
  let html = '';
  if (q.length) {
    if (pos >= 0) {
      html += `<div class="qhead">Now playing</div>` + rowFor(q[pos], pos);
      const rest = q.map((id, i) => ({ id, i })).filter((x) => x.i !== pos);
      if (rest.length) html += `<div class="qhead">Next up</div>` + rest.map((x) => rowFor(x.id, x.i)).join('');
    } else {
      html = q.map(rowFor).join('');
    }
  }
  $('#qlist').innerHTML = html || '<div class="empty">Queue is empty — play something, or use the ⊕ button on any track.</div>';
}
$('#qlist').addEventListener('click', (e) => {
  const row = e.target.closest('.qrow'); if (!row) return;
  const i = +row.dataset.i;
  const mv = e.target.closest('.qmv');
  if (mv) { player.moveInQueue(i, i + (+mv.dataset.mv)); return; }
  if (e.target.closest('.qx2')) { player.removeAt(i); return; }
  player.jumpTo(i);
});
$('#q-close').addEventListener('click', () => $('#queue').classList.remove('show'));

/* ---------------- full player ---------------- */
const pl = $('#player');
let videoMode = false;

function openFullPlayer() { pl.classList.add('show'); }
$('#pl-collapse').addEventListener('click', () => pl.classList.remove('show'));
$('#pl-queue').addEventListener('click', () => { pl.classList.remove('show'); $('#queue').classList.add('show'); });

$('#pp').addEventListener('click', () => player.toggle());
$('#pl-prev').addEventListener('click', () => player.prev());
$('#pl-next').addEventListener('click', () => player.next());
$('#pl-shuffle').addEventListener('click', (e) => {
  const v = !player.state.shuffle;
  player.setShuffle(v);
  e.currentTarget.classList.toggle('on', v);
  toast(v ? 'Shuffle on' : 'Shuffle off');
});
$('#pl-repeat').addEventListener('click', (e) => {
  const m = player.cycleRepeat();
  e.currentTarget.classList.toggle('on', m !== 'off');
  $('.rep1', e.currentTarget).textContent = m === 'one' ? '1' : '';
  toast('Repeat: ' + m);
});
$('#pl-like').addEventListener('click', (e) => {
  const t = player.current(); if (!t) return;
  toggleLike(t.id);
  e.currentTarget.classList.toggle('liked', likes.has(t.id));
  if (view === 'liked') renderLibrary();
});

/* seek bar */
const seekEl = $('#seek');
let seeking = false;
function seekFromEvent(e) {
  const r = seekEl.getBoundingClientRect();
  const x = (e.touches ? e.touches[0].clientX : e.clientX) - r.left;
  return Math.min(1, Math.max(0, x / r.width));
}
seekEl.addEventListener('pointerdown', (e) => {
  seeking = true; seekEl.setPointerCapture(e.pointerId);
  updateSeekUi(seekFromEvent(e));
});
seekEl.addEventListener('pointermove', (e) => { if (seeking) updateSeekUi(seekFromEvent(e)); });
seekEl.addEventListener('pointerup', (e) => {
  if (!seeking) return; seeking = false;
  const p = seekFromEvent(e);
  if (videoMode && ytDur) { ytCur = p * ytDur; ytCmd('seekTo', [ytCur, true]); return; }
  if (player.audio.duration) player.seek(p * player.audio.duration);
});
function updateSeekUi(p) {
  $('#seek .fill').style.width = (p * 100) + '%';
  $('#seek .knob').style.left = (p * 100) + '%';
}
const fmt = (s) => !Number.isFinite(s) ? '0:00' : `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/* audio/video toggle */
const avToggle = $('#av-toggle'), ytWrap = $('#yt-wrap'), vizWrap = $('#viz-full-wrap');
$('#av-audio').addEventListener('click', () => setVideoMode(false));
$('#av-video').addEventListener('click', () => setVideoMode(true));

/* ---- YouTube position sync (Spotify-style audio<->video handoff) ----
   The embed is loaded with enablejsapi=1 so we can talk to it over
   postMessage: we ask it to start reporting (event:"listening") and it sends
   "infoDelivery" messages with currentTime/duration several times a second.
   Switching audio->video passes the audio position via &start=; switching
   video->audio seeks the audio element to the video's last reported time. */
let ytCur = 0, ytDur = 0;

function ytPost(msg) {
  const f = ytWrap.querySelector('iframe');
  try { f?.contentWindow?.postMessage(JSON.stringify(msg), '*'); } catch {}
}
const ytListen = () => ytPost({ event: 'listening', id: 'bmtm', channel: 'widget' });
const ytCmd = (func, args = []) => ytPost({ event: 'command', func, args, id: 'bmtm', channel: 'widget' });

window.addEventListener('message', (e) => {
  let host = '';
  try { host = new URL(e.origin).hostname; } catch { return; }
  if (!/(^|\.)youtube(-nocookie)?\.com$/.test(host)) return;
  let d; try { d = JSON.parse(e.data); } catch { return; }
  if (d?.event === 'onReady') ytListen();
  if (d?.event !== 'infoDelivery' || !d.info) return;
  if (typeof d.info.currentTime === 'number') ytCur = d.info.currentTime;
  if (typeof d.info.duration === 'number' && d.info.duration > 0) ytDur = d.info.duration;
  if (videoMode) {
    // keep the timers + progress bars in step with the video
    if (!seeking && ytDur) updateSeekUi(ytCur / ytDur);
    $('#t-cur').textContent = fmt(ytCur);
    $('#t-dur').textContent = fmt(ytDur);
    $('#mini-prog .fill').style.width = ytDur ? (ytCur / ytDur * 100) + '%' : '0%';
    if (d.info.playerState === 0) player.next(true);      // video ended -> next track
  }
});

function setVideoMode(v, force = false) {
  const t = player.current();
  if (v && !t?.video) return;
  if (videoMode === v && !force) return;
  videoMode = v;
  $('#av-audio').classList.toggle('on', !v);
  $('#av-video').classList.toggle('on', v);
  vizWrap.classList.toggle('hidden', v);
  ytWrap.classList.toggle('hidden', !v);
  if (v) {
    player.audio.pause();
    mountEmbed(t, player.audio.currentTime || 0);          // video picks up where audio was
  } else {
    const back = ytCur;
    ytWrap.innerHTML = '';                    // stop embed
    ytCur = 0; ytDur = 0;
    if (t?.audio) {
      if (back > 1 && Number.isFinite(back)) player.seek(back);  // audio picks up where video was
      player.audio.play().catch(() => {});
    }
  }
}
function mountEmbed(t, startAt = 0) {
  if (!t?.video) return;
  ytCur = startAt; ytDur = 0;
  if (t.video.type === 'youtube') {
    // referrerpolicy override: the page sets meta referrer=no-referrer for pCloud
    // (which rejects any third-party Referer, error 7010), but YouTube's player
    // needs the origin or it fails with "Error 153". Send just the origin here.
    const start = Math.max(0, Math.floor(startAt));
    ytWrap.innerHTML = `<iframe src="https://www.youtube-nocookie.com/embed/${encodeURIComponent(t.video.sourceId)}?autoplay=1&rel=0&enablejsapi=1&playsinline=1&start=${start}" referrerpolicy="strict-origin-when-cross-origin" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen title="YouTube video"></iframe>`;
    const f = ytWrap.querySelector('iframe');
    f.addEventListener('load', () => { ytListen(); setTimeout(ytListen, 700); setTimeout(ytListen, 2000); });
  } else if (t.video.type === 'tiktok') {
    // official TikTok embed (embed-only constraint: never rehost)
    const url = t.video.sourceId.startsWith('http') ? t.video.sourceId : `https://www.tiktok.com/embed/v2/${encodeURIComponent(t.video.sourceId)}`;
    ytWrap.innerHTML = `<iframe src="${esc(url.replace('www.tiktok.com/', 'www.tiktok.com/embed/v2/').replace('/embed/v2/embed/v2/', '/embed/v2/'))}" allow="autoplay; encrypted-media" title="TikTok video"></iframe>`;
  }
}

/* ---------------- player events -> UI ---------------- */
player.on('trackchange', (t) => {
  bumpPlay(t.id);
  bumpRecent(t.id);
  document.body.classList.add('playing');
  $('#mini .info .t').textContent = t.displayTitle;
  $('#mini .info .s').textContent = songsSummary(t);
  $('#pl-title').textContent = t.displayTitle;
  $('#pl-songs').innerHTML = (t.sourceSongs || []).length
    ? t.sourceSongs.map((s) => `<b>${esc(s.artist)}</b>${s.title ? ' – ' + esc(s.title) : ''}`).join('<span style="opacity:.4"> × </span>')
    : esc(t.mashupArtist);
  mini.classList.add('show');

  const hasVideo = !!t.video, hasAudio = !!t.audio;
  avToggle.classList.toggle('hidden', !hasVideo || !hasAudio);
  $('#pl-like').classList.toggle('liked', likes.has(t.id));

  if (!hasAudio && hasVideo) setVideoMode(true, true); // embed-only entries
  else setVideoMode(false, true);

  // screensaver text + reset the details scroll to the top for the new track
  $('#saver-meta b').textContent = t.displayTitle;
  $('#saver-meta span').textContent = t.mashupArtist || '';
  buildSaverCrawl(t);
  pl.scrollTop = 0;

  applyArtwork(t);
  renderDetails(t);
  armSaver();
  renderQueue();
  renderNowRows();
});
player.on('embedonly', () => { openFullPlayer(); });
player.on('videofallback', () => {
  openFullPlayer();
  setVideoMode(true, true);
  toast('Audio host unreachable on your network — playing the video instead');
});
player.on('play', () => { syncPlayIcons(true); });
player.on('pause', () => { syncPlayIcons(false); });
player.on('queue', renderQueue);
player.on('radio', (n) => toast(`Radio: added ${n} similar mashup${n === 1 ? '' : 's'} to the queue`));
player.on('time', ({ t, d }) => {
  if (!seeking && d) updateSeekUi(t / d);
  $('#t-cur').textContent = fmt(t);
  $('#t-dur').textContent = fmt(d);
  $('#saver-time').textContent = d ? fmt(t) + ' / ' + fmt(d) : fmt(t);
  $('#mini-prog .fill').style.width = d ? (t / d * 100) + '%' : '0%';
});
player.on('error', () => toast('Could not reach the audio host (pCloud) — your network may be blocking it, and this track has no video version'));

function syncPlayIcons(playing) {
  $('#pp').innerHTML = playing ? I.pause : I.play;
  $('#mini-play').innerHTML = playing ? I.pause : I.play;
  document.body.classList.toggle('playing', playing);
  renderNowRows();
}
function renderNowRows() {
  const cur = player.current();
  $$('.trow').forEach((r) => {
    const isCur = r.dataset.id === cur?.id;
    r.classList.toggle('current', isCur);
    r.classList.toggle('playing', isCur && !player.audio.paused);
  });
  if (view === 'explorer') renderExplorer(); // refresh play/pause highlight
}

/* ---------------- artist artwork background (full-image montage) ----------
   One artist at a time: the whole photo, letterboxed over a blurred copy of
   itself so nothing gets cropped, crossfading through every artist in the
   mashup. */
let artToken = 0, montageT = 0;
function applyArtwork(t) {
  const token = ++artToken;
  const artEl = $('#pl-art');
  clearInterval(montageT);
  artEl.classList.remove('on');            // fade the old montage out
  artwork.collageFor(t).then((urls) => {
    if (token !== artToken) return;           // track changed while fetching
    if (!urls.length) {
      artEl.innerHTML = '';
      pl.classList.remove('hasart');
      mini.classList.remove('hasart');
      $('#mini .viz').style.backgroundImage = '';
      return;
    }
    const esc1 = (u) => u.replace(/'/g, '%27');
    artEl.innerHTML = urls.slice(0, 6).map((u) =>
      `<div class="slide"><div class="blur" style="background-image:url('${esc1(u)}')"></div><div class="pic" style="background-image:url('${esc1(u)}')"></div></div>`
    ).join('') + '<div class="scrim"></div>';
    const slides = $$('.slide', artEl);
    let cur = 0;
    slides[0].classList.add('live');
    if (slides.length > 1) {
      montageT = setInterval(() => {
        slides[cur].classList.remove('live');
        cur = (cur + 1) % slides.length;
        slides[cur].classList.add('live');
      }, 9000);
    }
    artEl.classList.add('on');
    pl.classList.add('hasart');
    mini.classList.add('hasart');
    $('#mini .viz').style.backgroundImage = `url('${esc1(urls[0])}')`;
    armSaver();   // artwork just arrived — the screensaver is worth arming now
  }).catch(() => {});
}

/* ---------------- now-playing details (scroll down, Spotify-style) -------- */
function renderDetails(t) {
  const box = $('#pl-details');
  if (!t) { box.innerHTML = ''; return; }
  const inside = nodesOfTrack(t.id);
  const artists = inside.filter((n) => n.kind === 'artist');
  const songs = inside.filter((n) => n.kind === 'song');
  const maName = (t.mashupArtist || '').trim();
  const maList = maName ? mashupArtists().find((a) => a.name.toLowerCase() === maName.toLowerCase()) : null;
  const rel = relatedTo(t.id, 10).map((r) => r.track).filter(Boolean);
  const chip = (n) => `<button class="dchip" data-key="${esc(n.key)}">
      ${esc(n.name)} <span class="dc">${n.trackIds.size} mashup${n.trackIds.size === 1 ? '' : 's'} ›</span>
    </button>`;
  box.innerHTML = `
    ${maName ? `<h3>Mashup by</h3>
    <div class="dchips"><button class="dchip ma" data-ma="${esc('ma:' + norm(maName))}" data-name="${esc(maName)}">
      <span class="ic">🎛</span> ${esc(maName)} <span class="dc">${maList ? maList.tracks.length + ' mashup' + (maList.tracks.length === 1 ? '' : 's') + ' on the site ›' : ''}</span>
    </button></div>` : ''}
    ${artists.length ? `<h3>Artists in this mashup</h3>
    <div class="dchips">${artists.map(chip).join('')}</div>` : ''}
    ${songs.length ? `<h3>Songs in this mashup</h3>
    <div class="dsonglist">${songs.map((n) => `
      <button class="dsong" data-key="${esc(n.key)}">
        <div class="dt"><b>${esc(n.name)}</b></div>
        <span class="dc">in ${n.trackIds.size} mashup${n.trackIds.size === 1 ? '' : 's'} ›</span>
      </button>`).join('')}</div>` : ''}
    ${(artists.length || songs.length) ? '<div class="dhint">Tap any artist or song to jump into the Explorer and find every mashup it appears in.</div>' : ''}
    ${rel.length ? `<h3>More mashups like this</h3>
    <div class="reccards">${rel.map(recCardHtml).join('')}</div>` : ''}`;
  $('#pl-hint').style.display = box.innerHTML.trim() ? '' : 'none';
}

$('#pl-details').addEventListener('click', (e) => {
  const rec = e.target.closest('.reccard');
  if (rec) {
    const ids = $$('.reccard', rec.closest('.reccards')).map((c) => c.dataset.id);
    visible = ids.map(get).filter(Boolean);
    player.playNow(ids, ids.indexOf(rec.dataset.id));
    return;
  }
  const ma = e.target.closest('[data-ma]');
  if (ma) {
    pl.classList.remove('show');
    artistNav = ma.dataset.ma;       // open the artist's profile page
    show('artists');
    return;
  }
  const k = e.target.closest('[data-key]');
  if (k) {
    pl.classList.remove('show');
    expPath = [k.dataset.key];
    expOpen.clear();
    show('explorer');
  }
});
$('#pl-hint').addEventListener('click', () => {
  pl.scrollTo({ top: pl.clientHeight * 0.92, behavior: 'smooth' });
});
$('#pl-settings').addEventListener('click', () => {
  pl.classList.remove('show');
  show('account');
});

/* ---------------- Zune-HD-style screensaver ----------------
   After a little idle time with the full player open and music playing, the
   chrome fades away, the montage dims to near-black, and the track's artists
   + songs crawl across the screen in big mixed type — while the drifting
   title keeps a live timestamp. Any touch / mouse move / key exits. */
let saverT = 0;

// text lines that crawl: every source artist + song in the playing mashup
let saverLines = [];
function buildSaverCrawl(t) {
  const seen = new Set(), out = [];
  const add = (s) => {
    const v = (s || '').trim();
    if (!v || seen.has(v.toLowerCase())) return;
    seen.add(v.toLowerCase()); out.push(v);
  };
  add(t.mashupArtist);
  for (const s of t.sourceSongs || []) { add(s.artist); add(s.title); }
  add(t.displayTitle);
  saverLines = out;
  $('#saver-crawl').innerHTML = '';
}

// mixed "fonts": weights / italics / serif / mono / condensed system faces
const CRAWL_STYLES = [
  'font-weight:900;letter-spacing:-.03em;text-transform:uppercase',
  'font-weight:200;letter-spacing:.28em;text-transform:uppercase',
  'font-weight:800;font-style:italic;letter-spacing:-.01em',
  "font-family:Georgia,'Times New Roman',serif;font-weight:700",
  'font-family:Georgia,serif;font-style:italic;font-weight:400',
  "font-family:ui-monospace,'Cascadia Mono',Consolas,monospace;font-weight:600;letter-spacing:.05em",
  "font-family:'Arial Narrow',sans-serif-condensed,sans-serif;font-weight:700;text-transform:uppercase",
  'font-weight:300;text-transform:lowercase;letter-spacing:.12em',
];
let crawlT = 0, crawlSeq = 0;
function startCrawl() {
  stopCrawl();
  const box = $('#saver-crawl');
  const spawn = () => {
    if (!saverLines.length || box.children.length >= 7) return;
    const el = document.createElement('span');
    const huge = Math.random() < 0.28;               // Zune's giant cropped letters
    el.className = 'cline';
    el.textContent = saverLines[crawlSeq++ % saverLines.length];
    el.style.cssText = CRAWL_STYLES[Math.floor(Math.random() * CRAWL_STYLES.length)]
      + `;top:${(-6 + Math.random() * 90).toFixed(1)}%`
      + `;font-size:${(huge ? 16 + Math.random() * 18 : 4.5 + Math.random() * 8).toFixed(1)}vmin`
      + `;opacity:${(0.35 + Math.random() * 0.6).toFixed(2)}`
      + `;animation:${Math.random() < 0.5 ? 'crawlL' : 'crawlR'} ${(16 + Math.random() * 16).toFixed(1)}s linear both`;
    el.addEventListener('animationend', () => el.remove());
    box.appendChild(el);
  };
  spawn(); spawn();
  crawlT = setInterval(spawn, 2400);
}
function stopCrawl() {
  clearInterval(crawlT); crawlT = 0;
  $('#saver-crawl').innerHTML = '';
}

function enterSaver() { document.body.classList.add('saver'); startCrawl(); }
function exitSaver() {
  if (document.body.classList.contains('saver')) stopCrawl();
  document.body.classList.remove('saver');
}
function saverOk() {
  const s = player.settings;
  return s.saver !== false && pl.classList.contains('show')
    && !player.audio.paused && !videoMode && pl.classList.contains('hasart');
}
function armSaver() {
  clearTimeout(saverT);
  if (document.body.classList.contains('saver')) {
    if (saverOk()) return;                 // keep running across track changes
    return exitSaver();
  }
  exitSaver();
  if (!saverOk()) return;
  saverT = setTimeout(enterSaver, (player.settings.saverDelay || 30) * 1000);
}
['pointermove', 'pointerdown', 'keydown', 'touchstart', 'wheel'].forEach((ev) =>
  window.addEventListener(ev, () => { if (document.body.classList.contains('saver')) exitSaver(); clearTimeout(saverT); saverT = setTimeout(armSaver, 250); }, { passive: true }));
player.on('play', armSaver);
player.on('pause', () => { clearTimeout(saverT); exitSaver(); });

/* ---------------- playlists view ---------------- */
const plView = $('#view-playlists');

function renderPlaylists() {
  if (openPlaylist) return renderPlaylistDetail();
  plView.innerHTML = `
    <div class="listhead">
      <h1>Playlists</h1>
      <span class="count">${playlists.length || 'none yet'}</span>
      <span class="spacer"></span>
      <button class="chip primary" id="pl-new">＋ New playlist</button>
    </div>
    ${playlists.length ? `<div class="pllist">${playlists.map((p) => `
      <button class="plcard" data-pl="${esc(p.id)}" style="--hue:${hashHue(p.id)}deg">
        <div class="art"><span>${esc(p.name.slice(0, 2).toUpperCase())}</span></div>
        <div class="anm">${esc(p.name)}</div>
        <div class="acnt">${p.trackIds.length} track${p.trackIds.length === 1 ? '' : 's'} · private</div>
      </button>`).join('')}</div>`
      : '<div class="empty">No playlists yet — create one, or use the ＋ button on any track.</div>'}`;
}

function renderPlaylistDetail() {
  const p = playlists.find((x) => x.id === openPlaylist);
  if (!p) { openPlaylist = null; return renderPlaylists(); }
  const list = p.trackIds.map(get).filter(Boolean);
  visible = list;
  plView.innerHTML = `
    <div class="listhead">
      <button class="chip" id="pld-back">‹ Playlists</button>
      <h1>${esc(p.name)}</h1>
      <span class="count">${list.length} track${list.length === 1 ? '' : 's'}</span>
      <span class="spacer"></span>
      <button class="chip" id="pld-playall">▶ Play all</button>
      <button class="chip" id="pld-rename">Rename</button>
      <button class="chip danger" id="pld-delete">Delete</button>
    </div>
    <div class="tracklist">${list.map((t, i) => plRowHtml(t, i, list.length)).join('')
      || '<div class="empty">Empty playlist — use the ＋ button on any track to add it here.</div>'}</div>`;
}

function plRowHtml(t, i, n) {
  const cur = player.current()?.id === t.id;
  return `<div class="trow${cur ? ' current' : ''}" data-id="${t.id}" data-i="${i}">
    <div class="num">${i + 1}</div>
    <div class="tmain">
      <div class="ttitle">${esc(t.displayTitle)}</div>
      <div class="tsub">${esc(songsSummary(t))}</div>
    </div>
    <button class="ordbtn" data-move="up" title="Move up" ${i === 0 ? 'disabled' : ''}>↑</button>
    <button class="ordbtn" data-move="down" title="Move down" ${i === n - 1 ? 'disabled' : ''}>↓</button>
    <button class="ordbtn" data-move="out" title="Remove from playlist">✕</button>
    <button class="rowplay" title="Play">${I.play}${I.pause}</button>
  </div>`;
}

plView.addEventListener('click', async (e) => {
  if (e.target.closest('#pl-new')) {
    const name = prompt('Playlist name');
    if (!name?.trim()) return;
    try {
      const id = await backend.createPlaylist(name.trim());
      playlists = await backend.fetchPlaylists();
      openPlaylist = id; renderPlaylists();
    } catch (err) { toast('Could not create playlist'); }
    return;
  }
  const card = e.target.closest('.plcard');
  if (card) { openPlaylist = card.dataset.pl; renderPlaylistDetail(); return; }
  if (e.target.closest('#pld-back')) { openPlaylist = null; renderPlaylists(); return; }

  const p = playlists.find((x) => x.id === openPlaylist);
  if (!p) return;
  if (e.target.closest('#pld-playall')) {
    if (p.trackIds.length) { player.playNow([...p.trackIds], 0); openFullPlayer(); }
    return;
  }
  if (e.target.closest('#pld-rename')) {
    const name = prompt('Rename playlist', p.name);
    if (!name?.trim() || name.trim() === p.name) return;
    try { await backend.renamePlaylist(p.id, name.trim()); p.name = name.trim(); renderPlaylistDetail(); }
    catch { toast('Rename failed'); }
    return;
  }
  if (e.target.closest('#pld-delete')) {
    if (!confirm(`Delete playlist "${p.name}"?`)) return;
    try {
      await backend.deletePlaylist(p.id);
      playlists = playlists.filter((x) => x.id !== p.id);
      openPlaylist = null; renderPlaylists();
    } catch { toast('Delete failed'); }
    return;
  }
  const ord = e.target.closest('.ordbtn');
  if (ord) {
    const row = ord.closest('.trow');
    const i = +row.dataset.i, id = row.dataset.id;
    if (ord.dataset.move === 'out') {
      p.trackIds = p.trackIds.filter((x) => x !== id);
      renderPlaylistDetail();
      backend.removeFromPlaylist(p.id, id).catch(() => toast('Remove failed'));
    } else {
      const j = ord.dataset.move === 'up' ? i - 1 : i + 1;
      if (j < 0 || j >= p.trackIds.length) return;
      [p.trackIds[i], p.trackIds[j]] = [p.trackIds[j], p.trackIds[i]];
      renderPlaylistDetail();
      backend.reorderPlaylist(p.id, p.trackIds).catch(() => toast('Reorder failed'));
    }
    return;
  }
  // play a row
  const row = e.target.closest('.trow');
  if (row) {
    const idx = p.trackIds.indexOf(row.dataset.id);
    const curId = player.current()?.id;
    if (e.target.closest('.rowplay') && curId === row.dataset.id) { player.toggle(); return; }
    player.playNow([...p.trackIds], idx);
    if (e.target.closest('.rowplay')) openFullPlayer();
  }
});

/* ---------------- add-to-playlist dialog ---------------- */
const plAddDlg = $('#pladd-dlg');

function openAddToPlaylist(trackId) {
  if (!backend.user()) { openAuth(); return; }
  pendingAdd = trackId;
  $('#pladd-list').innerHTML = playlists.length
    ? playlists.map((p) => {
        const has = p.trackIds.includes(trackId);
        return `<button class="pladd-row${has ? ' has' : ''}" data-pl="${esc(p.id)}" ${has ? 'disabled' : ''}>
          <span>${esc(p.name)}</span><span class="cnt">${has ? 'added ✓' : p.trackIds.length}</span></button>`;
      }).join('')
    : '<div class="empty" style="padding:14px">No playlists yet — create one below.</div>';
  $('#pladd-new').value = '';
  plAddDlg.showModal();
}

$('#pladd-list').addEventListener('click', async (e) => {
  const b = e.target.closest('.pladd-row'); if (!b || b.disabled) return;
  const p = playlists.find((x) => x.id === b.dataset.pl); if (!p) return;
  try {
    await backend.addToPlaylist(p.id, pendingAdd, p.trackIds.length);
    p.trackIds.push(pendingAdd);
    toast(`Added to "${p.name}"`);
    plAddDlg.close();
  } catch { toast('Could not add track'); }
});
$('#pladd-create').addEventListener('click', async () => {
  const name = $('#pladd-new').value.trim(); if (!name) return;
  try {
    const id = await backend.createPlaylist(name);
    await backend.addToPlaylist(id, pendingAdd, 0);
    playlists = await backend.fetchPlaylists();
    toast(`Added to "${name}"`);
    plAddDlg.close();
  } catch { toast('Could not create playlist'); }
});
$('#pladd-close').addEventListener('click', () => plAddDlg.close());

/* ---------------- account page: your stats + settings ---------------- */
const acctView = $('#view-account');

function renderAccount() {
  const u = backend.user(), p = backend.getProfile();
  const s = player.settings;
  const played = Object.entries(plays).map(([id, n]) => ({ t: get(id), n })).filter((x) => x.t).sort((a, b) => b.n - a.n);
  const total = played.reduce((sum, x) => sum + x.n, 0);
  const top = played.slice(0, 10);
  const eqOk = player.eqAvailable();
  visible = top.map((x) => x.t);
  acctView.innerHTML = `
    <div class="listhead"><h1>${u ? 'Your page' : 'Settings'}</h1></div>

    <div class="acct-card">
      <h2>${esc(p?.display_name || (u ? u.email : 'Not signed in'))}</h2>
      <div class="sub">${u ? esc(u.email) + (backend.isAdmin() ? ' · admin' : backend.isArtist() ? ' · mashup artist' : ' · listener') : 'Sign in to sync your likes, playlists and play counts across devices.'}</div>
      <div class="rowchips">
        ${u ? `
        <button class="chip" id="ac-role">${backend.isArtist() ? 'Switch to listener account' : '🎛 Become a mashup artist'}</button>
        <button class="chip artistonly" id="ac-yt">${p?.youtube_channel ? '▶ YouTube channel linked ✓ (change)' : '▶ Link your YouTube channel'}</button>
        <a class="chip artistonly" href="submit.html">🎚 Submit a mashup</a>
        <a class="chip artistonly" href="submit.html#mine">✎ My submissions — edit your tracks</a>
        <button class="chip artistonly" id="ac-bio">📝 Edit my artist page (bio)</button>
        <a class="chip adminonly" href="admin.html">🛠 Admin</a>
        <button class="chip" id="ac-signout">Sign out</button>`
      : `<button class="chip primary" id="ac-signin">Sign in / create account</button>`}
        <a class="chip" href="${APK_URL}">📱 Download the Android app</a>
      </div>
    </div>

    <div class="acct-card">
      <h2>Listening stats</h2>
      <div class="sub">${u ? 'Synced to your account.' : 'Stored on this device — sign in to keep them everywhere.'}</div>
      <div class="statgrid">
        <div class="stat"><b>${total}</b><span>total plays</span></div>
        <div class="stat"><b>${played.length}</b><span>different mashups</span></div>
        <div class="stat"><b>${likes.size}</b><span>liked</span></div>
      </div>
      ${top.length ? `<div class="tracklist">${top.map((x, i) => rowHtml(x.t, i)).join('')}</div>`
        : '<div class="dhint">Play some mashups and your most-played will show up here.</div>'}
    </div>

    <div class="acct-card">
      <h2>Playback</h2>
      <div class="setrow">
        <div class="sl"><b>Autoplay radio</b><span>When the queue ends, keep going with related mashups</span></div>
        <label class="swtch"><input type="checkbox" id="set-autoplay" ${s.autoplay ? 'checked' : ''}><span class="kn"></span></label>
      </div>
      <div class="setrow">
        <div class="sl"><b>Crossfade</b><span>Fade tracks out and in at the edges</span></div>
        <input type="range" id="set-crossfade" min="0" max="12" step="1" value="${s.crossfade || 0}">
        <span class="val" id="set-cf-val">${s.crossfade ? s.crossfade + 's' : 'Off'}</span>
      </div>
      <div class="setrow">
        <div class="sl"><b>Gapless prep</b><span>Fetch the next track's stream link before the current one ends</span></div>
        <label class="swtch"><input type="checkbox" id="set-prewarm" ${s.prewarm ? 'checked' : ''}><span class="kn"></span></label>
      </div>
      <div class="setrow">
        <div class="sl"><b>Screensaver</b><span>Zune HD takeover — the artists dim and the track's songs crawl across the screen</span></div>
        <select id="set-saverdelay">
          ${[15, 30, 60, 120].map((v) => `<option value="${v}" ${(s.saverDelay || 30) === v ? 'selected' : ''}>${v < 60 ? v + 's' : (v / 60) + ' min'}</option>`).join('')}
        </select>
        <label class="swtch"><input type="checkbox" id="set-saver" ${s.saver !== false ? 'checked' : ''}><span class="kn"></span></label>
      </div>
    </div>

    <div class="acct-card">
      <h2>Equalizer</h2>
      <div class="setrow">
        <div class="sl"><b>Enable EQ</b><span>5-band equalizer${eqOk ? '' : ' — kicks in while a track is playing with the visualizer active'}</span></div>
        <label class="swtch"><input type="checkbox" id="set-eq" ${s.eq ? 'checked' : ''}><span class="kn"></span></label>
      </div>
      <div class="eqwrap">${player.EQ_FREQS.map((f, i) => `
        <div class="eqband">
          <input type="range" class="eqs" data-band="${i}" min="-12" max="12" step="1" value="${s.eqBands[i] || 0}" ${s.eq ? '' : 'disabled'}>
          <label>${f >= 1000 ? (f / 1000) + 'k' : f}</label>
        </div>`).join('')}</div>
      <div class="eqpresets">${Object.keys(player.EQ_PRESETS).map((k) =>
        `<button class="chip eqp" data-preset="${esc(k)}" ${s.eq ? '' : 'disabled'}>${esc(k)}</button>`).join('')}</div>
      <div class="eqnote">On tracks whose audio host blocks cross-origin reads the EQ can't touch the stream — playback simply continues without it.</div>
    </div>

    <div class="acct-card">
      <h2>Appearance</h2>
      <div class="setrow">
        <div class="sl"><b>Theme</b><span>Dark / light</span></div>
        <button class="chip" id="ac-theme">Toggle theme</button>
      </div>
    </div>`;
}

acctView.addEventListener('click', async (e) => {
  if (e.target.closest('#ac-signin')) { openAuth(); return; }
  if (e.target.closest('#ac-bio')) {
    const name = backend.getProfile()?.display_name;
    if (!name) { toast('Set a display name first (it identifies your artist page)'); return; }
    openBioDlg(name);
    return;
  }
  if (e.target.closest('#ac-signout')) { await backend.signOut(); toast('Signed out'); renderAccount(); return; }
  if (e.target.closest('#ac-theme')) {
    setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
    return;
  }
  if (e.target.closest('#ac-role')) {
    try {
      await backend.setRole(backend.isArtist() ? 'listener' : 'artist');
      toast(backend.isArtist() ? 'You are now a mashup artist — you can submit tracks!' : 'Switched to listener');
      renderAccount();
    } catch { toast('Could not change role'); }
    return;
  }
  if (e.target.closest('#ac-yt')) {
    const cur = backend.getProfile()?.youtube_channel || '';
    const url = prompt('Your YouTube channel link (e.g. https://youtube.com/@yourname)', cur);
    if (url === null) return;
    const v = url.trim();
    if (v && !/^https?:\/\/(www\.)?youtube\.com\//.test(v)) { toast('That does not look like a YouTube channel link'); return; }
    try {
      await backend.updateProfile({ youtube_channel: v || null });
      toast(v ? 'YouTube channel linked' : 'YouTube channel removed');
      renderAccount();
    } catch { toast('Could not save channel'); }
    return;
  }
  const preset = e.target.closest('.eqp');
  if (preset && !preset.disabled) {
    const bands = player.EQ_PRESETS[preset.dataset.preset];
    if (bands) {
      player.saveSettings({ eqBands: [...bands] });
      $$('.eqs', acctView).forEach((sl, i) => { sl.value = bands[i]; });
      toast('EQ: ' + preset.dataset.preset);
    }
    return;
  }
  onRowClick(e); // top-played rows behave like library rows
});

acctView.addEventListener('input', (e) => {
  const id = e.target.id;
  if (id === 'set-autoplay') player.saveSettings({ autoplay: e.target.checked });
  else if (id === 'set-prewarm') player.saveSettings({ prewarm: e.target.checked });
  else if (id === 'set-saver') { player.saveSettings({ saver: e.target.checked }); armSaver(); }
  else if (id === 'set-saverdelay') { player.saveSettings({ saverDelay: +e.target.value }); armSaver(); }
  else if (id === 'set-crossfade') {
    const v = +e.target.value;
    player.saveSettings({ crossfade: v });
    $('#set-cf-val').textContent = v ? v + 's' : 'Off';
  } else if (id === 'set-eq') {
    player.saveSettings({ eq: e.target.checked });
    $$('.eqs, .eqp', acctView).forEach((el) => { el.disabled = !e.target.checked; });
  } else if (e.target.classList.contains('eqs')) {
    player.setEqBand(+e.target.dataset.band, +e.target.value);
  }
});

/* ---------------- auth + account dialogs ---------------- */
const authDlg = $('#auth-dlg'), acctDlg = $('#acct-dlg');
let authMode = 'in'; // 'in' | 'up'

function openAuth() {
  if (!backend.enabled()) { toast('Accounts are not set up yet'); return; }
  authMode = 'in'; syncAuthMode();
  $('#auth-err').classList.add('hidden');
  authDlg.showModal();
}
function syncAuthMode() {
  const up = authMode === 'up';
  $('#auth-title').textContent = up ? 'Create your free account' : 'Sign in';
  $('#auth-go').textContent = up ? 'Sign up' : 'Sign in';
  $('#auth-switch').textContent = up ? 'Have an account? Sign in' : 'Need an account? Sign up';
  $('#auth-name-f').classList.toggle('hidden', !up);
}
$('#auth-switch').addEventListener('click', () => { authMode = authMode === 'in' ? 'up' : 'in'; syncAuthMode(); });
$('#auth-google').addEventListener('click', async () => {
  try {
    sessionStorage.setItem('bmtm.oauth', '1');   // so the return trip shows "Signed in"
    await backend.signInWithGoogle();
  }
  catch (err) {
    $('#auth-err').textContent = err?.message || 'Google sign-in failed.';
    $('#auth-err').classList.remove('hidden');
  }
});
$('#auth-cancel').addEventListener('click', () => authDlg.close());
$('#auth-go').addEventListener('click', async () => {
  const email = $('#auth-email').value.trim(), pass = $('#auth-pass').value;
  const errEl = $('#auth-err');
  errEl.classList.add('hidden');
  if (!email || !pass) { errEl.textContent = 'Email and password required.'; errEl.classList.remove('hidden'); return; }
  try {
    $('#auth-go').disabled = true;
    if (authMode === 'up') {
      await backend.signUp(email, pass, $('#auth-name').value.trim());
      toast('Account created — check your email if confirmation is required');
    } else {
      await backend.signIn(email, pass);
      toast('Signed in');
    }
    authDlg.close();
  } catch (err) {
    errEl.textContent = err?.message || 'Something went wrong.';
    errEl.classList.remove('hidden');
  } finally { $('#auth-go').disabled = false; }
});

function openAccount() {
  const p = backend.getProfile();
  $('#acct-who').textContent = `${p?.display_name || ''} · ${backend.user()?.email || ''}` +
    (backend.isAdmin() ? ' · admin' : p?.role === 'artist' ? ' · mashup artist' : '');
  $('#acct-role').textContent = backend.isArtist()
    ? 'Switch to listener account' : '🎛 Become a mashup artist';
  $('#acct-yt').textContent = p?.youtube_channel
    ? '▶ YouTube channel linked ✓ (change)' : '▶ Link your YouTube channel';
  $('#acct-app').href = APK_URL;
  acctDlg.showModal();
}
$('#acct-yt').addEventListener('click', async () => {
  const cur = backend.getProfile()?.youtube_channel || '';
  const url = prompt('Your YouTube channel link (e.g. https://youtube.com/@yourname)', cur);
  if (url === null) return;
  const v = url.trim();
  if (v && !/^https?:\/\/(www\.)?youtube\.com\//.test(v)) { toast('That does not look like a YouTube channel link'); return; }
  try {
    await backend.updateProfile({ youtube_channel: v || null });
    toast(v ? 'YouTube channel linked' : 'YouTube channel removed');
    openAccount();
  } catch { toast('Could not save channel'); }
});
$('#account').addEventListener('click', () => backend.user() ? show('account') : openAuth());
$('#acct-close').addEventListener('click', () => acctDlg.close());
$('#acct-signout').addEventListener('click', async () => { acctDlg.close(); await backend.signOut(); toast('Signed out'); });
$('#acct-role').addEventListener('click', async () => {
  try {
    await backend.setRole(backend.isArtist() ? 'listener' : 'artist');
    toast(backend.isArtist() ? 'You are now a mashup artist — you can submit tracks!' : 'Switched to listener');
    openAccount();
  } catch { toast('Could not change role'); }
});

/* ---------------- toast ---------------- */
let toastH;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg; el.classList.add('show');
  clearTimeout(toastH); toastH = setTimeout(() => el.classList.remove('show'), 2200);
}

/* ---------------- in-app back navigation ----------------
   One place that decides what "back" means. The Android hardware back button
   (via Capacitor's App plugin) and the Esc key both route through here, so back
   walks the UI — close a dialog, collapse the player, step up a drill-down, or
   return to Home — instead of instantly exiting the app. Returns true if it
   consumed the action; false means "nothing left, allow exit". */
function handleBack() {
  const dlg = document.querySelector('dialog[open]');
  if (dlg) { dlg.close(); return true; }
  if (pl.classList.contains('show')) { pl.classList.remove('show'); return true; }
  if ($('#queue').classList.contains('show')) { $('#queue').classList.remove('show'); return true; }
  if (view === 'explorer' && expPath.length) { expPath.pop(); renderExplorer(); return true; }
  if (view === 'artists' && artistNav) { artistNav = null; renderArtistsView(); return true; }
  if (view === 'home' && homeNav) { homeNav = homeNav.key ? { cat: homeNav.cat } : null; renderHome(); return true; }
  if (view === 'browse' && browseAlbum) { browseAlbum = null; renderBrowse(); return true; }
  if (view === 'playlists' && openPlaylist) { openPlaylist = null; renderPlaylists(); return true; }
  if (view !== 'home') { show('home'); return true; }
  return false;
}

/* Android hardware back button (only present inside the Capacitor app shell). */
const CapApp = window.Capacitor?.Plugins?.App;
if (CapApp?.addListener) {
  CapApp.addListener('backButton', () => { if (!handleBack()) CapApp.exitApp(); });
}

/* ---------------- app-update check (Android app shell only) ----------------
   The app loads the live website, so web changes appear instantly. Only the
   native APK needs a manual reinstall (e.g. new Capacitor plugins). On launch
   we compare the installed APK version (App.getInfo) against app-version.txt on
   the live site; if the site is newer, show a one-tap Download banner. */
function verNewer(a, b) {
  const pa = String(a).split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b).split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  }
  return false;
}
async function checkForUpdate() {
  if (!CapApp?.getInfo) return;                       // only inside the native app
  try {
    const info = await CapApp.getInfo();              // { version, build, ... }
    const res = await fetch('app-version.txt?ts=' + Date.now(), { cache: 'no-store' });
    if (!res.ok) return;
    const latest = (await res.text()).trim();
    if (latest && verNewer(latest, info.version)) showUpdateBanner(latest, info.version);
  } catch {}
}
function showUpdateBanner(latest, current) {
  if (document.getElementById('updbar')) return;
  const bar = document.createElement('div');
  bar.id = 'updbar';
  bar.innerHTML = `<span class="ut">New version <b>${esc(latest)}</b> is ready — you have ${esc(current)}.</span>
    <button id="upd-get">Download</button>
    <button id="upd-later" title="Later">✕</button>`;
  document.body.appendChild(bar);
  bar.querySelector('#upd-get').addEventListener('click', () => window.open(APK_URL, '_blank'));
  bar.querySelector('#upd-later').addEventListener('click', () => bar.remove());
}

/* ---------------- keyboard ---------------- */
document.addEventListener('keydown', (e) => {
  if (e.target.matches('input, textarea, select')) return;
  if (e.code === 'Space') { e.preventDefault(); player.toggle(); }
  if (e.code === 'ArrowRight' && e.shiftKey) player.next();
  if (e.code === 'ArrowLeft' && e.shiftKey) player.prev();
  if (e.code === 'Escape') { if (!handleBack()) { /* nothing to close */ } }
});

/* ---------------- boot ---------------- */
(async function boot() {
  setTheme(localStorage.getItem(THEME_KEY) || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
  $('#theme').addEventListener('click', () =>
    setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'));

  await backend.init().catch((e) => console.warn('backend init failed', e));
  backend.onAuth(() => syncAccountState());
  setAuthUi();

  await loadCatalog();
  show('home');
  if (backend.user()) syncAccountState();

  // mashup-artist bios (non-blocking; section works without them)
  if (backend.enabled()) {
    backend.fetchArtistPages().then((p) => {
      artistPages = p || {};
      if (view === 'artists') renderArtistsView();
    }).catch(() => {});
  }

  viz.attach($('#viz-full'), 'full');
  viz.attach($('#viz-mini'), 'mini');
  viz.setAmbient(true);

  checkForUpdate();
})();
