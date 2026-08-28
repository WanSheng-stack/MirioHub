-- MirioHub P2 marketplace core: unified `posts` (Demand + Provider).
-- Safe to run after phase-1 profiles exist. Prefer also running
-- `supabase/migrate_orders_to_posts.sql` for matches / unlocks / RPCs.
-- Does NOT create the legacy `orders` table.

create extension if not exists "pgcrypto";
create extension if not exists "postgis";

-- ---------------------------------------------------------------------------
-- posts — single feed for demand / provider across near · city · intercity · cross-border
-- ---------------------------------------------------------------------------
create table if not exists public.posts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,

  title text not null,
  description text not null default '',

  status text not null default 'draft'
    check (status in ('draft', 'active', 'completed', 'canceled')),
  locale text not null default 'sr'
    check (locale in ('zh', 'en', 'sr')),

  -- Dual-end identity (mirrors left = demand, right = provider in UI)
  post_type text not null
    check (post_type in ('demand', 'provider')),
  category text not null
    check (category in ('deliver', 'buy', 'onsite', 'errand', 'travel')),

  -- Geo / scope
  scope text not null
    check (scope in ('near', 'city', 'intercity', 'cross_border')),
  origin_address text not null default '',
  destination_address text not null default '',
  -- WGS84 points for future map matching (nullable until user pins a location)
  origin_gps geography(Point, 4326),
  destination_gps geography(Point, 4326),

  -- Capacity / vehicle (dynamic transport-agnostic)
  -- backpack 🎒 · suitcase 🧳 · trunk 🚗
  capacity_type text
    check (capacity_type is null or capacity_type in ('backpack', 'suitcase', 'trunk')),
  transport_mode text
    check (
      transport_mode is null
      or transport_mode in (
        'walking',
        'scooter',
        'bicycle',
        'motorbike',
        'subway',
        'bus',
        'train',
        'flight',
        'car',
        'van'
      )
    ),
  escort_seats integer not null default 0 check (escort_seats >= 0),

  -- Economics
  fee_amount numeric(12, 2),
  -- Only meaningful for category = 'buy' (estimated goods float / advance)
  estimated_item_cost numeric(12, 2),

  -- Cached description translations keyed by locale
  translations jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),

  constraint posts_buy_cost_check check (
    estimated_item_cost is null or category = 'buy'
  )
);

comment on table public.posts is
  'Unified marketplace posts: demand (left) + provider (right). Replaces city-only orders for P2 hall.';
comment on column public.posts.capacity_type is 'backpack | suitcase | trunk';
comment on column public.posts.escort_seats is
  'Provider: free escort/cargo seats offered. Demand: escort seats requested.';
comment on column public.posts.fee_amount is
  'Demand: willing pay. Provider: expected fuel/cost share.';
comment on column public.posts.origin_gps is 'PostGIS geography Point SRID 4326';
comment on column public.posts.destination_gps is 'PostGIS geography Point SRID 4326';

-- Hall feed + filters
create index if not exists posts_created_at_idx on public.posts (created_at desc);
create index if not exists posts_active_feed_idx
  on public.posts (created_at desc)
  where status = 'active';
create index if not exists posts_type_idx on public.posts (post_type);
create index if not exists posts_category_idx on public.posts (category);
create index if not exists posts_scope_idx on public.posts (scope);
create index if not exists posts_user_id_idx on public.posts (user_id);
create index if not exists posts_origin_gps_gix on public.posts using gist (origin_gps);
create index if not exists posts_destination_gps_gix on public.posts using gist (destination_gps);

-- Keep updated_at fresh
create or replace function public.set_posts_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists posts_set_updated_at on public.posts;
create trigger posts_set_updated_at
  before update on public.posts
  for each row
  execute function public.set_posts_updated_at();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.posts enable row level security;

-- Public hall + detail: anyone can read active/completed; drafts only own
drop policy if exists posts_select_active_or_own on public.posts;
create policy posts_select_active_or_own on public.posts
  for select
  using (
    status in ('active', 'completed')
    or auth.uid() = user_id
  );

drop policy if exists posts_insert_own on public.posts;
create policy posts_insert_own on public.posts
  for insert
  with check (auth.uid() = user_id);

drop policy if exists posts_update_own on public.posts;
create policy posts_update_own on public.posts
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists posts_delete_own on public.posts;
create policy posts_delete_own on public.posts
  for delete
  using (auth.uid() = user_id);

grant select on public.posts to anon, authenticated;
grant insert, update, delete on public.posts to authenticated;

-- ---------------------------------------------------------------------------
-- Helpers: insert GPS from lat/lng (optional; UI can call these later)
-- ---------------------------------------------------------------------------
-- Example:
--   origin_gps = ST_SetSRID(ST_MakePoint(lng, lat), 4326)::geography
-- Note: longitude first, then latitude.
