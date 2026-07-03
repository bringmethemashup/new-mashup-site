/**
 * app.js — UI: views (Library / Browse / Explorer / Liked), track rows, queue drawer,
 * mini + full player, theme toggle, ambient background, YouTube video toggle.
 */
import { loadCatalog, all, get, search, searchNodes, connectionsOf, getNode, albumsByYear, specialAlbums, relatedTo } from './catalog.js';
import * as player from './player.js';
import * as viz from './visualizer.js';

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
const bumpPlay = (id) => { plays[id] = (plays[id] || 0) + 1; localStorage.setItem(PLAYS_KEY, JSON.stringify(plays)); };

let view = 'library';
let sort = 'new';
let browseAlbum = null;      // currently open album on the Browse page
let visible = [];            // tracks currently listed (drives play-context + shuffle-all)
let expPath = [];            // explorer column path [nodeKey,...]

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

function rowHtml(t, i) {
  const liked = likes.has(t.id);
  const cur = player.current()?.id === t.id;
  return `<div class="trow${cur ? ' current' : ''}${cur && !player.audio.paused ? ' playing' : ''}" data-id="${t.id}" data-i="${i}">
    <div class="num">${i + 1}</div>
    <div class="tmain">
      <div class="ttitle">${esc(t.displayTitle)}</div>
      <div class="tsub">${esc(songsSummary(t))}</div>
    </div>
    <div class="tyear">${t.year || ''}${!t.audio ? ' <span class="badge video">embed</span>' : ''}</div>
    <button class="heartbtn${liked ? ' liked' : ''}" title="Save to Liked">${I.heart}</button>
    <button class="rowplay" title="Play">${I.play}${I.pause}</button>
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
  if (e.target.closest('.heartbtn')) {
    likes.has(id) ? likes.delete(id) : likes.add(id);
    saveLikes();
    e.target.closest('.heartbtn').classList.toggle('liked');
    if (view === 'liked') renderLibrary();
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

/* ---------------- explorer (Miller columns) ---------------- */
const expSearch = $('#exp-search'), expSugg = $('#exp-sugg'), colsEl = $('#columns');

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
  expSearch.value = getNode(b.dataset.key)?.name || '';
  renderColumns();
});
document.addEventListener('click', (e) => {
  if (!e.target.closest('.exp-searchwrap')) expSugg.classList.add('hidden');
});

function colHtml(key, depth) {
  const node = getNode(key);
  const conns = connectionsOf(key).filter((c) => !expPath.slice(0, depth + 1).includes(c.node.key));
  const items = conns.map((c) => `
    <div class="conn" data-key="${esc(c.node.key)}">
      <button class="head">
        <span class="nm">${esc(c.node.name)}</span>
        <span class="knd">${c.node.kind}</span>
        <span class="cnt">${c.via.length}</span>
      </button>
      <div class="via">${c.via.map((id) => {
        const t = get(id);
        return t ? `<button data-play="${esc(id)}"><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg><span>${esc(t.displayTitle)}</span></button>` : '';
      }).join('')}</div>
    </div>`).join('');
  return `<div class="col" data-depth="${depth}">
    <header>
      <div class="kind">${node.kind}</div>
      <h3>${esc(node.name)}</h3>
      <div class="meta">in ${node.trackIds.size} mashup${node.trackIds.size === 1 ? '' : 's'} · ${conns.length} connection${conns.length === 1 ? '' : 's'}</div>
    </header>
    <div class="items">${items || '<div class="empty" style="padding:24px 10px">No further connections.</div>'}</div>
  </div>`;
}

function renderColumns() {
  colsEl.innerHTML = expPath.map((k, d) => colHtml(k, d)).join('');
  // mark selected chain
  expPath.forEach((k, d) => {
    if (d + 1 < expPath.length) {
      const col = colsEl.children[d];
      col && $$('.conn', col).forEach((c) => c.classList.toggle('sel', c.dataset.key === expPath[d + 1]));
    }
  });
  colsEl.scrollLeft = colsEl.scrollWidth;
}

colsEl.addEventListener('click', (e) => {
  const playBtn = e.target.closest('[data-play]');
  if (playBtn) {
    const id = playBtn.dataset.play;
    visible = [get(id)];
    player.playNow([id], 0);
    openFullPlayer();
    return;
  }
  const head = e.target.closest('.conn > button.head'); if (!head) return;
  const conn = head.closest('.conn');
  const col = conn.closest('.col');
  const depth = +col.dataset.depth;
  if (conn.classList.contains('sel')) { // toggle track list on re-click
    conn.classList.toggle('open');
    return;
  }
  // first click: open next column AND expand its "via" list
  conn.classList.add('open');
  expPath = [...expPath.slice(0, depth + 1), conn.dataset.key];
  renderColumns();
  // restore open state on the (re-rendered) selected conn
  const rcol = colsEl.children[depth];
  rcol && $$('.conn', rcol).forEach((c) => { if (c.dataset.key === conn.dataset.key) c.classList.add('open', 'sel'); });
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

/* ---------------- views / tabs ---------------- */
function show(v) {
  view = v;
  $$('.tab').forEach((t) => t.classList.toggle('active', t.dataset.view === v));
  $('#view-library').classList.toggle('hidden', v === 'explorer' || v === 'browse');
  $('#view-explorer').classList.toggle('hidden', v !== 'explorer');
  $('#view-browse').classList.toggle('hidden', v !== 'browse');
  if (v === 'browse') renderBrowse();
  else if (v !== 'explorer') renderLibrary();
}
$$('.tab').forEach((t) => t.addEventListener('click', () => show(t.dataset.view)));

$('#search').addEventListener('input', debounce(() => { $('#search-clear').style.display = $('#search').value ? 'block' : 'none'; renderLibrary(); }, 120));
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
  if (player.audio.duration) player.seek(((e.clientX - r.left) / r.width) * player.audio.duration);
});

/* ---------------- queue drawer ---------------- */
function renderQueue() {
  const q = player.state.queue;
  $('#q-count').textContent = q.length ? `${q.length} track${q.length === 1 ? '' : 's'}` : '';
  $('#qlist').innerHTML = q.length ? q.map((id, i) => {
    const t = get(id);
    const cur = i === player.state.pos;
    return `<div class="qrow${cur ? ' current' : ''}" data-i="${i}">
      <span class="qn">${i + 1}</span><span class="qt">${esc(t?.displayTitle || id)}</span>
      ${cur ? '' : `<button class="qx" title="Remove">${I.close}</button>`}
    </div>`;
  }).join('') : '<div class="empty">Queue is empty — play something.</div>';
}
$('#qlist').addEventListener('click', (e) => {
  const row = e.target.closest('.qrow'); if (!row) return;
  const i = +row.dataset.i;
  if (e.target.closest('.qx')) { player.removeAt(i); return; }
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
  likes.has(t.id) ? likes.delete(t.id) : likes.add(t.id);
  saveLikes();
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
    mountEmbed(t);
  } else {
    ytWrap.innerHTML = '';                    // stop embed
    if (t?.audio) player.audio.play().catch(() => {});
  }
}
function mountEmbed(t) {
  if (!t?.video) return;
  if (t.video.type === 'youtube') {
    ytWrap.innerHTML = `<iframe src="https://www.youtube-nocookie.com/embed/${encodeURIComponent(t.video.sourceId)}?autoplay=1&rel=0" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen title="YouTube video"></iframe>`;
  } else if (t.video.type === 'tiktok') {
    // official TikTok embed (embed-only constraint: never rehost)
    const url = t.video.sourceId.startsWith('http') ? t.video.sourceId : `https://www.tiktok.com/embed/v2/${encodeURIComponent(t.video.sourceId)}`;
    ytWrap.innerHTML = `<iframe src="${esc(url.replace('www.tiktok.com/', 'www.tiktok.com/embed/v2/').replace('/embed/v2/embed/v2/', '/embed/v2/'))}" allow="autoplay; encrypted-media" title="TikTok video"></iframe>`;
  }
}

/* ---------------- player events -> UI ---------------- */
player.on('trackchange', (t) => {
  bumpPlay(t.id);
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

  renderQueue();
  renderNowRows();
});
player.on('embedonly', () => { openFullPlayer(); });
player.on('play', () => { syncPlayIcons(true); });
player.on('pause', () => { syncPlayIcons(false); });
player.on('queue', renderQueue);
player.on('time', ({ t, d }) => {
  if (!seeking && d) updateSeekUi(t / d);
  $('#t-cur').textContent = fmt(t);
  $('#t-dur').textContent = fmt(d);
  $('#mini-prog .fill').style.width = d ? (t / d * 100) + '%' : '0%';
});
player.on('error', () => toast('Could not play this track — link may be offline'));

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
}

/* ---------------- toast ---------------- */
let toastH;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg; el.classList.add('show');
  clearTimeout(toastH); toastH = setTimeout(() => el.classList.remove('show'), 2200);
}

/* ---------------- keyboard ---------------- */
document.addEventListener('keydown', (e) => {
  if (e.target.matches('input, textarea, select')) return;
  if (e.code === 'Space') { e.preventDefault(); player.toggle(); }
  if (e.code === 'ArrowRight' && e.shiftKey) player.next();
  if (e.code === 'ArrowLeft' && e.shiftKey) player.prev();
  if (e.code === 'Escape') { pl.classList.remove('show'); $('#queue').classList.remove('show'); }
});

/* ---------------- boot ---------------- */
(async function boot() {
  setTheme(localStorage.getItem(THEME_KEY) || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
  $('#theme').addEventListener('click', () =>
    setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'));

  await loadCatalog();
  renderLibrary();
  show('library');

  viz.attach($('#viz-full'), 'full');
  viz.attach($('#viz-mini'), 'mini');
  viz.setAmbient(true);
})();
