/**
 * waveform.js — real song waveform (SoundCloud-style) for the full player.
 *
 * Fetches the current track's audio, decodes it, and reduces it to N peak
 * buckets that visualizer.js renders as the scrubbable waveform. Peaks are
 * cached per track (memory + localStorage, quantized to 1 byte each) so a
 * song is only ever downloaded/decoded once per device.
 *
 * Needs a CORS-readable URL — the same requirement the AnalyserNode already
 * has, so any track whose visualizer reacts to the music can also produce a
 * waveform. If fetch/decode fails we resolve null and the full player keeps
 * its aurora animation (and the thin seek bar still works).
 */
const BUCKETS = 320;
const LS_KEY = 'bmtm.peaks.v1';
const MAX_CACHED = 60;          // ~320 bytes each -> caps at ~26 KB of storage
const MAX_BYTES = 60 * 1024 * 1024; // don't try to decode absurdly large files

const mem = new Map();          // trackId -> Float32Array
const inflight = new Map();     // trackId -> Promise

function lsLoad() {
  try { return JSON.parse(localStorage.getItem(LS_KEY) || '{"order":[],"data":{}}'); }
  catch { return { order: [], data: {} }; }
}
function lsSave(store) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(store)); } catch {}
}
function lsGet(id) {
  const store = lsLoad();
  const b64 = store.data[id];
  if (!b64) return null;
  try {
    const bin = atob(b64);
    const out = new Float32Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i) / 255;
    return out;
  } catch { return null; }
}
function lsPut(id, peaks) {
  const store = lsLoad();
  let bin = '';
  for (let i = 0; i < peaks.length; i++) bin += String.fromCharCode(Math.round(peaks[i] * 255));
  if (!store.data[id]) store.order.push(id);
  store.data[id] = btoa(bin);
  while (store.order.length > MAX_CACHED) {
    const old = store.order.shift();
    delete store.data[old];
  }
  lsSave(store);
}

let dctx = null; // decode-only context; fine to create without a user gesture
function decoder() {
  if (!dctx) dctx = new (window.AudioContext || window.webkitAudioContext)();
  return dctx;
}

function computePeaks(buf) {
  const peaks = new Float32Array(BUCKETS);
  const chs = Math.min(buf.numberOfChannels, 2);
  const len = buf.length;
  const per = len / BUCKETS;
  for (let c = 0; c < chs; c++) {
    const data = buf.getChannelData(c);
    for (let i = 0; i < BUCKETS; i++) {
      const start = Math.floor(i * per), end = Math.min(len, Math.floor((i + 1) * per));
      const step = Math.max(1, Math.floor((end - start) / 600)); // sample, don't scan every frame
      let max = 0;
      for (let j = start; j < end; j += step) {
        const v = Math.abs(data[j]);
        if (v > max) max = v;
      }
      if (max > peaks[i]) peaks[i] = max;
    }
  }
  // normalize so quiet masters still fill the canvas
  let top = 0;
  for (let i = 0; i < BUCKETS; i++) if (peaks[i] > top) top = peaks[i];
  if (top > 0.01) for (let i = 0; i < BUCKETS; i++) peaks[i] = Math.min(1, peaks[i] / top);
  return peaks;
}

/**
 * Resolve the peaks for a track. `urls` is a single URL or an ordered list of
 * candidates (e.g. [direct pCloud host, relay]) — some hosts allow <audio>
 * playback but refuse fetch()/CORS reads, and the relay always allows both.
 * Returns Float32Array(BUCKETS) of 0..1, or null when every candidate failed.
 */
export function getPeaks(trackId, urls) {
  const list = (Array.isArray(urls) ? urls : [urls]).filter(Boolean);
  if (!trackId || !list.length) return Promise.resolve(null);
  if (mem.has(trackId)) return Promise.resolve(mem.get(trackId));
  const stored = lsGet(trackId);
  if (stored) { mem.set(trackId, stored); return Promise.resolve(stored); }
  if (inflight.has(trackId)) return inflight.get(trackId);

  const fetchAndDecode = async (url) => {
    const res = await fetch(url, { mode: 'cors' });
    if (!res.ok) throw new Error('waveform fetch ' + res.status);
    const clen = +res.headers.get('content-length') || 0;
    if (clen > MAX_BYTES) throw new Error('waveform: file too large');
    const ab = await res.arrayBuffer();
    if (ab.byteLength > MAX_BYTES) throw new Error('waveform: file too large');
    const buf = await decoder().decodeAudioData(ab);
    return computePeaks(buf);
  };

  const p = (async () => {
    let lastErr;
    for (const url of list) {
      try {
        const peaks = await fetchAndDecode(url);
        mem.set(trackId, peaks);
        lsPut(trackId, peaks);
        return peaks;
      } catch (e) { lastErr = e; }
    }
    throw lastErr || new Error('waveform: no usable source');
  })().catch((e) => { console.warn('waveform unavailable', e); return null; })
     .finally(() => inflight.delete(trackId));

  inflight.set(trackId, p);
  return p;
}
