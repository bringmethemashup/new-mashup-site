-- DNS-fallback resolver as a database function (replaces the Edge Function,
-- which the functions gateway kept blocking with 401s).
-- Run this whole file once in: Supabase dashboard → SQL Editor → Run.
--
-- The site calls it via POST /rest/v1/rpc/pcloud_resolve — the same REST
-- pipeline as everything else, so no extra auth configuration needed.

create extension if not exists http with schema extensions;

create or replace function public.pcloud_resolve(link_code text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  resp jsonb;
begin
  if link_code !~ '^[A-Za-z0-9]{10,80}$' then
    return jsonb_build_object('result', 1000, 'error', 'bad code');
  end if;

  -- US cluster first
  begin
    select content::jsonb into resp
    from extensions.http_get('https://api.pcloud.com/getpublinkdownload?code=' || link_code);
    if (resp ->> 'result')::int = 0 then
      return resp;
    end if;
  exception when others then
    resp := null;
  end;

  -- EU cluster fallback
  begin
    select content::jsonb into resp
    from extensions.http_get('https://eapi.pcloud.com/getpublinkdownload?code=' || link_code);
    if (resp ->> 'result')::int = 0 then
      return resp;
    end if;
  exception when others then
    resp := null;
  end;

  return coalesce(resp, jsonb_build_object('result', 7001, 'error', 'unreachable'));
end
$$;

grant execute on function public.pcloud_resolve(text) to anon, authenticated;
