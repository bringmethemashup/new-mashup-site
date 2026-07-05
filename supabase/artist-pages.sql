-- Mashup-artist profile pages (bios for the new "Artists" section).
-- Run ONCE in Supabase -> SQL Editor. Safe to re-run (IF NOT EXISTS / OR REPLACE).
--
-- key      = normalized mashup-artist name (lowercase, collapsed spaces) —
--            matches what the site computes from catalog `mashupArtist` fields.
-- Public read; admins can write any page; a signed-in artist can write the
-- page whose name matches their profile display_name.

create table if not exists public.artist_pages (
  key        text primary key,
  name       text not null,
  bio        text,
  youtube    text,
  updated_by uuid references auth.users(id),
  updated_at timestamptz default now()
);

alter table public.artist_pages enable row level security;

drop policy if exists "artist pages are public" on public.artist_pages;
create policy "artist pages are public"
  on public.artist_pages for select using (true);

drop policy if exists "admins write any artist page" on public.artist_pages;
create policy "admins write any artist page"
  on public.artist_pages for all
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin));

drop policy if exists "artists write their own page" on public.artist_pages;
create policy "artists write their own page"
  on public.artist_pages for all
  using (exists (select 1 from public.profiles p
                 where p.id = auth.uid() and p.role = 'artist'
                   and lower(p.display_name) = lower(artist_pages.name)))
  with check (exists (select 1 from public.profiles p
                      where p.id = auth.uid() and p.role = 'artist'
                        and lower(p.display_name) = lower(artist_pages.name)));
