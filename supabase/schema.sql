-- ============================================================
-- Bring Me The Mashup — Supabase schema (Prompt 2)
-- Run this ONCE in the Supabase dashboard: SQL Editor → New query
-- → paste everything → Run.
-- ============================================================

-- ---------- profiles (one per auth user) ----------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  role text not null default 'listener' check (role in ('listener', 'artist')),
  is_admin boolean not null default false,
  youtube_channel text,
  created_at timestamptz not null default now()
);

-- auto-create a profile whenever someone signs up
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- helper used by policies (security definer avoids RLS recursion)
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select is_admin from public.profiles where id = auth.uid()), false)
$$;

-- users may edit their own profile (name, listener<->artist toggle)
-- but can never grant themselves admin
create or replace function public.protect_admin_flag()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- auth.uid() is null for direct SQL-editor/service-role queries, which are
  -- allowed to change the flag; signed-in users can never grant themselves admin
  if new.is_admin is distinct from old.is_admin
     and auth.uid() is not null
     and not public.is_admin() then
    new.is_admin := old.is_admin;
  end if;
  return new;
end $$;

create trigger profiles_protect_admin
  before update on public.profiles
  for each row execute function public.protect_admin_flag();

alter table public.profiles enable row level security;
create policy "profiles are readable by signed-in users"
  on public.profiles for select to authenticated using (true);
create policy "users update own profile"
  on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- ---------- tracks (single source of truth for the catalog) ----------
-- `data` holds the exact catalog.json entry shape from Prompt 1:
-- { id, mashupArtist, sourceSongs:[{artist,title}], displayTitle,
--   isOwnUpload, audio:{...}, video:{...}, year, specialAlbum, tags, ... }
create table public.tracks (
  id text primary key,
  owner uuid references auth.users (id) on delete set null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  data jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- second FK to profiles so PostgREST can embed owner profiles in queries
alter table public.tracks add constraint tracks_owner_profiles_fkey
  foreign key (owner) references public.profiles (id) on delete set null;

create index tracks_status_idx on public.tracks (status);
create index tracks_owner_idx on public.tracks (owner);

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;

create trigger tracks_touch before update on public.tracks
  for each row execute function public.touch_updated_at();

alter table public.tracks enable row level security;

-- everyone (even signed out) sees approved tracks;
-- artists also see their own pending/rejected ones; admin sees all
create policy "approved tracks are public"
  on public.tracks for select
  using (status = 'approved' or owner = auth.uid() or public.is_admin());

-- artists submit their own tracks; non-admins can only create PENDING rows
create policy "artists insert own pending tracks"
  on public.tracks for insert to authenticated
  with check (
    owner = auth.uid()
    and (
      public.is_admin()
      or (
        status = 'pending'
        and (select role from public.profiles where id = auth.uid()) = 'artist'
      )
    )
  );

-- admin edits anything anytime; artists may edit their own while still pending
create policy "admin or pending-owner updates tracks"
  on public.tracks for update to authenticated
  using (public.is_admin() or (owner = auth.uid() and status = 'pending'))
  with check (public.is_admin() or (owner = auth.uid() and status = 'pending'));

create policy "admin or pending-owner deletes tracks"
  on public.tracks for delete to authenticated
  using (public.is_admin() or (owner = auth.uid() and status = 'pending'));

-- ---------- likes ----------
create table public.likes (
  user_id uuid not null references auth.users (id) on delete cascade,
  track_id text not null references public.tracks (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, track_id)
);

alter table public.likes enable row level security;
create policy "users manage own likes" on public.likes
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------- play counts (synced version of the localStorage map) ----------
create table public.plays (
  user_id uuid not null references auth.users (id) on delete cascade,
  track_id text not null references public.tracks (id) on delete cascade,
  count integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, track_id)
);

alter table public.plays enable row level security;
create policy "users manage own plays" on public.plays
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------- playlists ----------
create table public.playlists (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  is_public boolean not null default false,   -- default PRIVATE
  created_at timestamptz not null default now()
);

alter table public.playlists enable row level security;
create policy "playlists: owner full access, public readable"
  on public.playlists for select
  using (owner = auth.uid() or is_public);
create policy "playlists: owner insert" on public.playlists
  for insert to authenticated with check (owner = auth.uid());
create policy "playlists: owner update" on public.playlists
  for update to authenticated using (owner = auth.uid()) with check (owner = auth.uid());
create policy "playlists: owner delete" on public.playlists
  for delete to authenticated using (owner = auth.uid());

create table public.playlist_tracks (
  playlist_id uuid not null references public.playlists (id) on delete cascade,
  track_id text not null references public.tracks (id) on delete cascade,
  position integer not null default 0,
  added_at timestamptz not null default now(),
  primary key (playlist_id, track_id)
);

alter table public.playlist_tracks enable row level security;
create policy "playlist tracks follow playlist access (read)"
  on public.playlist_tracks for select
  using (exists (select 1 from public.playlists p
                 where p.id = playlist_id and (p.owner = auth.uid() or p.is_public)));
create policy "playlist tracks: owner writes"
  on public.playlist_tracks for insert to authenticated
  with check (exists (select 1 from public.playlists p
                      where p.id = playlist_id and p.owner = auth.uid()));
create policy "playlist tracks: owner updates"
  on public.playlist_tracks for update to authenticated
  using (exists (select 1 from public.playlists p
                 where p.id = playlist_id and p.owner = auth.uid()));
create policy "playlist tracks: owner deletes"
  on public.playlist_tracks for delete to authenticated
  using (exists (select 1 from public.playlists p
                 where p.id = playlist_id and p.owner = auth.uid()));

-- ---------- storage: artist uploads ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('mashups', 'mashups', true, 104857600,  -- 100 MB per file
        array['audio/mpeg','audio/mp4','audio/aac','audio/ogg','audio/wav','audio/x-m4a','video/mp4','video/webm'])
on conflict (id) do nothing;

-- artists upload into a folder named after their own user id
create policy "artists upload own files" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'mashups'
    and (storage.foldername(name))[1] = auth.uid()::text
    and (select role from public.profiles where id = auth.uid()) = 'artist'
  );
create policy "anyone reads mashup files" on storage.objects
  for select using (bucket_id = 'mashups');
create policy "owner or admin deletes files" on storage.objects
  for delete to authenticated
  using (bucket_id = 'mashups'
         and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()));

-- ============================================================
-- AFTER you sign up on the site with your admin email, run the
-- two lines below (replace YOUR_EMAIL) to make that account the
-- admin + a mashup artist:
--
--   update public.profiles set is_admin = true, role = 'artist',
--     display_name = 'Bring Me The Mashup'
--   where id = (select id from auth.users where email = 'YOUR_EMAIL');
-- ============================================================
