/**
 * visualizer.js — real-time audio-reactive visuals (no artwork exists, so this
 * IS the artwork). Web Audio AnalyserNode drives a smooth "aurora" spectrum
 * plus drifting particles. Renders into the full-player canvas and a mini
 * canvas simultaneously from one rAF loop.
 *
 * CORS note: pCloud file hosts must allow cross-origin reads for AnalyserNode
 * to see data (we set audio.crossOrigin = "anonymous"). If the browser refuses
 * (tainted media), player.js tells us and we fall back to a graceful
 * time-driven "ambient" animation so the UI never looks dead.
 */
let analyser = null, freq = null, wave = null;
let ambient = true;          // true = simulated (no analyser data)
let playing = false;
let targets = [];            // [{canvas, ctx, mode:'full'|'mini'}]
let raf = 0, t0 = performance.now();

/* real song waveform (from waveform.js) — when present, the full player draws
   the actual track SoundCloud-style instead of the aurora, split at `progress`
   into played (accent) and unplayed (dim) halves. app.js feeds progress. */
let peaks = null;            // Float32Array of 0..1, or null -> aurora
let progress = 0;            // 0..1 through the song
let windowFrac = 1;          // fraction of the song visible across the canvas
let songDur = 0;
export function setPeaks(p) { peaks = p && p.length ? p : null; }
export function setProgress(v) { progress = Math.min(1, Math.max(0, v || 0)); }
export function setDuration(d) { songDur = d > 0 ? d : 0; }
export function setWindow(v) { windowFrac = Math.min(1, Math.max(0.02, v || 1)); }
export const getWindow = () => windowFrac;
export const hasPeaks = () => !!peaks;

const P = [];                // particles
const PCOUNT = 42;

export function setAnalyser(a) {
  analyser = a;
  ambient = !a;
  if (a) { freq = new Uint8Array(a.frequencyBinCount); wave = new Uint8Array(a.fftSize); }
}

/* ---- beat detection (drives the BRING ME THE "MASHUP" logo pulse) ----
   Bass-band energy flux against a rolling baseline. Real beats need analyser
   data (pCloud audio with CORS); in ambient mode (YouTube-only / tainted
   stream) we emit a gentle steady pulse instead so the logo never plays dead. */
const beatFns = [];
export function onBeat(fn) { beatFns.push(fn); }
let bAvg = 0, bLast = 0, lastBeatAt = 0, lastAmbientBeat = 0;
function detectBeat(now) {
  if (!playing || !beatFns.length) return;
  if (!ambient && analyser) {
    let e = 0; const n = 10;                       // lowest bins = bass/kick
    for (let i = 0; i < n; i++) e += freq[i];
    e /= n * 255;
    bAvg = bAvg * 0.97 + e * 0.03;                 // rolling baseline
    const rising = e - bLast > 0.02;
    if (rising && e > bAvg * 1.3 && e > 0.25 && now - lastBeatAt > 240) {
      lastBeatAt = now;
      const strength = Math.max(0.2, Math.min(1, (e - bAvg) * 3));
      beatFns.forEach((f) => f(strength));
    }
    bLast = e;
  } else if (now - lastAmbientBeat > 700) {        // no data: soft steady pulse
    lastAmbientBeat = now;
    beatFns.forEach((f) => f(0.3));
  }
}
export function setAmbient(v) { ambient = v || !analyser; }
export function setPlaying(v) { playing = v; }

export function attach(canvas, mode) {
  const ctx = canvas.getContext('2d');
  targets = targets.filter((t) => t.canvas !== canvas);
  targets.push({ canvas, ctx, mode });
  if (!raf) raf = requestAnimationFrame(loop);
}

function themeColors() {
  const cs = getComputedStyle(document.documentElement);
  return {
    accent: cs.getPropertyValue('--accent').trim(),
    accent2: cs.getPropertyValue('--accent-2').trim(),
    dim: cs.getPropertyValue('--text-dim').trim(),
    dark: document.documentElement.dataset.theme === 'dark',
  };
}

function sample(i, n, time) {
  // returns 0..1 energy for bin i of n
  if (!ambient && analyser) {
    const idx = Math.floor(Math.pow(i / n, 1.6) * (freq.length * 0.72));
    return freq[idx] / 255;
  }
  // ambient: layered sines, gently animated; livelier when "playing"
  const sp = playing ? 1 : 0.35;
  const x = i / n;
  return 0.22 + 0.16 * Math.sin(time * 0.0012 * sp + x * 5.1)
       + 0.12 * Math.sin(time * 0.0021 * sp + x * 11.7 + 2)
       + 0.07 * Math.sin(time * 0.0034 * sp + x * 23.3 + 4);
}

function ensureParticles(w, h) {
  while (P.length < PCOUNT) {
    P.push({ x: Math.random() * w, y: Math.random() * h, r: 1 + Math.random() * 2.5,
             vx: (Math.random() - .5) * .3, vy: -0.2 - Math.random() * .5, a: Math.random() });
  }
}

function loop(now) {
  raf = requestAnimationFrame(loop);
  if (!ambient && analyser) { analyser.getByteFrequencyData(freq); analyser.getByteTimeDomainData(wave); }
  detectBeat(now);
  const { accent, accent2, dark } = themeColors();
  const time = now - t0;

  for (const t of targets) {
    const { canvas, ctx, mode } = t;
    if (!canvas.isConnected) continue;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = canvas.clientWidth * dpr, H = canvas.clientHeight * dpr;
    if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
    if (!W || !H) continue;
    ctx.clearRect(0, 0, W, H);

    if (mode === 'mini') {
      // compact: 5 rounded bars
      const n = 5, gap = W * 0.10, bw = (W - gap * (n + 1)) / n;
      ctx.fillStyle = accent;
      for (let i = 0; i < n; i++) {
        const e = sample((i + 1) / (n + 2) * n, n, time);
        const bh = Math.max(H * 0.12, e * H * 0.86);
        const x = gap + i * (bw + gap), y = (H - bh) / 2;
        ctx.beginPath(); ctx.roundRect(x, y, bw, bh, bw / 2); ctx.fill();
      }
      continue;
    }

    ensureParticles(W, H);
    const grad = ctx.createLinearGradient(0, 0, W, 0);
    grad.addColorStop(0, accent); grad.addColorStop(1, accent2);

    if (peaks) {
      // ---- real waveform, Audacity-style, SCROLLING view ----
      // The playhead is FIXED at the horizontal center; the waveform slides
      // past it as the song plays. `windowFrac` (set by app.js, ~45 s worth)
      // is how much of the song spans the canvas. Rigid bars mirrored around
      // a center line — nothing pulses; the only motion is the scroll.
      const n = peaks.length;
      const mid = H * 0.5;
      const wfr = windowFrac;
      const pxPerBucket = W / (n * wfr);        // bar pitch at this zoom
      const bw = Math.max(dpr, pxPerBucket - Math.max(1, dpr)); // hairline gap
      const cx = W / 2;                          // fixed playhead position

      const first = Math.max(0, Math.floor((progress - wfr / 2) * n) - 1);
      const last = Math.min(n - 1, Math.ceil((progress + wfr / 2) * n) + 1);
      const drawBars = () => {
        for (let i = first; i <= last; i++) {
          const x = cx + (i / n - progress) * (W / wfr);
          if (x + pxPerBucket < 0 || x > W) continue;
          const h = Math.max(dpr * 2, peaks[i] * H * 0.88);
          ctx.fillRect(x, mid - h / 2, bw, h);  // symmetric above/below center
        }
      };
      // played (left of playhead): accent gradient
      ctx.save();
      ctx.beginPath(); ctx.rect(0, 0, cx, H); ctx.clip();
      ctx.fillStyle = grad;
      drawBars();
      ctx.restore();
      // upcoming (right of playhead): dim
      ctx.save();
      ctx.beginPath(); ctx.rect(cx, 0, W - cx, H); ctx.clip();
      ctx.fillStyle = dark ? 'rgba(255,255,255,.30)' : 'rgba(0,0,0,.24)';
      drawBars();
      ctx.restore();
      // center line through the waveform (Audacity-style)
      ctx.fillStyle = dark ? 'rgba(255,255,255,.18)' : 'rgba(0,0,0,.14)';
      ctx.fillRect(0, mid - dpr / 2, W, dpr);
      // fixed playhead hairline
      ctx.fillStyle = dark ? 'rgba(255,255,255,.9)' : 'rgba(0,0,0,.7)';
      ctx.fillRect(cx - dpr / 2, mid - H * 0.47, dpr, H * 0.94);
    } else {

    // full: layered aurora spectrum, mirrored around a soft baseline
    const N = 96, base = H * 0.68;

    for (let layer = 2; layer >= 0; layer--) {
      const amp = H * (0.42 - layer * 0.10);
      const alpha = layer === 0 ? 0.9 : (layer === 1 ? 0.35 : 0.16);
      const off = layer * 40;
      ctx.beginPath();
      ctx.moveTo(0, base);
      for (let i = 0; i <= N; i++) {
        const x = (i / N) * W;
        const e = sample(i, N, time + off);
        const y = base - Math.pow(e, 1.35) * amp;
        if (i === 0) ctx.lineTo(x, y);
        else {
          const px = ((i - 1) / N) * W;
          ctx.quadraticCurveTo(px + (x - px) / 2, y, x, y);
        }
      }
      ctx.lineTo(W, base); ctx.closePath();
      ctx.globalAlpha = alpha; ctx.fillStyle = grad; ctx.fill();

      // mirrored reflection
      ctx.save();
      ctx.translate(0, base * 2); ctx.scale(1, -0.35);
      ctx.globalAlpha = alpha * 0.35; ctx.fill();
      ctx.restore();
    }
    ctx.globalAlpha = 1;
    } // end aurora fallback

    // particles rise with overall energy
    let energy = 0; const EN = 24;
    for (let i = 0; i < EN; i++) energy += sample(i, EN, time);
    energy /= EN;
    ctx.fillStyle = dark ? 'rgba(255,255,255,.55)' : 'rgba(0,0,0,.30)';
    for (const p of P) {
      p.x += p.vx * (1 + energy * 2); p.y += p.vy * (0.5 + energy * 3.2);
      p.a -= 0.0025;
      if (p.y < -10 || p.a <= 0) { p.x = Math.random() * W; p.y = H * (0.6 + Math.random() * 0.4); p.a = 0.5 + Math.random() * 0.5; }
      ctx.globalAlpha = p.a * (0.25 + energy * 0.75);
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r * dpr, 0, 7); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
}
