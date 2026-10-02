// converter.js — in-browser audio converter (ffmpeg.wasm). Files never leave the device.
import { FFmpeg } from './vendor/ffmpeg/index.js';

const CORE_VER = '0.12.10';
const CDNS = [
  `https://cdn.jsdelivr.net/npm/@ffmpeg/core@${CORE_VER}/dist/esm`,
  `https://unpkg.com/@ffmpeg/core@${CORE_VER}/dist/esm`,
];
// tests / self-hosting can override with ?core=<base url>
const CORE_OVERRIDE = new URLSearchParams(location.search).get('core');

const $ = (id) => document.getElementById(id);
const FORMATS = {
  mp3:  { label: 'MP3',          ext: 'mp3',  lossy: true },
  m4a:  { label: 'AAC (M4A)',    ext: 'm4a',  lossy: true },
  ogg:  { label: 'OGG Vorbis',   ext: 'ogg',  lossy: true },
  wav:  { label: 'WAV',          ext: 'wav',  lossy: false },
  flac: { label: 'FLAC',         ext: 'flac', lossy: false },
  aiff: { label: 'AIFF',         ext: 'aiff', lossy: false },
};
const BITRATES = {
  mp3:  ['320', '256', '192', '160', '128', '96', 'V0 (~245, best VBR)', 'V2 (~190 VBR)'],
  m4a:  ['320', '256', '192', '128', '96'],
  ogg:  ['320', '256', '192', '160', '128', '96'],
};
const DEPTHS = { wav: ['16', '24', '32 (float)'], flac: ['16', '24'], aiff: ['16', '24'] };
const LOSSLESS_CODECS = /^(pcm_|flac|alac|wavpack|tta|ape)/;

const files = []; // {id, file, info, status, out}
let coreBlobs = null, ffmpeg = null, loading = null, busy = false, nextId = 1, currentLog = null;

/* ---------- UI helpers ---------- */
const fmtSize = (b) => b > 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB';
const fmtDur = (s) => s == null ? '?' : Math.floor(s / 60) + ':' + String(Math.round(s % 60)).padStart(2, '0');
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function status(msg, kind) {
  const el = $('status');
  el.textContent = msg || '';
  el.className = 'note' + (kind ? ' ' + kind : '') + (msg ? '' : ' hidden');
}

/* ---------- ffmpeg loading ---------- */
async function blobURL(url, type) {
  const r = await fetch(url);
  if (!r.ok) throw new Error('HTTP ' + r.status + ' for ' + url);
  const total = +r.headers.get('content-length') || 0;
  if (!r.body || !total) return URL.createObjectURL(new Blob([await r.arrayBuffer()], { type }));
  const reader = r.body.getReader(); const chunks = []; let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value); got += value.length;
    if (type === 'application/wasm') status(`Loading converter engine… ${Math.round(got / total * 100)}% (one-time, cached after this)`);
  }
  return URL.createObjectURL(new Blob(chunks, { type }));
}

function ensureFFmpeg() {
  if (ffmpeg) return Promise.resolve(ffmpeg);
  if (loading) return loading;
  loading = (async () => {
    const bases = CORE_OVERRIDE ? [CORE_OVERRIDE] : CDNS;
    let lastErr;
    for (const base of bases) {
      try {
        status('Loading converter engine… (one-time, ~30 MB, cached after this)');
        if (!coreBlobs) coreBlobs = {
          coreURL: await blobURL(base + '/ffmpeg-core.js', 'text/javascript'),
          wasmURL: await blobURL(base + '/ffmpeg-core.wasm', 'application/wasm'),
        };
        const { coreURL, wasmURL } = coreBlobs;
        const ff = new FFmpeg();
        ff.on('log', ({ message }) => { if (currentLog) currentLog.push(message); });
        await ff.load({ coreURL, wasmURL });
        ffmpeg = ff; status('');
        return ff;
      } catch (e) { lastErr = e; console.warn('core load failed from', base, e); }
    }
    loading = null;
    throw new Error('Could not load the converter engine (' + (lastErr && lastErr.message || lastErr) + '). Check your connection and reload.');
  })();
  return loading;
}

/* ---------- probing (parses ffmpeg's own log) ---------- */
async function runLogged(ff, args) {
  currentLog = [];
  let code = 0;
  try { code = await ff.exec(args); } catch (e) { code = -1; }
  const log = currentLog.join('\n'); currentLog = null;
  return { code, log };
}
function parseInfo(log) {
  const info = {};
  let m = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(log);
  if (m) info.duration = +m[1] * 3600 + +m[2] * 60 + +m[3];
  m = /Duration:.*?bitrate:\s*(\d+)\s*kb\/s/.exec(log);
  if (m) info.totalKbps = +m[1];
  m = /Audio:\s*([a-z0-9_]+)[^,\n]*,\s*(\d+)\s*Hz,\s*([^,\n]+)(?:,\s*([a-z0-9]+))?(?:,\s*(\d+)\s*kb\/s)?/i.exec(log);
  if (m) {
    info.codec = m[1]; info.sampleRate = +m[2]; info.channels = m[3].trim();
    info.sampleFmt = m[4]; if (m[5]) info.kbps = +m[5];
    const b = /\((\d+) bit\)/.exec(log); if (b) info.bits = +b[1];
    if (!info.bits && /^pcm_/.test(info.codec)) { const q = /pcm_[su]?(\d+)/.exec(info.codec); if (q) info.bits = +q[1]; }
  }
  info.hasVideo = /Stream #.*Video:(?!.*attached pic)/.test(log);
  info.lossless = info.codec ? LOSSLESS_CODECS.test(info.codec) : null;
  return info;
}
// after a failed encode the wasm heap can be left in a bad state — start a fresh engine
function resetEngine() { try { ffmpeg && ffmpeg.terminate(); } catch (e) {} ffmpeg = null; loading = null; }
async function probe(item) {
  const ff = await ensureFFmpeg();
  const name = 'in_' + item.id;
  await ff.writeFile(name, new Uint8Array(await item.file.arrayBuffer()));
  const { log } = await runLogged(ff, ['-hide_banner', '-i', name]);
  await ff.deleteFile(name).catch(() => {});
  item.info = parseInfo(log);
  if (!item.info.codec) item.status = 'error', item.err = 'Not recognized as audio';
}

/* ---------- settings ---------- */
function settings() {
  const fmt = $('fmt').value;
  return {
    fmt, rate: $('rate').value, ch: $('ch').value,
    q: $('q').value, depth: $('depth').value,
    flacLevel: $('flaclvl').value,
  };
}
function buildArgs(inName, outName, s) {
  const a = ['-hide_banner', '-i', inName, '-vn', '-map', '0:a:0', '-map_metadata', '0'];
  let rate = s.rate;
  if (rate !== 'keep') a.push('-ar', rate);
  if (s.ch !== 'keep') a.push('-ac', s.ch);
  switch (s.fmt) {
    case 'mp3':
      a.push('-c:a', 'libmp3lame');
      if (s.q.startsWith('V')) a.push('-q:a', s.q[1]); else a.push('-b:a', s.q + 'k');
      a.push('-id3v2_version', '3'); break;
    case 'm4a': a.push('-c:a', 'aac', '-b:a', s.q + 'k', '-movflags', '+faststart', '-f', 'ipod'); break;
    case 'ogg': a.push('-c:a', 'libvorbis', '-b:a', s.q + 'k'); break;
    case 'flac':
      a.push('-c:a', 'flac', '-compression_level', s.flacLevel);
      a.push('-sample_fmt', s.depth === '24' ? 's32' : 's16');
      if (s.depth === '24') a.push('-bits_per_raw_sample', '24'); break;
    case 'wav':
      a.push('-c:a', s.depth === '24' ? 'pcm_s24le' : s.depth === '16' ? 'pcm_s16le' : 'pcm_f32le'); break;
    case 'aiff':
      a.push('-c:a', s.depth === '24' ? 'pcm_s24be' : 'pcm_s16be', '-f', 'aiff'); break;
  }
  a.push('-y', outName);
  return a;
}

function refreshControls() {
  const fmt = $('fmt').value, lossy = FORMATS[fmt].lossy;
  $('q-wrap').classList.toggle('hidden', !lossy);
  $('depth-wrap').classList.toggle('hidden', lossy);
  $('flac-wrap').classList.toggle('hidden', fmt !== 'flac');
  if (lossy) {
    const keep = $('q').value;
    $('q').innerHTML = BITRATES[fmt].map((b) => {
      const v = b.startsWith('V') ? b.split(' ')[0] : b;
      const label = b.startsWith('V') ? b : b + ' kbps';
      return `<option value="${v}">${label}</option>`;
    }).join('');
    if ([...$('q').options].some((o) => o.value === keep)) $('q').value = keep;
    else $('q').value = (fmt === 'm4a' ? '256' : (BITRATES[fmt].includes('320') ? '320' : '192'));
  } else {
    const keep = $('depth').value;
    $('depth').innerHTML = DEPTHS[fmt].map((d) => `<option value="${d.split(' ')[0]}">${d.replace(/^(\d+)$/, '$1-bit').replace(/^(\d+) \((\w+)\)/, '$1-bit $2')}</option>`).join('');
    $('depth').value = [...$('depth').options].some((o) => o.value === keep) ? keep : (fmt === 'wav' ? '24' : '16');
  }
  renderList();
}

function warnings(item, s) {
  const w = [], i = item.info; if (!i || !i.codec) return w;
  const f = FORMATS[s.fmt];
  if (i.lossless === false && !f.lossy) w.push('Source is lossy — a lossless copy keeps its quality but won’t improve it.');
  if (i.lossless === false && f.lossy) w.push('Lossy → lossy re-encode loses a little more quality. Use a lossless source when you have one.');
  const target = f.lossy ? +s.q.replace(/\D.*/, '') : 0;
  if (f.lossy && !s.q.startsWith('V') && i.kbps && target > i.kbps + 8) w.push(`Source is ~${i.kbps} kbps; ${target} kbps just makes a bigger file.`);
  if (s.rate !== 'keep' && i.sampleRate && +s.rate > i.sampleRate) w.push(`Upsampling ${i.sampleRate / 1000} → ${+s.rate / 1000} kHz adds size, not detail.`);
  return w;
}

/* ---------- rendering ---------- */
function infoLine(i) {
  if (!i) return '<span class="dim">Reading file…</span>';
  if (!i.codec) return '<span class="dim">—</span>';
  const bits = [i.codec.toUpperCase().replace(/^PCM_/, 'PCM '), i.sampleRate ? i.sampleRate / 1000 + ' kHz' : '', i.channels,
    i.bits ? i.bits + '-bit' : '', (i.kbps || i.totalKbps) ? (i.kbps || i.totalKbps) + ' kbps' : '', fmtDur(i.duration),
    i.lossless === true ? 'lossless' : i.lossless === false ? 'lossy' : ''].filter(Boolean);
  return bits.map(esc).join(' · ');
}
function renderList() {
  const s = settings();
  $('list').innerHTML = files.map((it) => {
    const ws = warnings(it, s).map((t) => `<div class="warn">⚠ ${esc(t)}</div>`).join('');
    const st = it.status === 'done' ? `<span class="pill ok2">Done · ${fmtSize(it.out.data.length)}</span>`
      : it.status === 'working' ? `<span class="pill work">${it.pct || 0}%</span>`
      : it.status === 'error' ? `<span class="pill bad">${esc(it.err || 'Error')}</span>` : '';
    const dl = it.status === 'done' ? `<button class="chip" data-dl="${it.id}">Download</button>` : '';
    return `<div class="file"><div class="t"><b>${esc(it.file.name)}</b><span>${fmtSize(it.file.size)} · ${infoLine(it.info)}</span>${ws}</div>${st}${dl}<button class="x" data-rm="${it.id}" title="Remove">✕</button></div>`;
  }).join('');
  const has = files.length > 0, done = files.filter((f) => f.status === 'done').length;
  $('go').disabled = busy || !files.some((f) => f.info && f.info.codec);
  $('zip').classList.toggle('hidden', done < 2);
  $('clear').classList.toggle('hidden', !has);
  $('empty').classList.toggle('hidden', has);
}

/* ---------- adding files ---------- */
async function addFiles(list) {
  const added = [];
  for (const file of list) {
    if (file.size > 400 * 1048576) { status(`${file.name} is over 400 MB — too big for in-browser conversion.`, 'err'); continue; }
    const it = { id: nextId++, file, info: null, status: 'new' };
    files.push(it); added.push(it);
  }
  renderList();
  if (!added.length) return;
  try {
    await ensureFFmpeg();
    for (const it of added) {
      status(`Reading ${it.file.name}…`);
      await probe(it); renderList();
    }
    status('');
  } catch (e) { status(e.message, 'err'); }
}

/* ---------- converting ---------- */
async function convertAll() {
  if (busy) return;
  busy = true; renderList(); status('');
  const s = settings(), f = FORMATS[s.fmt];
  try {
    let ff = await ensureFFmpeg(), failed = false;
    for (const it of files) {
      if (!it.info || !it.info.codec) continue;
      it.status = 'working'; it.pct = 0; renderList();
      const inName = 'in_' + it.id, outName = 'out_' + it.id + '.' + f.ext;
      const onProg = ({ progress }) => { it.pct = Math.max(0, Math.min(100, Math.round(progress * 100))); renderList(); };
      ff.on('progress', onProg);
      try {
        await ff.writeFile(inName, new Uint8Array(await it.file.arrayBuffer()));
        const { code, log } = await runLogged(ff, buildArgs(inName, outName, s));
        if (code !== 0) throw new Error((/(Error|Invalid|not supported|Unknown encoder)[^\n]*/.exec(log) || ['Conversion failed'])[0].slice(0, 120));
        const data = await ff.readFile(outName);
        const base = it.file.name.replace(/\.[^.]+$/, '');
        it.out = { data, name: `${base}.${f.ext}`, mime: 'audio/' + (f.ext === 'm4a' ? 'mp4' : f.ext) };
        it.status = 'done';
      } catch (e) { it.status = 'error'; it.err = e.message; failed = true; }
      finally { ff.off('progress', onProg); await ff.deleteFile(inName).catch(() => {}); await ff.deleteFile(outName).catch(() => {}); }
      if (failed) { failed = false; resetEngine(); ff = await ensureFFmpeg(); }
      renderList();
    }
    status('Finished. Download each file, or grab them all as a ZIP.', 'ok');
  } catch (e) { status(e.message, 'err'); }
  busy = false; renderList();
}

/* ---------- downloads ---------- */
function save(blob, name) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 60000);
}
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (u8) => { let c = 0xFFFFFFFF; for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
function makeZip(entries) { // store-only zip (audio is already compressed)
  const enc = new TextEncoder(), parts = [], central = []; let off = 0;
  const used = new Set();
  for (const e of entries) {
    let name = e.name, n = 1; while (used.has(name)) name = e.name.replace(/(\.[^.]+)$/, ` (${n++})$1`); used.add(name);
    const nm = enc.encode(name), crc = crc32(e.data), sz = e.data.length;
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, 0, true);
    lh.setUint32(14, crc, true); lh.setUint32(18, sz, true); lh.setUint32(22, sz, true); lh.setUint16(26, nm.length, true);
    parts.push(lh, nm, e.data);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true);
    ch.setUint32(16, crc, true); ch.setUint32(20, sz, true); ch.setUint32(24, sz, true); ch.setUint16(28, nm.length, true); ch.setUint32(42, off, true);
    central.push(ch, nm);
    off += 30 + nm.length + sz;
  }
  const cdSize = central.reduce((n, p) => n + (p.byteLength ?? p.length), 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, entries.length, true); end.setUint16(10, entries.length, true);
  end.setUint32(12, cdSize, true); end.setUint32(16, off, true);
  return new Blob([...parts, ...central, end], { type: 'application/zip' });
}

/* ---------- wiring ---------- */
$('fmt').innerHTML = Object.entries(FORMATS).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join('');
$('fmt').value = 'wav';
refreshControls();
for (const id of ['fmt']) $(id).addEventListener('change', refreshControls);
for (const id of ['rate', 'ch', 'q', 'depth', 'flaclvl']) $(id).addEventListener('change', renderList);

const drop = $('drop');
drop.addEventListener('click', () => $('pick').click());
$('pick').addEventListener('change', (e) => { addFiles([...e.target.files]); e.target.value = ''; });
['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
drop.addEventListener('drop', (e) => addFiles([...e.dataTransfer.files]));
$('go').addEventListener('click', convertAll);
$('clear').addEventListener('click', () => { if (busy) return; files.length = 0; status(''); renderList(); });
$('zip').addEventListener('click', () => {
  const outs = files.filter((f) => f.status === 'done').map((f) => f.out);
  if (outs.length) save(makeZip(outs), 'converted-audio.zip');
});
$('list').addEventListener('click', (e) => {
  const dl = e.target.closest('[data-dl]'), rm = e.target.closest('[data-rm]');
  if (dl) { const it = files.find((f) => f.id === +dl.dataset.dl); save(new Blob([it.out.data], { type: it.out.mime }), it.out.name); }
  if (rm && !busy) { const i = files.findIndex((f) => f.id === +rm.dataset.rm); if (i >= 0) files.splice(i, 1); renderList(); }
});
window.__converter = { files }; // handy for debugging
