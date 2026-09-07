-- PHASE 6.5B.6 hotfix — stable default nicknames + phone write boundary.
-- update_my_profile no longer accepts p_phone.
-- Phone writes go through server-validated APIs + update_my_account_phone (service_role).

CREATE OR REPLACE FUNCTION public.generate_mirio_display_name()
RETURNS text
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  chars text := '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  suffix text := '';
  i int;
BEGIN
  FOR i IN 1..7 LOOP
    suffix := suffix || substr(chars, 1 + floor(random() * length(chars))::int, 1);
  END LOOP;
  RETURN 'Mirio-' || suffix;
END;
$$;

REVOKE ALL ON FUNCTION public.generate_mirio_display_name() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.generate_mirio_display_name() FROM anon;
REVOKE ALL ON FUNCTION public.generate_mirio_display_name() FROM authenticated;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_name text;
BEGIN
  v_name := nullif(btrim(coalesce(new.raw_user_meta_data ->> 'full_name', '')), '');
  IF v_name IS NOT NULL THEN
    v_name := left(v_name, 50);
  ELSE
    v_name := public.generate_mirio_display_name();
  END IF;

  -- Phone is never taken from auth metadata. Metadata is unvalidated and
  -- would bypass parseUserPhone / the service-only writer.
  INSERT INTO public.profiles (id, full_name, phone)
  VALUES (
    new.id,
    v_name,
    ''
  );
  RETURN new;
END;
$$;

CREATE OR REPLACE FUNCTION public.ensure_my_display_name(p_preferred text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_name text;
  v_preferred text;
  v_generated text;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'AUTH');
  END IF;

  SELECT full_name INTO v_name
  FROM public.profiles
  WHERE id = auth.uid();

  IF nullif(btrim(coalesce(v_name, '')), '') IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'full_name', btrim(v_name), 'generated', false);
  END IF;

  v_preferred := nullif(btrim(coalesce(p_preferred, '')), '');
  IF v_preferred IS NOT NULL THEN
    v_preferred := left(v_preferred, 50);
    UPDATE public.profiles
      SET full_name = v_preferred,
          updated_at = timezone('utc', now())
      WHERE id = auth.uid()
        AND nullif(btrim(full_name), '') IS NULL;
  ELSE
    v_generated := public.generate_mirio_display_name();
    UPDATE public.profiles
      SET full_name = v_generated,
          updated_at = timezone('utc', now())
      WHERE id = auth.uid()
        AND nullif(btrim(full_name), '') IS NULL;
  END IF;

  SELECT full_name INTO v_name
  FROM public.profiles
  WHERE id = auth.uid();

  RETURN jsonb_build_object(
    'ok', true,
    'full_name', v_name,
    'generated', nullif(btrim(coalesce(v_name, '')), '') IS NOT NULL
  );
END;
$$;

REVOKE ALL ON FUNCTION public.ensure_my_display_name(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ensure_my_display_name(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.ensure_my_display_name(text) TO authenticated;

DROP FUNCTION IF EXISTS public.update_my_profile(text, text, text, text, text, text);

CREATE OR REPLACE FUNCTION public.update_my_profile(
  p_full_name text,
  p_plate text,
  p_vehicle text,
  p_facebook text,
  p_viber text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'AUTH');
  END IF;

  UPDATE public.profiles
    SET full_name = CASE
          WHEN nullif(btrim(coalesce(p_full_name, '')), '') IS NULL THEN full_name
          ELSE left(btrim(p_full_name), 50)
        END,
        plate = p_plate,
        vehicle = p_vehicle,
        facebook = p_facebook,
        viber = p_viber,
        updated_at = timezone('utc', now())
    WHERE id = auth.uid();

  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.update_my_profile(text, text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_my_profile(text, text, text, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.update_my_profile(text, text, text, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.set_profile_phone_v87(p_user_id uuid, p_phone text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'AUTH');
  END IF;

  UPDATE public.profiles
    SET phone = coalesce(p_phone, ''),
        updated_at = timezone('utc', now())
    WHERE id = p_user_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NOT_FOUND');
  END IF;
  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.set_profile_phone_v87(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_profile_phone_v87(uuid, text) FROM anon;
REVOKE ALL ON FUNCTION public.set_profile_phone_v87(uuid, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.set_profile_phone_v87(uuid, text) TO service_role;
