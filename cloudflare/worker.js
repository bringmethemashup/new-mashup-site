/**
 * Bring Me The Mashup — audio relay (Cloudflare Worker)
 *
 * Purpose: some ISPs' DNS servers can't resolve api.pcloud.com, and pCloud
 * download links are locked to the IP that requested them — so the ONLY way
 * to serve those listeners is to resolve AND stream from the same place.
 * This worker does both: it turns a publink code into a download URL and
 * pipes the audio through itself. The site only uses it when a browser's
 * direct pCloud attempts fail, so most listeners never touch it.
 *
 * Deploy (Cloudflare dashboard):
 *   Workers & Pages -> Create -> Start with Hello World -> Deploy ->
 *   Edit code -> replace everything with this file -> Deploy.
 * The worker URL looks like: https://<name>.<your-subdomain>.workers.dev
 * Paste that URL into PCLOUD_RELAY_URL in js/config.js.
 */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
  'Access-Control-Allow-Headers': 'Range',
  'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges, Content-Type',
};

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });

    const url = new URL(request.url);
    const code = url.searchParams.get('code') || '';
    if (!/^[A-Za-z0-9]{10,80}$/.test(code)) {
      return new Response('bad code', { status: 400, headers: CORS });
    }

    // resolve the publink -> temporary download URL (from THIS worker's IP)
    let meta = null;
    for (const host of ['api.pcloud.com', 'eapi.pcloud.com']) {
      try {
        const r = await fetch(`https://${host}/getpublinkdownload?code=${code}`);
        const j = await r.json();
        if (j.result === 0 && j.hosts?.length) { meta = j; break; }
      } catch (_) { /* try next */ }
    }
    if (!meta) return new Response('could not resolve link', { status: 502, headers: CORS });

    // stream the file through, preserving Range requests so seeking works
    const fileUrl = 'https://' + meta.hosts[0] + meta.path;
    const upstreamHeaders = new Headers();
    const range = request.headers.get('Range');
    if (range) upstreamHeaders.set('Range', range);

    const upstream = await fetch(fileUrl, { headers: upstreamHeaders });
    const headers = new Headers(upstream.headers);
    for (const [k, v] of Object.entries(CORS)) headers.set(k, v);

    return new Response(request.method === 'HEAD' ? null : upstream.body, {
      status: upstream.status,
      headers,
    });
  },
};
