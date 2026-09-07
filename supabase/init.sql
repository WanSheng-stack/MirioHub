-- MirioHub core: profiles + system_configs (no legacy orders).
-- Marketplace: run `supabase/posts_init.sql` then `supabase/migrate_orders_to_posts.sql`.
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

drop policy if exists profiles_select_self on public.profiles;
create policy profiles_select_self on public.profiles
  for select using (id = auth.uid() or public.is_admin());

create or replace view public.profile_cards as
  select id, full_name, plate, vehicle, facebook, viber
  from public.profiles;

grant select on public.profile_cards to anon, authenticated;

drop policy if exists configs_select_all on public.system_configs;
create policy configs_select_all on public.system_configs
  for select using (true);

drop policy if exists configs_update_admin on public.system_configs;
create policy configs_update_admin on public.system_configs
  for update using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- grants
-- ---------------------------------------------------------------------------
grant usage on schema public to anon, authenticated;

grant select on public.system_configs to anon, authenticated;
grant update on public.system_configs to authenticated;

grant select on public.profiles to authenticated;

revoke all on function public.set_global_free_campaign(boolean) from public;
grant execute on function public.set_global_free_campaign(boolean) to authenticated;

revoke all on function public.admin_set_premium(uuid, boolean) from public;
grant execute on function public.admin_set_premium(uuid, boolean) to authenticated;

revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;

revoke all on function public.update_my_profile(text, text, text, text, text, text) from public;
grant execute on function public.update_my_profile(text, text, text, text, text, text) to authenticated;
