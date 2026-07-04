-- Removes the two placeholder "Demo Artist (replace me)" seed tracks from the
-- live catalog. Run this once in the Supabase dashboard:
--   Supabase project -> SQL Editor -> New query -> paste -> Run.
--
-- Supabase is the single source of truth for the catalogue, so deleting here
-- is what actually removes them from the app. (The demo rows are also stripped
-- from data/catalog.json, the offline fallback.)

delete from public.tracks
where id in ('demo-other-artist-youtube', 'demo-other-artist-tiktok');

-- Catch-all in case the ids ever change: remove anything still attributed to the
-- placeholder mashup artist.
delete from public.tracks
where data->>'mashupArtist' = 'Demo Artist (replace me)';

-- Verify none remain (should return 0 rows):
select id, data->>'displayTitle' as title, data->>'mashupArtist' as artist
from public.tracks
where data->>'mashupArtist' = 'Demo Artist (replace me)';
