/**
 * player.js — queue, shuffle, repeat, pCloud-primary playback, Media Session,
 * playback settings (autoplay radio, crossfade, EQ, screensaver).
 *
 * Playback model (per project brief):
 *   - pCloud audio via <audio> is ALWAYS the primary source when present.
 *   - YouTube is an optional *video view* toggle in the full player (podcast-
 *     style). Switching to video pauses audio; switching back resumes audio.
 *   - isOwnUpload:false entries have no audio object -> video/embed only.
 *
 * Web Audio: we try crossOrigin="anonymous" so an AnalyserNode can read the
 * stream for the visualizer + EQ. If the host ever fails CORS, we reload the
 * element without crossOrigin (audio still plays!) and flag the visualizer
 * into ambient mode — the EQ is unavailable for those tracks (a graph on a
 * tainted element outputs silence, so we must bypass it entirely).
 */
import { resolveAudioUrl, invalidate } from './pcloud.js';
import * as viz from './visualizer.js';
import { get, relatedTo, all } from './catalog.js';
import { firstArtFor } from './artwork.js';

export const audio = new Audio();
audio.preload = 'metadata';

let actx = null, srcNode = null, analyserOk = false;
let eqFilters = [];          // 5 BiquadFilters, built with the graph

const S = {
  queue: [],          // track ids
  pos: -1,
  shuffle: false,
  repeat: 'off',      // off | all | one
  corsBlocked: false, // learned at runtime
};
export const state = S;

/* ---------------- persisted playback settings ---------------- */
const SET_KEY = 'bmtm.settings.v1';
export const settings = Object.assign({
  autoplay: true,      // radio: keep playing related mashups when queue ends
  crossfade: 0,        // seconds of fade-out/fade-in (0 = off)
  prewarm: true,       // resolve the next track's stream link early (gapless-ish)
  eq: false,           // equalizer on/off
  eqBands: [0, 0, 0, 0, 0], // dB, -12..12 @ 60 / 230 / 910 / 3600 / 14000 Hz
  saver: true,         // Zune-style screensaver in the full player
  saverDelay: 30,      // seconds idle before it starts
}, (() => { try { return JSON.parse(localStorage.getItem(SET_KEY) || '{}'); } catch { return {}; } })());

export function saveSettings(patch) {
  Object.assign(settings, patch);
  try { localStorage.setItem(SET_KEY, JSON.stringify(settings)); } catch {}
  applyEq();
  emit('settings', settings);
}

export const EQ_FREQS = [60, 230, 910, 3600, 14000];
export const EQ_PRESETS = {
  Flat: [0, 0, 0, 0, 0],
  'Bass boost': [6, 4, 0, 0, 1],
  Vocal: [-2, 0, 4, 3, 0],
  Treble: [0, -1, 0, 3, 5],
  Lounge: [3, 1, -1, 1, 3],
};
export const eqAvailable = () => analyserOk;
export function setEqBand(i, db) {
  settings.eqBands[i] = Math.max(-12, Math.min(12, +db || 0));
  saveSettings({ eqBands: settings.eqBands });
}
function applyEq() {
  if (!eqFilters.length) return;
  eqFilters.forEach((f, i) => { f.gain.value = settings.eq ? (settings.eqBands[i] || 0) : 0; });
}

const listeners = new Map();
export function on(ev, fn) { (listeners.get(ev) || listeners.set(ev, []).get(ev)).push(fn); }
function emit(ev, data) { (listeners.get(ev) || []).forEach((f) => f(data)); }

export const current = () => (S.pos >= 0 ? get(S.queue[S.pos]) : null);
export const nextUp = () => (S.pos >= 0 && S.pos + 1 < S.queue.length ? get(S.queue[S.pos + 1]) : null);

/* ---------------- web audio graph ---------------- */
function ensureGraph() {
  if (analyserOk || S.corsBlocked) return;
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    srcNode = actx.createMediaElementSource(audio);
    // 5-band EQ chain: lowshelf, 3x peaking, highshelf
    eqFilters = EQ_FREQS.map((freq, i) => {
      const f = actx.createBiquadFilter();
      f.type = i === 0 ? 'lowshelf' : i === EQ_FREQS.length - 1 ? 'highshelf' : 'peaking';
      f.frequency.value = freq;
      if (f.type === 'peaking') f.Q.value = 1;
      f.gain.value = 0;
      return f;
    });
    const an = actx.createAnalyser();
    an.fftSize = 2048;
    an.smoothingTimeConstant = 0.82;
    let node = srcNode;
    for (const f of eqFilters) { node.connect(f); node = f; }
    node.connect(an);
    an.connect(actx.destination);
    viz.setAnalyser(an);
    analyserOk = true;
    applyEq();
    emit('graph', true);
  } catch (e) {
    console.warn('AnalyserNode unavailable, visualizer in ambient mode', e);
    viz.setAnalyser(null);
  }
}

/* ---------------- core load/play ---------------- */
let loadToken = 0;
let prewarmedFor = null;   // track id we already pre-resolved the NEXT link for

async function loadAndPlay(track, { retried = false } = {}) {
  restored = false;               // any real load clears the "restored, not yet loaded" state
  const token = ++loadToken;
  emit('trackchange', track);
  updateMediaSession(track);

  if (!track.audio?.publicLink && !track.audio?.url) { // embed-only entry
    audio.pause(); audio.removeAttribute('src');
    viz.setPlaying(false);
    emit('embedonly', track);
    return;
  }

  try {
    // direct url (artist uploads on Supabase storage) or pCloud publink
    const url = track.audio.url
      ? track.audio.url
      : await resolveAudioUrl(track.audio.publicLink, { force: retried });
    if (token !== loadToken) return;                 // user skipped meanwhile
    if (!S.corsBlocked) audio.crossOrigin = 'anonymous';
    else audio.removeAttribute('crossorigin');
    audio.src = url;
    // fade-in start when crossfade is on
    audio.volume = settings.crossfade > 0 ? 0.02 : 1;
    await audio.play();
    if (actx?.state === 'suspended') actx.resume();
    ensureGraph();
    viz.setAmbient(!analyserOk);
  } catch (err) {
    if (token !== loadToken) return;
    // 1st retry: link may have expired -> re-resolve fresh
    if (!retried) { invalidate(track.audio.publicLink); return loadAndPlay(track, { retried: true }); }
    // 2nd failure with CORS enabled: try tainted playback (audio w/o visualizer)
    if (!S.corsBlocked) {
      S.corsBlocked = true;
      viz.setAnalyser(null); viz.setAmbient(true);
      return loadAndPlay(track, { retried: true });
    }
    console.error('Playback failed', err);
    // audio unreachable (e.g. ISP DNS blocks pCloud) but the track has a
    // video -> play that instead of failing
    if (track.video) { emit('videofallback', track); return; }
    emit('error', { track, err });
  }
}

audio.addEventListener('error', () => {
  const t = current();
  if (t?.audio?.publicLink) { invalidate(t.audio.publicLink); }
});
audio.addEventListener('play', () => {
  viz.setPlaying(true); emit('play');
  try { nativeMS()?.setPlaybackState({ playbackState: 'playing' }); } catch {}
});
audio.addEventListener('pause', () => {
  viz.setPlaying(false); emit('pause');
  try { nativeMS()?.setPlaybackState({ playbackState: 'paused' }); } catch {}
});
audio.addEventListener('timeupdate', () => {
  const t = audio.currentTime, d = audio.duration || 0;
  emit('time', { t, d });

  // crossfade-style edges: fade the last N seconds out, the first N in.
  const cf = settings.crossfade;
  if (cf > 0 && d && !audio.paused) {
    let v = 1;
    const rem = d - t;
    if (rem < cf) v = Math.max(0, rem / cf);
    if (t < cf) v = Math.min(v, Math.max(0.02, t / cf));
    audio.volume = v;
  } else if (audio.volume !== 1) {
    audio.volume = 1;
  }

  // gapless-ish: pre-resolve the next track's stream link near the end so the
  // hop to the next song skips the pCloud API round-trip.
  if (settings.prewarm && d && d - t < 20) {
    const nt = nextUp();
    if (nt && nt.id !== prewarmedFor && nt.audio?.publicLink) {
      prewarmedFor = nt.id;
      resolveAudioUrl(nt.audio.publicLink).catch(() => {});
    }
  }

  // lock-screen seek bar position
  if ('mediaSession' in navigator && 'setPositionState' in navigator.mediaSession && d) {
    try { navigator.mediaSession.setPositionState({ duration: d, playbackRate: audio.playbackRate || 1, position: Math.min(t, d) }); } catch {}
  }
  // native (APK) media session position — throttled, each call crosses the JS bridge
  if (d && Date.now() - lastNativePos > 1000) {
    lastNativePos = Date.now();
    try { nativeMS()?.setPositionState({ duration: d, playbackRate: audio.playbackRate || 1, position: Math.min(t, d) }); } catch {}
  }
});
let lastNativePos = 0;
audio.addEventListener('ended', () => { S.repeat === 'one' ? seek(0, true) : next(true); });

/* ---------------- autoplay radio ---------------- */
/** Append up to 12 related tracks when the queue runs dry. Falls back to
 *  random picks so the music never just stops. Returns how many were added. */
function extendRadio() {
  const cur = current();
  if (!cur) return 0;
  const inQ = new Set(S.queue);
  let adds = relatedTo(cur.id, 60).map((r) => r.track)
    .filter((t) => t && !inQ.has(t.id)).slice(0, 12).map((t) => t.id);
  if (!adds.length) {
    const pool = all().map((t) => t.id).filter((id) => !inQ.has(id));
    for (let i = 0; i < 12 && pool.length; i++) {
      adds.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
    }
  }
  if (adds.length) { S.queue.push(...adds); emit('radio', adds.length); }
  return adds.length;
}

/* ---------------- queue ops ---------------- */
/* Restore a queue synced from another device WITHOUT auto-playing (browsers
   block autoplay anyway, and we don't want to count a play). The chrome paints
   via the 'restore' event; the first Play press loads the current track. */
let restored = false;
export function restoreQueue(ids, pos) {
  if (!Array.isArray(ids) || !ids.length) return false;
  S.queue = ids.map(String);
  S.pos = (Number.isInteger(pos) && pos >= 0 && pos < S.queue.length) ? pos : 0;
  prewarmedFor = null;
  restored = true;
  const t = current();
  emit('queue');
  if (t) emit('restore', t);
  return true;
}
export function playNow(ids, startIndex = 0) {
  S.queue = [...ids];
  S.pos = startIndex;
  prewarmedFor = null;
  if (S.shuffle) reshuffleKeepingCurrent();
  const t = current();
  if (t) loadAndPlay(t);
  emit('queue');
}
export function enqueue(id) {
  S.queue.push(id);
  if (S.pos === -1) { S.pos = 0; const t = current(); if (t) loadAndPlay(t); }
  emit('queue');
}
/** Insert right after the playing track ("Play next"). */
export function playNext(id) {
  if (S.pos === -1) return enqueue(id);
  S.queue.splice(S.pos + 1, 0, id);
  prewarmedFor = null;
  emit('queue');
}
export function removeAt(i) {
  if (i < 0 || i >= S.queue.length) return;
  const wasCurrent = i === S.pos;
  S.queue.splice(i, 1);
  if (i < S.pos) S.pos--;
  if (wasCurrent) {
    if (!S.queue.length) { S.pos = -1; audio.pause(); audio.removeAttribute('src'); }
    else { S.pos = Math.min(S.pos, S.queue.length - 1); loadAndPlay(current()); }
  }
  prewarmedFor = null;
  emit('queue');
}
/** Reorder: move queue item from index i to index j. */
export function moveInQueue(i, j) {
  if (i === j || i < 0 || j < 0 || i >= S.queue.length || j >= S.queue.length) return;
  const [id] = S.queue.splice(i, 1);
  S.queue.splice(j, 0, id);
  if (i === S.pos) S.pos = j;
  else if (i < S.pos && j >= S.pos) S.pos--;
  else if (i > S.pos && j <= S.pos) S.pos++;
  prewarmedFor = null;
  emit('queue');
}
export function jumpTo(i) {
  if (i < 0 || i >= S.queue.length) return;
  S.pos = i; loadAndPlay(current()); emit('queue');
}
export function next(auto = false) {
  if (S.pos + 1 < S.queue.length) { S.pos++; loadAndPlay(current()); }
  else if (S.repeat === 'all' && S.queue.length) { S.pos = 0; loadAndPlay(current()); }
  else if (settings.autoplay && extendRadio()) { S.pos++; loadAndPlay(current()); }
  else if (!auto && S.queue.length) { S.pos = S.queue.length - 1; }
  emit('queue');
}
export function prev() {
  if (audio.currentTime > 3) return seek(0, true);
  if (S.pos > 0) { S.pos--; loadAndPlay(current()); emit('queue'); }
  else seek(0, true);
}
export function toggle() {
  const c = current();
  if (!c) return;
  if (restored && audio.paused) { restored = false; loadAndPlay(c); return; }  // resume a device-synced queue
  if (audio.paused) { audio.play().catch(() => {}); if (actx?.state === 'suspended') actx.resume(); }
  else audio.pause();
}
export function seek(t, alsoPlay = false) {
  if (Number.isFinite(t)) audio.currentTime = t;
  if (alsoPlay) audio.play().catch(() => {});
}
export function setShuffle(v) {
  S.shuffle = v;
  if (v) reshuffleKeepingCurrent();
  emit('queue');
}
function reshuffleKeepingCurrent() {
  if (S.pos < 0) { shuffleArray(S.queue); return; }
  const cur = S.queue[S.pos];
  const rest = S.queue.filter((_, i) => i !== S.pos);
  shuffleArray(rest);
  S.queue = [cur, ...rest];
  S.pos = 0;
}
function shuffleArray(a) {
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
}
export function cycleRepeat() {
  S.repeat = S.repeat === 'off' ? 'all' : S.repeat === 'all' ? 'one' : 'off';
  emit('queue');
  return S.repeat;
}

/* ---------------- Media Session (lock screen / notification controls) ------
   This is also what Bluetooth devices and car head units see. In the browser
   the standard navigator.mediaSession is enough; inside the Capacitor APK the
   WebView's mediaSession does NOT create a real Android media session, so the
   notification shade shows nothing and volume keys / Android Auto fall back
   to whatever app owned audio last (usually Spotify). The
   @jofr/capacitor-media-session plugin (installed by build-apk.yml) bridges
   the same calls to a native MediaSession + foreground-service notification,
   which fixes lock screen, notification shade, volume keys and lets Android
   Auto control playback. (Full Android Auto browsing UI would need a native
   MediaBrowserService — out of scope for a web shell.) */
const nativeMS = () =>
  (window.Capacitor?.isNativePlatform?.() && window.Capacitor.Plugins?.MediaSession) || null;

function updateMediaSession(track) {
  const native = nativeMS();
  if (!native && !('mediaSession' in navigator)) return;
  const meta = {
    title: track.displayTitle,
    artist: track.mashupArtist,
    album: 'Bring Me The Mashup',
  };
  const setMeta = (m) => {
    if (native) { try { native.setMetadata(m); } catch {} }
    if ('mediaSession' in navigator) {
      try { navigator.mediaSession.metadata = new MediaMetadata(m); } catch {}
    }
  };
  setMeta(meta);
  // artist artwork on the lock screen, filled in async when we have it
  firstArtFor(track).then((u) => {
    if (!u || current()?.id !== track.id) return;
    setMeta({ ...meta, artwork: [{ src: u, sizes: '512x512', type: 'image/jpeg' }] });
  }).catch(() => {});
  const handlers = {
    play: () => { if (audio.paused) toggle(); },
    pause: () => { if (!audio.paused) toggle(); },
    previoustrack: () => prev(),
    nexttrack: () => next(),
    seekto: (d) => seek(d.seekTime),
  };
  for (const [action, h] of Object.entries(handlers)) {
    if (native) { try { native.setActionHandler({ action }, h); } catch {} }
    if ('mediaSession' in navigator) {
      try { navigator.mediaSession.setActionHandler(action, h); } catch {}
    }
  }
}
