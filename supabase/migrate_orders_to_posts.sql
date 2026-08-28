-- MirioHub: cut over remaining orders-era tables/RPCs onto `posts`.
-- Run in Supabase SQL Editor AFTER relying on /posts/[id] in the app.
-- Safe if `orders` was already CASCADE-dropped.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- posts: translation cache column (for /api/translate)
-- ---------------------------------------------------------------------------
alter table public.posts
  add column if not exists translations jsonb not null default '{}'::jsonb;

comment on column public.posts.translations is 'Cached description translations keyed by locale (sr|en|zh)';

-- ---------------------------------------------------------------------------
-- Drop orders-era RPCs / tables (may already be gone via CASCADE)
-- ---------------------------------------------------------------------------
drop function if exists public.reveal_contact(uuid);
drop function if exists public.confirm_match(uuid);
drop function if exists public.cancel_match_no_fault(uuid);
drop function if exists public.cache_order_translation(uuid, text, text);

drop table if exists public.contact_unlocks cascade;
drop table if exists public.matches cascade;
drop table if exists public.orders cascade;

-- ---------------------------------------------------------------------------
-- matches (mutual confirm + no-fault cancel on demand side)
-- ---------------------------------------------------------------------------
create table public.matches (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts (id) on delete cascade,
  demand_user_id uuid not null references public.profiles (id),
  provider_user_id uuid not null references public.profiles (id),
  confirmed_at timestamptz,
  cancelled_at timestamptz,
  cancelled_by uuid references public.profiles (id),
  created_at timestamptz not null default timezone('utc', now()),
  unique (post_id)
);

create index if not exists matches_post_id_idx on public.matches (post_id);

-- ---------------------------------------------------------------------------
-- contact_unlocks: audit + prevent double-charging quota
-- ---------------------------------------------------------------------------
create table public.contact_unlocks (
  user_id uuid not null references public.profiles (id) on delete cascade,
  post_id uuid not null references public.posts (id) on delete cascade,
  unlocked_at timestamptz not null default timezone('utc', now()),
  mode text not null check (mode in ('campaign', 'premium', 'quota', 'author')),
  server_utc timestamptz not null,
  primary key (user_id, post_id)
);

-- ---------------------------------------------------------------------------
-- reveal_contact(p_post_id)
-- ---------------------------------------------------------------------------
create or replace function public.reveal_contact(p_post_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := timezone('utc', now());
  v_uid uuid := auth.uid();
  v_campaign boolean;
  v_post public.posts%rowtype;
  v_me public.profiles%rowtype;
  v_phone text;
  v_mode text;
  v_existing public.contact_unlocks%rowtype;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'AUTH', 'server_utc', v_now);
  end if;

  select * into v_post from public.posts where id = p_post_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'NOT_FOUND', 'server_utc', v_now);
  end if;

  select phone into v_phone from public.profiles where id = v_post.user_id;
  if coalesce(btrim(v_phone), '') = '' then
    return jsonb_build_object('ok', false, 'error', 'NO_PHONE', 'server_utc', v_now);
  end if;

  select * into v_existing
  from public.contact_unlocks
  where user_id = v_uid and post_id = p_post_id;

  if found then
    return jsonb_build_object(
      'ok', true,
      'phone', v_phone,
      'unlock_mode', v_existing.mode,
      'already_unlocked', true,
      'server_utc', v_now
    );
  end if;

  if v_post.user_id = v_uid then
    v_mode := 'author';
    insert into public.contact_unlocks (user_id, post_id, mode, server_utc)
    values (v_uid, p_post_id, v_mode, v_now);
    return jsonb_build_object(
      'ok', true,
      'phone', v_phone,
      'unlock_mode', v_mode,
      'already_unlocked', false,
      'server_utc', v_now
    );
  end if;

  select is_global_free_campaign into v_campaign
  from public.system_configs
  where id = 1
  for share;

  if coalesce(v_campaign, false) then
    v_mode := 'campaign';
    insert into public.contact_unlocks (user_id, post_id, mode, server_utc)
    values (v_uid, p_post_id, v_mode, v_now);
    return jsonb_build_object(
      'ok', true,
      'phone', v_phone,
      'unlock_mode', v_mode,
      'campaign', true,
      'server_utc', v_now
    );
  end if;

  select * into v_me from public.profiles where id = v_uid for update;

  if v_me.is_premium then
    v_mode := 'premium';
    insert into public.contact_unlocks (user_id, post_id, mode, server_utc)
    values (v_uid, p_post_id, v_mode, v_now);
    return jsonb_build_object(
      'ok', true,
      'phone', v_phone,
      'unlock_mode', v_mode,
      'is_premium', true,
      'server_utc', v_now
    );
  end if;

  if v_me.free_views_left > 0 then
    update public.profiles
      set free_views_left = free_views_left - 1,
          updated_at = v_now
      where id = v_uid;
    v_mode := 'quota';
    insert into public.contact_unlocks (user_id, post_id, mode, server_utc)
    values (v_uid, p_post_id, v_mode, v_now);
    return jsonb_build_object(
      'ok', true,
      'phone', v_phone,
      'unlock_mode', v_mode,
      'free_views_left', v_me.free_views_left - 1,
      'server_utc', v_now
    );
  end if;

  return jsonb_build_object(
    'ok', false,
    'error', 'PAYWALL',
    'free_views_left', 0,
    'is_premium', false,
    'campaign', false,
    'server_utc', v_now
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- cache_post_translation
-- ---------------------------------------------------------------------------
create or replace function public.cache_post_translation(
  p_post_id uuid,
  p_locale text,
  p_text text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'error', 'AUTH');
  end if;
  if p_locale not in ('sr', 'en', 'zh') then
    return jsonb_build_object('ok', false, 'error', 'LOCALE');
  end if;

  update public.posts
    set translations = coalesce(translations, '{}'::jsonb) || jsonb_build_object(p_locale, p_text),
        updated_at = timezone('utc', now())
    where id = p_post_id;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'NOT_FOUND');
  end if;

  return jsonb_build_object('ok', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- confirm_match(p_post_id) — sets post status to completed
-- ---------------------------------------------------------------------------
create or replace function public.confirm_match(p_post_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_post public.posts%rowtype;
  v_demand uuid;
  v_provider uuid;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'AUTH');
  end if;

  select * into v_post from public.posts where id = p_post_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'NOT_FOUND');
  end if;
  if v_post.user_id = v_uid then
    return jsonb_build_object('ok', false, 'error', 'OWN_POST');
  end if;
  if v_post.status <> 'active' then
    return jsonb_build_object('ok', false, 'error', 'NOT_ACTIVE');
  end if;

  if v_post.post_type = 'demand' then
    v_demand := v_post.user_id;
    v_provider := v_uid;
  else
    v_provider := v_post.user_id;
    v_demand := v_uid;
  end if;

  insert into public.matches (post_id, demand_user_id, provider_user_id, confirmed_at)
  values (p_post_id, v_demand, v_provider, timezone('utc', now()));

  update public.posts
    set status = 'completed', updated_at = timezone('utc', now())
    where id = p_post_id;

  return jsonb_build_object('ok', true, 'demand_user_id', v_demand, 'provider_user_id', v_provider);
end;
$$;

-- ---------------------------------------------------------------------------
-- cancel_match_no_fault(p_post_id) — demand side only; reopens as active
-- ---------------------------------------------------------------------------
create or replace function public.cancel_match_no_fault(p_post_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_match public.matches%rowtype;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'AUTH');
  end if;

  select * into v_match from public.matches where post_id = p_post_id for update;
  if not found or v_match.cancelled_at is not null then
    return jsonb_build_object('ok', false, 'error', 'NO_MATCH');
  end if;

  if v_match.demand_user_id <> v_uid then
    return jsonb_build_object('ok', false, 'error', 'FORBIDDEN');
  end if;

  update public.matches
    set cancelled_at = timezone('utc', now()), cancelled_by = v_uid
    where id = v_match.id;

  update public.posts
    set status = 'active', updated_at = timezone('utc', now())
    where id = p_post_id;

  return jsonb_build_object('ok', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.matches enable row level security;
alter table public.contact_unlocks enable row level security;

drop policy if exists matches_select_party on public.matches;
create policy matches_select_party on public.matches
  for select
  using (auth.uid() = demand_user_id or auth.uid() = provider_user_id);

drop policy if exists unlocks_select_own on public.contact_unlocks;
create policy unlocks_select_own on public.contact_unlocks
  for select
  using (auth.uid() = user_id);

grant select on public.matches to authenticated;
grant select on public.contact_unlocks to authenticated;

revoke all on function public.reveal_contact(uuid) from public;
grant execute on function public.reveal_contact(uuid) to authenticated;

revoke all on function public.confirm_match(uuid) from public;
grant execute on function public.confirm_match(uuid) to authenticated;

revoke all on function public.cancel_match_no_fault(uuid) from public;
grant execute on function public.cancel_match_no_fault(uuid) to authenticated;

revoke all on function public.cache_post_translation(uuid, text, text) from public;
grant execute on function public.cache_post_translation(uuid, text, text) to authenticated;

-- Allow reading completed posts on detail (after mutual match)
drop policy if exists posts_select_active_or_own on public.posts;
create policy posts_select_active_or_own on public.posts
  for select
  using (
    status in ('active', 'completed')
    or auth.uid() = user_id
  );
