-- MirioHub posts v2: anti-fraud fields, luggage units, completion codes, bank verify
-- Run AFTER posts_init.sql

-- ---------------------------------------------------------------------------
-- profiles: bank verification
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column if not exists is_bank_verified boolean not null default false,
  add column if not exists bank_reference_code text;

comment on column public.profiles.is_bank_verified is 'Activated via 100 RSD transfer with Poziv na broj';
comment on column public.profiles.bank_reference_code is '6-digit reference derived from user UUID';

-- ---------------------------------------------------------------------------
-- phone_history / plate_history — lightweight asset traceability
-- ---------------------------------------------------------------------------
create table if not exists public.phone_history (
  id serial primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  normalized_phone text not null,
  last_post_at timestamptz not null default timezone('utc', now()),
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists phone_history_normalized_idx on public.phone_history (normalized_phone);
create index if not exists phone_history_user_idx on public.phone_history (user_id);

-- 【完美纠正处】：将旧的 normalized_plate 升级为全局统一的 normalized_license_plate 
create table if not exists public.plate_history (
  id serial primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  normalized_license_plate text not null,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists plate_history_normalized_idx on public.plate_history (normalized_license_plate);

-- ---------------------------------------------------------------------------
-- fraud_logs — silent anti-abuse audit trail
-- ---------------------------------------------------------------------------
-- 【完美纠正处】：同步修正日志表中的字段
create table if not exists public.fraud_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles (id) on delete set null,
  scene text not null,
  normalized_phone text,
  normalized_license_plate text,
  reporter_side text,
  created_at timestamptz not null default timezone('utc', now())
);

alter table public.phone_history enable row level security;
alter table public.plate_history enable row level security;
alter table public.fraud_logs enable row level security;

drop policy if exists phone_history_insert_own on public.phone_history;
create policy phone_history_insert_own on public.phone_history
  for insert with check (auth.uid() = user_id);

drop policy if exists phone_history_select_own on public.phone_history;
create policy phone_history_select_own on public.phone_history
  for select using (auth.uid() = user_id);

drop policy if exists plate_history_insert_own on public.plate_history;
create policy plate_history_insert_own on public.plate_history
  for insert with check (auth.uid() = user_id);

drop policy if exists plate_history_select_own on public.plate_history;
create policy plate_history_select_own on public.plate_history
  for select using (auth.uid() = user_id);

drop policy if exists fraud_logs_insert_authenticated on public.fraud_logs;
create policy fraud_logs_insert_authenticated on public.fraud_logs
  for insert with check (auth.uid() is not null);

grant insert, select on public.phone_history to authenticated;
grant insert, select on public.plate_history to authenticated;
grant insert on public.fraud_logs to authenticated;

-- ---------------------------------------------------------------------------
-- posts: extended payload columns
-- ---------------------------------------------------------------------------
alter table public.posts
  add column if not exists delivery_mode text check (delivery_mode is null or delivery_mode in ('spot', 'door')),
  add column if not exists share_mode text check (share_mode is null or share_mode in ('share', 'private')),
  add column if not exists max_companions integer check (max_companions is null or (max_companions >= 1 and max_companions <= 4)),
  add column if not exists item_condition text check (item_condition is null or item_condition in ('new', 'used')),
  add column if not exists phone_id integer,
  add column if not exists raw_phone text,
  add column if not exists normalized_phone text,
  add column if not exists plate_id integer,
  add column if not exists raw_license_plate text,
  add column if not exists normalized_license_plate text,
  add column if not exists provider_name text,
  add column if not exists vehicle_brand text,
  add column if not exists vehicle_color text,
  add column if not exists departure_date date,
  add column if not exists departure_time_window text,
  add column if not exists estimated_arrival_time timestamptz,
  add column if not exists waypoints jsonb default '[]'::jsonb,
  add column if not exists item_quantity numeric(12, 2),
  add column if not exists item_unit text check (item_unit is null or item_unit in ('pcs', 'kg', 'g', 'l', 'ml', 'box', 'pack', 'bottle')),
  add column if not exists price_calc_type text check (price_calc_type is null or price_calc_type in ('unit', 'total')),
  add column if not exists item_price numeric(12, 2),
  add column if not exists count_small integer not null default 0,
  add column if not exists count_medium integer not null default 0,
  add column if not exists count_large integer not null default 0,
  add column if not exists count_xlarge integer not null default 0,
  add column if not exists has_luggage boolean,
  add column if not exists min_budget numeric(12, 2),
  add column if not exists max_budget numeric(12, 2),
  add column if not exists purchase_price_type text check (purchase_price_type is null or purchase_price_type in ('range', 'negotiable')),
  add column if not exists bump_fee numeric(12, 2) not null default 0,
  add column if not exists service_address text,
  add column if not exists service_time_window text,
  add column if not exists provider_pay_type text check (provider_pay_type is null or provider_pay_type in ('hourly', 'fixed', 'negotiable')),
  add column if not exists pickup_code text,
  add column if not exists delivery_code text,
  add column if not exists completion_type text check (completion_type is null or completion_type in ('standard', 'auto_melt')),
  add column if not exists completion_note text,
  add column if not exists matched_at timestamptz,
  add column if not exists auto_melt_deadline timestamptz;

-- Extend status for match lifecycle
alter table public.posts drop constraint if exists posts_status_check;
alter table public.posts add constraint posts_status_check
  check (status in ('draft', 'active', 'matched', 'pending_completion', 'completed', 'canceled'));

create index if not exists posts_normalized_phone_idx on public.posts (normalized_phone);
create index if not exists posts_normalized_plate_idx on public.posts (normalized_license_plate);
create index if not exists posts_departure_idx on public.posts (departure_date, departure_time_window);

-- Allow reading phone_history for intercept (same normalized across users — admin only select all)
drop policy if exists phone_history_select_intercept on public.phone_history;
create policy phone_history_select_intercept on public.phone_history
  for select using (true);

-- Allow reading plate_history for intercept
drop policy if exists plate_history_select_intercept on public.plate_history;
create policy plate_history_select_intercept on public.plate_history
  for select using (true);

-- Generate bank reference code on profile
create or replace function public.generate_bank_reference(p_user_id uuid)
returns text
language sql
immutable
as $$
  select lpad((abs(hashtext(p_user_id::text)) % 1000000)::text, 6, '0');
$$;

-- Provider completion: auto_melt with 72h deadline
create or replace function public.submit_auto_melt(
  p_post_id uuid,
  p_completion_note text,
  p_reason_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_post public.posts%rowtype;
  v_deadline timestamptz;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'AUTH');
  end if;

  select * into v_post from public.posts where id = p_post_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'NOT_FOUND');
  end if;

  v_deadline := timezone('utc', now()) + interval '72 hours';

  update public.posts
    set completion_type = 'auto_melt',
        completion_note = coalesce(p_completion_note, '') || ' [' || p_reason_key || ']',
        status = 'pending_completion',
        auto_melt_deadline = v_deadline,
        updated_at = timezone('utc', now())
    where id = p_post_id;

  return jsonb_build_object('ok', true, 'deadline', v_deadline);
end;
$$;

grant execute on function public.submit_auto_melt(uuid, text, text) to authenticated;
