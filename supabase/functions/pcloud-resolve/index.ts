// Supabase Edge Function: pcloud-resolve
// Fallback resolver for browsers whose DNS can't reach api.pcloud.com
// (some ISP resolvers wrongly return "non-existent domain" for it).
// The site calls this only after trying pCloud directly.
//
// Deploy: Supabase dashboard → Edge Functions → Deploy new function →
// name it exactly `pcloud-resolve`, paste this file, deploy.
// Then in the function's Details → turn OFF "Enforce JWT verification"
// (this endpoint is public and returns nothing sensitive).

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const code = new URL(req.url).searchParams.get("code") ?? "";
  if (!/^[A-Za-z0-9]{10,80}$/.test(code)) {
    return json({ result: 1000, error: "bad code" }, 400);
  }

  for (const host of ["api.pcloud.com", "eapi.pcloud.com"]) {
    try {
      const r = await fetch(`https://${host}/getpublinkdownload?code=${code}`);
      const j = await r.json();
      if (j.result === 0 && j.hosts?.length) return json(j, 200);
    } catch (_) { /* try next host */ }
  }
  return json({ result: 7001, error: "could not resolve on any cluster" }, 502);
});

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}
