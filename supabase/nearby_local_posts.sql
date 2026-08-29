-- Nearby buy/onsite/errand posts ordered by ST_Distance (5→20→50km gravity via client rings).
create or replace function public.nearby_local_posts(
  p_lng double precision,
  p_lat double precision,
  p_limit integer default 60
)
returns table (
  id uuid,
  distance_m double precision
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    p.id,
    st_distance(
      coalesce(p.origin_gps, p.destination_gps),
      st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography
    ) as distance_m
  from public.posts p
  where p.status = 'active'
    and p.category in ('buy', 'onsite', 'errand')
    and coalesce(p.origin_gps, p.destination_gps) is not null
    and st_dwithin(
      coalesce(p.origin_gps, p.destination_gps),
      st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography,
      50000
    )
  order by distance_m asc
  limit greatest(1, least(coalesce(p_limit, 60), 200));
$$;

grant execute on function public.nearby_local_posts(double precision, double precision, integer) to authenticated, anon;
