/**
 * player.js — queue, shuffle, repeat, pCloud-primary playback, Media Session.
 *
 * Playback model (per project brief):
 *   - pCloud audio via <audio> is ALWAYS the primary source when present.
 *   - YouTube is an optional *video view* toggle in the full player (podcast-
 *     style). Switching to video pauses audio; switching back resumes audio.
 *   - isOwnUpload:false entries have no audio object -> video/embed only.
 *
 * Web Audio: we try crossOrigin="anonymous" so an AnalyserNode can read the
 * stream for the visualizer. If the pCloud host ever fails CORS, we reload the
 * element without crossOrigin (audio still plays!) and flag the visualizer
 * into ambient mode. Never let the visualizer break playback.
 */
import { resolveAudioUrl, invalidate } from './pcloud.js';
import * as viz from './visualizer.js';
import { get } from './catalog.js';

export const audio = new Audio();
audio.preload = 'metadata';

let actx = null, srcNode = null, analyserOk = false;

const S = {
  queue: [],          // track ids
  pos: -1,
  shuffle: false,
  repeat: 'off',      // off | all | one
  corsBlocked: false, // learned at runtime
};
export const state = S;

const listeners = new Map();
export function on(ev, fn) { (listeners.get(ev) || listeners.set(ev, []).get(ev)).push(fn); }
function emit(ev, data) { (listeners.get(ev) || []).forEach((f) => f(data)); }

export const current = () => (S.pos >= 0 ? get(S.queue[S.pos]) : null);

/* ---------------- web audio graph ---------------- */
function ensureGraph() {
  if (analyserOk || S.corsBlocked) return;
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    srcNode = actx.createMediaElementSource(audio);
    const an = actx.createAnalyser();
    an.fftSize = 2048;
    an.smoothingTimeConstant = 0.82;
    srcNode.connect(an);
    an.connect(actx.destination);
    viz.setAnalyser(an);
    analyserOk = true;
  } catch (e) {
    console.warn('AnalyserNode unavailable, visualizer in ambient mode', e);
    viz.setAnalyser(null);
  }
}

/* ---------------- core load/play ---------------- */
let loadToken = 0;
async function loadAndPlay(track, { retried = false } = {}) {
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
    emit('error', { track, err });
  }
}

audio.addEventListener('error', () => {
  const t = current();
  if (t?.audio?.publicLink) { invalidate(t.audio.publicLink); }
});
audio.addEventListener('play', () => { viz.setPlaying(true); emit('play'); });
audio.addEventListener('pause', () => { viz.setPlaying(false); emit('pause'); });
audio.addEventListener('timeupdate', () => emit('time', { t: audio.currentTime, d: audio.duration || 0 }));
audio.addEventListener('ended', () => { S.repeat === 'one' ? seek(0, true) : next(true); });

/* ---------------- queue ops ---------------- */
export function playNow(ids, startIndex = 0) {
  S.queue = [...ids];
  S.pos = startIndex;
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
export function removeAt(i) {
  if (i === S.pos) return; // keep it simple: can't remove the playing row
  S.queue.splice(i, 1);
  if (i < S.pos) S.pos--;
  emit('queue');
}
export function jumpTo(i) {
  if (i < 0 || i >= S.queue.length) return;
  S.pos = i; loadAndPlay(current()); emit('queue');
}
export function next(auto = false) {
  if (S.pos + 1 < S.queue.length) { S.pos++; loadAndPlay(current()); }
  else if (S.repeat === 'all' && S.queue.length) { S.pos = 0; loadAndPlay(current()); }
  else if (!auto && S.queue.length) { S.pos = S.queue.length - 1; }
  emit('queue');
}
export function prev() {
  if (audio.currentTime > 3) return seek(0, true);
  if (S.pos > 0) { S.pos--; loadAndPlay(current()); emit('queue'); }
  else seek(0, true);
}
export function toggle() {
  if (!current()) return;
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

/* ---------------- Media Session (lock screen / notification controls) ------ */
function updateMediaSession(track) {
  if (!('mediaSession' in navigator)) return;
  navigator.mediaSession.metadata = new MediaMetadata({
    title: track.displayTitle,
    artist: track.mashupArtist,
    album: 'Bring Me The Mashup',
  });
  navigator.mediaSession.setActionHandler('play', () => toggle());
  navigator.mediaSession.setActionHandler('pause', () => toggle());
  navigator.mediaSession.setActionHandler('previoustrack', () => prev());
  navigator.mediaSession.setActionHandler('nexttrack', () => next());
  try {
    navigator.mediaSession.setActionHandler('seekto', (d) => seek(d.seekTime));
  } catch {}
}
