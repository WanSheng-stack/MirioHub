-- MirioHub phase-1 schema: orders hall, contact RPC, RLS.
-- Run in Supabase SQL editor (or psql) on a fresh project.
-- Grant the first admin after signup:
--   update public.profiles set is_admin = true where id = '<auth user uuid>';

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text,
  phone text,
  plate text,
  vehicle text,
  facebook text,
  viber text,
  is_premium boolean not null default false,
  is_admin boolean not null default false,
  free_views_left integer not null default 3 check (free_views_left >= 0),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

-- ---------------------------------------------------------------------------
-- system_configs (singleton). Campaign switch lives HERE — never in app code.
-- ---------------------------------------------------------------------------
create table if not exists public.system_configs (
  id smallint primary key default 1 check (id = 1),
  is_global_free_campaign boolean not null default true,
  must_read_sr text not null default '',
  must_read_en text not null default '',
  must_read_zh text not null default '',
  bank_name text not null default 'Banca Intesa Beograd',
  bank_recipient text not null default 'MirioHub',
  bank_account text not null default '160-0000000000000-00',
  bank_reference text not null default 'PREMIUM',
  ips_qr_url text not null default '/ips-qr.svg',
  wechat_support_hint text not null default '请添加微信客服并备注 Premium 开通。',
  updated_at timestamptz not null default timezone('utc', now()),
  updated_by uuid references public.profiles (id)
);

insert into public.system_configs (id, is_global_free_campaign, must_read_sr, must_read_en, must_read_zh)
values (
  1,
  true,
  'Uvek proverite identitet i teret na licu mesta. MirioHub je samo oglasna tabla; ne odgovaramo za štetu, krađu ili sporove.',
  'Always verify identity and goods in person. MirioHub is a notice board only; we are not liable for damage, theft, or disputes.',
  '务必现场核对身份与物品。MirioHub 仅为互助信息板，不对任何损毁、盗窃或纠纷承担责任。请信息不符即无责离开。'
)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- orders (intercity + same-city errands). from_city may equal to_city.
-- ---------------------------------------------------------------------------
create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.profiles (id) on delete cascade,
  role text not null check (role in ('DEMAND', 'PROVIDER')),
  title text not null,
  description text not null default '',
  task_notes text not null default '',
  from_city text not null,
  to_city text not null,
  source_locale text not null default 'sr' check (source_locale in ('sr', 'en', 'zh')),
  translations jsonb not null default '{}'::jsonb,
  status text not null default 'open' check (status in ('open', 'matched', 'cancelled')),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists orders_created_at_idx on public.orders (created_at desc);
create index if not exists orders_role_idx on public.orders (role);

-- ---------------------------------------------------------------------------
-- matches (mutual confirm + no-fault cancel on DEMAND side)
-- ---------------------------------------------------------------------------
create table if not exists public.matches (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  demand_user_id uuid not null references public.profiles (id),
  provider_user_id uuid not null references public.profiles (id),
  confirmed_at timestamptz,
  cancelled_at timestamptz,
  cancelled_by uuid references public.profiles (id),
  created_at timestamptz not null default timezone('utc', now()),
  unique (order_id)
);

-- ---------------------------------------------------------------------------
-- contact_unlocks: audit + prevent double-charging quota
-- ---------------------------------------------------------------------------
create table if not exists public.contact_unlocks (
  user_id uuid not null references public.profiles (id) on delete cascade,
  order_id uuid not null references public.orders (id) on delete cascade,
  unlocked_at timestamptz not null default timezone('utc', now()),
  mode text not null check (mode in ('campaign', 'premium', 'quota', 'author')),
  server_utc timestamptz not null,
  primary key (user_id, order_id)
);

-- ---------------------------------------------------------------------------
-- signup → profile
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, phone)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    coalesce(new.raw_user_meta_data ->> 'phone', '')
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- helpers
-- ---------------------------------------------------------------------------
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select is_admin from public.profiles where id = auth.uid()), false);
$$;

-- Reveal phone. Gate uses cloud UTC now() + system_configs.is_global_free_campaign.
-- Never returns phone on PAYWALL / AUTH failure.
create or replace function public.reveal_contact(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := timezone('utc', now());
  v_uid uuid := auth.uid();
  v_campaign boolean;
  v_order public.orders%rowtype;
  v_me public.profiles%rowtype;
  v_phone text;
  v_mode text;
  v_existing public.contact_unlocks%rowtype;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'AUTH', 'server_utc', v_now);
  end if;

  select * into v_order from public.orders where id = p_order_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'NOT_FOUND', 'server_utc', v_now);
  end if;

  select phone into v_phone from public.profiles where id = v_order.author_id;
  if coalesce(btrim(v_phone), '') = '' then
    return jsonb_build_object('ok', false, 'error', 'NO_PHONE', 'server_utc', v_now);
  end if;

  select * into v_existing
  from public.contact_unlocks
  where user_id = v_uid and order_id = p_order_id;

  if found then
    return jsonb_build_object(
      'ok', true,
      'phone', v_phone,
      'unlock_mode', v_existing.mode,
      'already_unlocked', true,
      'server_utc', v_now
    );
  end if;

  if v_order.author_id = v_uid then
    v_mode := 'author';
    insert into public.contact_unlocks (user_id, order_id, mode, server_utc)
    values (v_uid, p_order_id, v_mode, v_now);
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
    insert into public.contact_unlocks (user_id, order_id, mode, server_utc)
    values (v_uid, p_order_id, v_mode, v_now);
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
    insert into public.contact_unlocks (user_id, order_id, mode, server_utc)
    values (v_uid, p_order_id, v_mode, v_now);
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
    insert into public.contact_unlocks (user_id, order_id, mode, server_utc)
    values (v_uid, p_order_id, v_mode, v_now);
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

create or replace function public.cache_order_translation(
  p_order_id uuid,
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

  update public.orders
    set translations = coalesce(translations, '{}'::jsonb) || jsonb_build_object(p_locale, p_text),
        updated_at = timezone('utc', now())
    where id = p_order_id;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'NOT_FOUND');
  end if;

  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.set_global_free_campaign(p_enabled boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := timezone('utc', now());
begin
  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'error', 'FORBIDDEN', 'server_utc', v_now);
  end if;

  update public.system_configs
    set is_global_free_campaign = p_enabled,
        updated_at = v_now,
        updated_by = auth.uid()
    where id = 1;

  return jsonb_build_object(
    'ok', true,
    'is_global_free_campaign', p_enabled,
    'server_utc', v_now
  );
end;
$$;

create or replace function public.confirm_match(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_order public.orders%rowtype;
  v_demand uuid;
  v_provider uuid;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'AUTH');
  end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'NOT_FOUND');
  end if;
  if v_order.author_id = v_uid then
    return jsonb_build_object('ok', false, 'error', 'OWN_ORDER');
  end if;
  if v_order.status <> 'open' then
    return jsonb_build_object('ok', false, 'error', 'NOT_OPEN');
  end if;

  if v_order.role = 'DEMAND' then
    v_demand := v_order.author_id;
    v_provider := v_uid;
  else
    v_provider := v_order.author_id;
    v_demand := v_uid;
  end if;

  insert into public.matches (order_id, demand_user_id, provider_user_id, confirmed_at)
  values (p_order_id, v_demand, v_provider, timezone('utc', now()));

  update public.orders
    set status = 'matched', updated_at = timezone('utc', now())
    where id = p_order_id;

  return jsonb_build_object('ok', true, 'demand_user_id', v_demand, 'provider_user_id', v_provider);
end;
$$;

create or replace function public.cancel_match_no_fault(p_order_id uuid)
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

  select * into v_match from public.matches where order_id = p_order_id for update;
  if not found or v_match.cancelled_at is not null then
    return jsonb_build_object('ok', false, 'error', 'NO_MATCH');
  end if;

  -- Only the DEMAND party may no-fault cancel (现场信息不符).
  if v_match.demand_user_id <> v_uid then
    return jsonb_build_object('ok', false, 'error', 'FORBIDDEN');
  end if;

  update public.matches
    set cancelled_at = timezone('utc', now()), cancelled_by = v_uid
    where id = v_match.id;

  update public.orders
    set status = 'open', updated_at = timezone('utc', now())
    where id = p_order_id;

  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.update_my_profile(
  p_full_name text,
  p_phone text,
  p_plate text,
  p_vehicle text,
  p_facebook text,
  p_viber text
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

  update public.profiles
    set full_name = p_full_name,
        phone = p_phone,
        plate = p_plate,
        vehicle = p_vehicle,
        facebook = p_facebook,
        viber = p_viber,
        updated_at = timezone('utc', now())
    where id = auth.uid();

  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.admin_set_premium(p_user_id uuid, p_premium boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'error', 'FORBIDDEN');
  end if;
  update public.profiles
    set is_premium = p_premium, updated_at = timezone('utc', now())
    where id = p_user_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'NOT_FOUND');
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.system_configs enable row level security;
alter table public.orders enable row level security;
alter table public.matches enable row level security;
alter table public.contact_unlocks enable row level security;

-- profiles: never expose other users' phone via table SELECT
create policy profiles_select_self on public.profiles
  for select using (id = auth.uid() or public.is_admin());

-- Public card fields only (no phone). View owner bypasses RLS; phone is not selected.
create or replace view public.profile_cards as
  select id, full_name, plate, vehicle, facebook, viber
  from public.profiles;

grant select on public.profile_cards to anon, authenticated;

-- configs: world-readable (must-read + campaign hint). Writes via admin policy / RPC.
create policy configs_select_all on public.system_configs
  for select using (true);

create policy configs_update_admin on public.system_configs
  for update using (public.is_admin()) with check (public.is_admin());

-- orders: public feed, no phone column on this table
create policy orders_select_all on public.orders
  for select using (true);

create policy orders_insert_own on public.orders
  for insert with check (auth.uid() = author_id);

create policy orders_update_own on public.orders
  for update using (auth.uid() = author_id);

create policy orders_delete_own on public.orders
  for delete using (auth.uid() = author_id);

create policy matches_select_party on public.matches
  for select using (
    auth.uid() = demand_user_id
    or auth.uid() = provider_user_id
    or public.is_admin()
  );

create policy unlocks_select_own on public.contact_unlocks
  for select using (auth.uid() = user_id or public.is_admin());

-- ---------------------------------------------------------------------------
-- grants
-- ---------------------------------------------------------------------------
grant usage on schema public to anon, authenticated;

grant select on public.system_configs to anon, authenticated;
grant update on public.system_configs to authenticated;

grant select, insert, update, delete on public.orders to authenticated;
grant select on public.orders to anon;

grant select on public.profiles to authenticated;

grant select on public.matches to authenticated;
grant select on public.contact_unlocks to authenticated;

revoke all on function public.reveal_contact(uuid) from public;
grant execute on function public.reveal_contact(uuid) to authenticated;

revoke all on function public.cache_order_translation(uuid, text, text) from public;
grant execute on function public.cache_order_translation(uuid, text, text) to authenticated;

revoke all on function public.set_global_free_campaign(boolean) from public;
grant execute on function public.set_global_free_campaign(boolean) to authenticated;

revoke all on function public.confirm_match(uuid) from public;
grant execute on function public.confirm_match(uuid) to authenticated;

revoke all on function public.cancel_match_no_fault(uuid) from public;
grant execute on function public.cancel_match_no_fault(uuid) to authenticated;

revoke all on function public.admin_set_premium(uuid, boolean) from public;
grant execute on function public.admin_set_premium(uuid, boolean) to authenticated;

revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;

revoke all on function public.update_my_profile(text, text, text, text, text, text) from public;
grant execute on function public.update_my_profile(text, text, text, text, text, text) to authenticated;
