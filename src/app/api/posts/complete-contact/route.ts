/**
 * POST /api/posts/complete-contact
 *
 * Stage-2 contact completion via complete_post_contact_v102 (service_role).
 * Does NOT mutate origin authority / payload_hash / locale.
 * Destination geocode is destination-only; scope computed in SQL from stored origin.
 */

import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getAccountActivationEligibility } from "@/lib/auth/accountActivationEligibility";
import { evaluateStage1ActivePublicationRisk } from "@/lib/auth/stage1ActiveRisk";
import { normalizeLicensePlate } from "@/lib/post-validation";
import { parseUserPhone, resolvePhoneCountry } from "@/lib/phone/phoneNumber";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  clientJsonForPhoneWriteFailure,
  formatSafePhoneWriteLog,
  runPhoneWriterSafely,
  type AccountPhoneWriteResult,
} from "@/lib/profile/accountPhoneWrite";
import { writeAccountPhone } from "@/lib/profile/writeAccountPhone";
import {
  upsertPhoneHistory,
  upsertPlateHistory,
} from "@/lib/post-form/submitPost";
import {
  classifyAuthorityStateForContact,
  decideCompleteContactTransportV102,
} from "@/lib/posts/completeContactTransportV102";
import { parseV102PostsWriteRpcResult } from "@/lib/posts/parseV102PostsWriteRpcResult";
import { evaluateCompleteContactDemandPhoneIntercept } from "@/lib/security/evaluateFraudIntercept";
import { geocodeAddress, toGeographyPointWkt } from "@/lib/route-kms";

async function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const cookieStore = await cookies();
  return createServerClient(url, key, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (toSet) => {
        try {
          toSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options),
          );
        } catch {
          // Route handler — ignore cookie write errors
        }
      },
    },
  });
}

async function persistAccountCurrentPhone(
  userId: string,
  normalizedPhone: string,
): Promise<AccountPhoneWriteResult> {
  return runPhoneWriterSafely(
    () => writeAccountPhone(createAdminClient(), userId, normalizedPhone),
    () => {
      console.error("[complete-contact] phone writer threw");
    },
  );
}

interface ExistingPost {
  id: string;
  user_id: string;
  status: string;
  post_type: string;
  category: string;
  service_subtype: string | null;
  departure_date: string | null;
  departure_time_window: string | null;
  destination_address: string;
  origin_gps: unknown | null;
  origin_country_code: string | null;
  origin_timezone: string | null;
  night_policy_version: number | null;
  transport_mode: string | null;
}

interface RequestBody {
  postId: string;
  phone_country?: string;
  dial_code?: string;
  raw_phone_local?: string;
  provider_name?: string;
  raw_license_plate?: string;
  vehicle_brand?: string;
  vehicle_color?: string;
  transport_mode?: string;
}

export async function POST(request: Request) {
  const supabase = await createClient();

  const {
    data: { user },
    error: authErr,
  } = await supabase.auth.getUser();

  if (authErr || !user?.id) {
    return NextResponse.json(
      { ok: false, errorKey: "error.authentication_required" },
      { status: 401 },
    );
  }

  let body: RequestBody;
  try {
    body = (await request.json()) as RequestBody;
  } catch {
    return NextResponse.json(
      { ok: false, errorKey: "error.invalid_request_body" },
      { status: 400 },
    );
  }

  const {
    postId,
    phone_country,
    dial_code,
    raw_phone_local,
    provider_name,
    raw_license_plate,
    vehicle_brand,
    vehicle_color,
    transport_mode,
  } = body;

  if (!postId) {
    return NextResponse.json(
      { ok: false, errorKey: "error.invalid_post_id" },
      { status: 400 },
    );
  }

  const { data: rawPost, error: postErr } = await supabase
    .from("posts")
    .select(
      "id, user_id, status, post_type, category, service_subtype, departure_date, departure_time_window, destination_address, origin_gps, origin_country_code, origin_timezone, night_policy_version, transport_mode",
    )
    .eq("id", postId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (postErr || !rawPost) {
    return NextResponse.json(
      { ok: false, errorKey: "error.not_found" },
      { status: 404 },
    );
  }

  const post = rawPost as ExistingPost;
  const authorityState = classifyAuthorityStateForContact(post);

  const transportDecision = decideCompleteContactTransportV102({
    isOwner: post.user_id === user.id,
    category: post.category,
    serviceSubtype: post.service_subtype,
    authorityState,
    existingMode: post.transport_mode,
    requested: transport_mode,
  });
  if (transportDecision.kind === "reject") {
    return NextResponse.json(
      { ok: false, errorKey: transportDecision.errorKey },
      { status: 400 },
    );
  }

  if (!["draft", "active"].includes(post.status)) {
    return NextResponse.json(
      { ok: false, errorKey: "error.invalid_post_status" },
      { status: 400 },
    );
  }

  const hasPhone = Boolean(raw_phone_local?.trim());
  let phoneId: number | null = null;
  let rawPhoneForPost: string | null = null;
  let normalizedPhoneForPost: string | null = null;

  if (hasPhone) {
    const country = resolvePhoneCountry({
      phoneCountry: phone_country,
      dialCode: dial_code,
    });
    const phoneResult = country
      ? parseUserPhone({ countryCode: country, nationalInput: raw_phone_local! })
      : { valid: false as const, errorKey: "error.invalid_phone" as const };
    if (!phoneResult.valid) {
      return NextResponse.json(
        { ok: false, errorKey: phoneResult.errorKey },
        { status: 400 },
      );
    }
    normalizedPhoneForPost = phoneResult.normalizedDigits;
    rawPhoneForPost = phoneResult.nationalDisplay;

    if (post.post_type === "demand") {
      const phoneIntercept =
        await evaluateCompleteContactDemandPhoneIntercept({
          userId: user.id,
          normalizedPhone: phoneResult.normalizedDigits,
          departureDate: post.departure_date ?? "",
          departureWindow: post.departure_time_window ?? "",
        });
      if (!phoneIntercept.allowed) {
        return NextResponse.json(
          { ok: false, errorKey: phoneIntercept.errorKey },
          { status: 400 },
        );
      }
    }

    phoneId = await upsertPhoneHistory(
      supabase,
      user.id,
      phoneResult.normalizedDigits,
    );
  }

  const modeForPlate =
    post.transport_mode ||
    (transportDecision.kind === "fill" ? transportDecision.mode : "") ||
    (typeof transport_mode === "string" ? transport_mode : "");
  const plateRequiringModes = [
    "car",
    "motorbike",
    "cargo_van",
    "light_truck",
    "box_truck",
    "vehicle_with_trailer",
    "other_cargo_vehicle",
  ];
  const needsPlate =
    post.post_type === "provider" && plateRequiringModes.includes(modeForPlate);
  let normalizedPlate: string | null = null;
  let rawPlate: string | null = null;
  let plateId: number | null = null;

  if (post.post_type === "provider" && raw_license_plate?.trim()) {
    const plateResult = normalizeLicensePlate(raw_license_plate);
    if (!plateResult.ok) {
      return NextResponse.json(
        { ok: false, errorKey: plateResult.errorKey },
        { status: 400 },
      );
    }
    normalizedPlate = plateResult.normalized;
    rawPlate = raw_license_plate.trim();
    plateId = await upsertPlateHistory(supabase, user.id, normalizedPlate);
  }

  if (needsPlate && !normalizedPlate) {
    return NextResponse.json(
      { ok: false, errorKey: "error.invalid_plate" },
      { status: 400 },
    );
  }

  // Destination-only geocode. Never geocode/overwrite origin.
  let destinationUpdateKind: "omit" | "point" | "use_origin" = "omit";
  let destinationGpsWkt: string | null = null;
  const destAddress = (post.destination_address ?? "").trim();
  if (destAddress === "") {
    destinationUpdateKind = "use_origin";
  } else {
    try {
      const destGeo = await geocodeAddress(destAddress);
      if (destGeo) {
        destinationUpdateKind = "point";
        destinationGpsWkt = toGeographyPointWkt(destGeo.lat, destGeo.lon);
      }
    } catch {
      // keep omit — SQL preserves stored destination_gps/scope
    }
  }

  let wantActivate = false;
  let riskErrorKey: string | null = null;

  if (post.status === "draft") {
    const { eligible } = await getAccountActivationEligibility(supabase, user);
    if (eligible) {
      const risk = await evaluateStage1ActivePublicationRisk(
        supabase,
        user.id,
        post,
      );
      if (!risk.allowed) {
        riskErrorKey = risk.errorKey;
        wantActivate = false;
      } else {
        wantActivate = true;
      }
    }
  }

  const hasProviderName = provider_name !== undefined;
  const hasVehicleBrand = vehicle_brand !== undefined;
  const hasVehicleColor = vehicle_color !== undefined;

  const admin = createAdminClient();
  const { data: txData, error: txErr } = await admin.rpc(
    "complete_post_contact_v102",
    {
      p_user_id: user.id,
      p_post_id: postId,
      p_has_phone: hasPhone,
      p_raw_phone: hasPhone ? rawPhoneForPost : null,
      p_normalized_phone: hasPhone ? normalizedPhoneForPost : null,
      p_phone_id: hasPhone ? phoneId : null,
      p_has_plate: normalizedPlate !== null,
      p_raw_license_plate: normalizedPlate !== null ? rawPlate : null,
      p_normalized_license_plate: normalizedPlate,
      p_plate_id: normalizedPlate !== null ? plateId : null,
      p_has_provider_name: hasProviderName,
      p_provider_name: hasProviderName
        ? provider_name!.trim() || null
        : null,
      p_has_vehicle_brand: hasVehicleBrand,
      p_vehicle_brand: hasVehicleBrand
        ? vehicle_brand!.trim() || null
        : null,
      p_has_vehicle_color: hasVehicleColor,
      p_vehicle_color: hasVehicleColor
        ? vehicle_color!.trim() || null
        : null,
      p_has_transport_mode: transportDecision.kind === "fill",
      p_transport_mode:
        transportDecision.kind === "fill" ? transportDecision.mode : null,
      p_destination_update_kind: destinationUpdateKind,
      p_destination_gps: destinationGpsWkt,
      p_activate: wantActivate,
    },
  );

  if (txErr) {
    console.error("[complete-contact] v102 RPC error:", {
      code: txErr.code,
      category: "v102_rpc_failed",
    });
    return NextResponse.json(
      { ok: false, errorKey: "error.submit_failed" },
      { status: 500 },
    );
  }

  const parsed = parseV102PostsWriteRpcResult(txData, "error.submit_failed");
  if (!parsed.ok) {
    return NextResponse.json(
      { ok: false, errorKey: parsed.errorKey },
      { status: 400 },
    );
  }

  if (riskErrorKey) {
    if (hasPhone && normalizedPhoneForPost) {
      const profileWrite = await persistAccountCurrentPhone(
        user.id,
        normalizedPhoneForPost,
      );
      if (!profileWrite.ok) {
        console.error(
          "[complete-contact] set_profile_phone_v87 failed",
          formatSafePhoneWriteLog(profileWrite),
        );
        return NextResponse.json(clientJsonForPhoneWriteFailure(), {
          status: 500,
        });
      }
    }
    return NextResponse.json(
      { ok: false, errorKey: riskErrorKey },
      { status: 400 },
    );
  }

  if (hasPhone && normalizedPhoneForPost) {
    const profileWrite = await persistAccountCurrentPhone(
      user.id,
      normalizedPhoneForPost,
    );
    if (!profileWrite.ok) {
      console.error(
        "[complete-contact] set_profile_phone_v87 failed",
        formatSafePhoneWriteLog(profileWrite),
      );
      return NextResponse.json(clientJsonForPhoneWriteFailure(), {
        status: 500,
      });
    }
    return NextResponse.json({
      ok: true,
      postId: parsed.postId,
      isActive: parsed.isActive,
      normalizedPhone: normalizedPhoneForPost,
    });
  }

  return NextResponse.json({
    ok: true,
    postId: parsed.postId,
    isActive: parsed.isActive,
  });
}
