/**
 * pcloud.js — resolve pCloud public share links to direct, streamable URLs.
 *
 * A catalog entry stores a *share page* link like:
 *   https://u.pcloud.link/publink/show?code=XZic9q5Z...
 * That page is HTML, not audio. pCloud exposes an unauthenticated public API
 * that turns the link `code` into a temporary direct file URL:
 *
 *   GET https://api.pcloud.com/getpublinkdownload?code=<code>
 *   -> { result: 0, hosts: ["def3.pcloud.com", ...], path: "/....mp3", expires: "..." }
 *   direct URL = "https://" + hosts[0] + path
 *
 * IMPORTANT: these direct URLs EXPIRE (hours, not days). So:
 *  - we resolve lazily, at play time
 *  - we cache in localStorage with the API-provided expiry (minus a safety margin)
 *  - on an <audio> error we clear the cache entry and re-resolve once
 * Some accounts live on the EU cluster; if api.pcloud.com rejects the code we
 * retry against eapi.pcloud.com before giving up.
 */
import { PCLOUD_RELAY_URL } from './config.js';

const CACHE_KEY = 'bmtm.pcloud.cache.v1';
const SAFETY_MS = 10 * 60 * 1000; // treat links as dead 10 min before real expiry

let cache = {};
try { cache = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}'); } catch { cache = {}; }

const persist = () => { try { localStorage.setItem(CACHE_KEY, JSON.stringify(cache)); } catch {} };

export function extractCode(publicLink) {
  const m = /[?&]code=([A-Za-z0-9]+)/.exec(publicLink || '');
  return m ? m[1] : null;
}

async function callApi(host, code) {
  // referrerPolicy is REQUIRED: as of mid-2026 pCloud rejects getpublinkdownload
  // calls that carry a third-party Referer header with result 7010
  // ("Invalid link referer."). Omitting the referer makes it work again.
  const r = await fetch(`https://${host}/getpublinkdownload?code=${code}`, { referrerPolicy: 'no-referrer' });
  const j = await r.json();
  if (j.result !== 0 || !j.hosts?.length) throw new Error(`pCloud API result ${j.result}`);
  return j;
}

export async function resolveAudioUrl(publicLink, { force = false } = {}) {
  const code = extractCode(publicLink);
  if (!code) throw new Error('No pCloud code in link: ' + publicLink);

  const hit = cache[code];
  if (!force && hit && hit.exp > Date.now() + SAFETY_MS) return hit.url;

  // NOTE: plain server-side *resolution* cannot work as a fallback — pCloud
  // locks download URLs to the requesting IP. So when direct resolution
  // fails (broken ISP DNS), we stream through our relay worker instead,
  // which resolves AND serves the audio from the same IP.
  let j;
  try { j = await callApi('api.pcloud.com', code); }
  catch {
    try { j = await callApi('eapi.pcloud.com', code); }
    catch (e2) {
      if (!PCLOUD_RELAY_URL) throw e2;
      const url = `${PCLOUD_RELAY_URL.replace(/\/$/, '')}/?code=${code}`;
      cache[code] = { url, exp: Date.now() + 24 * 60 * 60 * 1000 }; // relay URL is stable
      persist();
      return url;
    }
  }

  const url = 'https://' + j.hosts[0] + j.path;
  const exp = Date.parse(j.expires) || (Date.now() + 2 * 60 * 60 * 1000);
  cache[code] = { url, exp };
  persist();
  return url;
}

export function invalidate(publicLink) {
  const code = extractCode(publicLink);
  if (code && cache[code]) { delete cache[code]; persist(); }
}
