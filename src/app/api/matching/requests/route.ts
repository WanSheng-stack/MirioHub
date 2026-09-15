import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  generateSessionContactInvitationCode,
  readContactCodePepper,
} from "@/lib/matching/contactInvitationCode";
import { runMatchRequestCreate } from "@/lib/matching/matchRequestCreate";
import {
  buildProductionServerQuote,
  isCanonicalStoredPhone,
} from "@/lib/matching/matchRequestCreateCore";
import {
  loadMatchAdmissionThresholds,
  scoreOfficialMatchAdmissionRoute,
} from "@/lib/matching/matchAdmissionServer";
import type { MatchAdmissionPost } from "@/lib/matching/matchAdmissionPolicy";

type SnapshotRow = {
  admission_facts_hash: string;
  left_id: string;
  left_user_id: string;
  left_post_type: string;
  left_category: string;
  left_status: string;
  left_departure_date: string | null;
  left_departure_time_window: string | null;
  left_service_time_window: string | null;
  left_transport_mode: string | null;
  left_escort_seats: number | null;
  left_max_companions: number | null;
  left_count_small: number | null;
  left_count_medium: number | null;
  left_count_large: number | null;
  left_count_xlarge: number | null;
  left_origin_address: string | null;
  left_destination_address: string | null;
  left_waypoints: string[] | null;
  left_origin_gps_ewkb: string | null;
  left_destination_gps_ewkb: string | null;
  left_origin_lat: number | null;
  left_origin_lng: number | null;
  left_destination_lat: number | null;
  left_destination_lng: number | null;
  left_service_subtype: string | null;
  left_origin_country_code: string | null;
  left_origin_timezone: string | null;
  left_night_policy_version: number | null;
  right_id: string;
  right_user_id: string;
  right_post_type: string;
  right_category: string;
  right_status: string;
  right_departure_date: string | null;
  right_departure_time_window: string | null;
  right_service_time_window: string | null;
  right_transport_mode: string | null;
  right_escort_seats: number | null;
  right_max_companions: number | null;
  right_count_small: number | null;
  right_count_medium: number | null;
  right_count_large: number | null;
  right_count_xlarge: number | null;
  right_origin_address: string | null;
  right_destination_address: string | null;
  right_waypoints: string[] | null;
  right_origin_gps_ewkb: string | null;
  right_destination_gps_ewkb: string | null;
  right_origin_lat: number | null;
  right_origin_lng: number | null;
  right_destination_lat: number | null;
  right_destination_lng: number | null;
  right_service_subtype: string | null;
  right_origin_country_code: string | null;
  right_origin_timezone: string | null;
  right_night_policy_version: number | null;
};

function postFromSnapshot(
  side: "left" | "right",
  row: SnapshotRow,
): MatchAdmissionPost {
  const p = (name: string) => row[`${side}_${name}` as keyof SnapshotRow];
  const lat = p("origin_lat") as number | null;
  const lng = p("origin_lng") as number | null;
  const dlat = p("destination_lat") as number | null;
  const dlng = p("destination_lng") as number | null;
  return {
    id: String(p("id")),
    user_id: String(p("user_id")),
    post_type: String(p("post_type")),
    category: String(p("category")),
    status: String(p("status")),
    departure_date: (p("departure_date") as string | null) ?? null,
    departure_time_window: (p("departure_time_window") as string | null) ?? null,
    service_time_window: (p("service_time_window") as string | null) ?? null,
    transport_mode: (p("transport_mode") as string | null) ?? null,
    escort_seats: (p("escort_seats") as number | null) ?? null,
    max_companions: (p("max_companions") as number | null) ?? null,
    count_small: (p("count_small") as number | null) ?? null,
    count_medium: (p("count_medium") as number | null) ?? null,
    count_large: (p("count_large") as number | null) ?? null,
    count_xlarge: (p("count_xlarge") as number | null) ?? null,
    origin_address: (p("origin_address") as string | null) ?? null,
    destination_address: (p("destination_address") as string | null) ?? null,
    waypoints: (p("waypoints") as string[] | null) ?? null,
    origin_gps_ewkb: (p("origin_gps_ewkb") as string | null) ?? null,
    destination_gps_ewkb: (p("destination_gps_ewkb") as string | null) ?? null,
    service_subtype: (p("service_subtype") as string | null) ?? null,
    origin_country_code: (p("origin_country_code") as string | null) ?? null,
    origin_timezone: (p("origin_timezone") as string | null) ?? null,
    night_policy_version: (p("night_policy_version") as number | null) ?? null,
    origin_gps:
      lat != null && lng != null ? { lat, lng } : null,
    destination_gps:
      dlat != null && dlng != null ? { lat: dlat, lng: dlng } : null,
  };
}

export async function POST(request: Request) {
  const result = await runMatchRequestCreate({
    readBody: () => request.json(),
    getUser: async () => {
      const supabase = await createClient();
      const { data, error } = await supabase.auth.getUser();
      if (error) throw new Error("auth_lookup_failed");
      return data.user?.id ?? null;
    },
    readPepper: () => readContactCodePepper(),
    generateCode: (input) => generateSessionContactInvitationCode(input),
    createAdmin: () => createAdminClient(),
    inspect: async (admin, args) => {
      const client = admin as SupabaseClient;
      const { data, error } = await client.rpc("inspect_match_request_v95", {
        p_actor_user_id: args.actorUserId,
        p_initiator_post_id: args.initiatorPostId,
        p_client_request_id: args.clientRequestId,
      });
      if (error) throw new Error(error.message ?? "inspect_failed");
      const row = Array.isArray(data) ? data[0] : data;
      return row;
    },
    loadSnapshot: async (admin, ids) => {
      const client = admin as SupabaseClient;
      const { data, error } = await client.rpc(
        "read_match_request_candidate_snapshot_v99",
        {
          p_left_post_id: ids.initiatorPostId,
          p_right_post_id: ids.counterpartPostId,
        },
      );
      if (error) throw new Error(error.message ?? "snapshot_failed");
      const row = (Array.isArray(data) ? data[0] : data) as SnapshotRow | undefined;
      if (!row) {
        return { initiator: null, counterpart: null, admissionFactsHash: "" };
      }
      return {
        initiator: postFromSnapshot("left", row),
        counterpart: postFromSnapshot("right", row),
        admissionFactsHash: row.admission_facts_hash,
      };
    },
    loadActorPhoneCanonical: async (admin, actorUserId) => {
      const client = admin as SupabaseClient;
      const { data, error } = await client
        .from("profiles")
        .select("phone")
        .eq("id", actorUserId)
        .maybeSingle();
      if (error) throw new Error("profile_lookup_failed");
      return isCanonicalStoredPhone(
        typeof data?.phone === "string" ? data.phone : null,
      );
    },
    scoreRoute: (initiator, counterpart) =>
      scoreOfficialMatchAdmissionRoute({ left: initiator, right: counterpart }),
    loadThresholds: (admin) => loadMatchAdmissionThresholds(admin),
    loadQuote: async () => buildProductionServerQuote(),
    callWriter: async (admin, args) => {
      const client = admin as SupabaseClient;
      const { data, error } = await client.rpc("create_match_request_v99", {
        p_actor_user_id: args.actorUserId,
        p_initiator_post_id: args.initiatorPostId,
        p_counterpart_post_id: args.counterpartPostId,
        p_client_request_id: args.clientRequestId,
        p_client_revision_id: args.clientRevisionId,
        p_contact_code_hash: args.contactCodeHash,
        p_idempotency_payload_hash: args.idempotencyPayloadHash,
        p_admission_facts_hash: args.admissionFactsHash,
        p_proposal_payload: args.proposalPayload,
        p_pricing_version: args.quote.pricingVersion,
        p_pricing_country_code: args.quote.pricingCountryCode,
        p_pricing_currency: args.quote.pricingCurrency,
        p_base_amount_minor: args.quote.baseAmountMinor,
        p_bump_tier_id: args.quote.bumpTierId,
        p_bump_amount_minor: args.quote.bumpAmountMinor,
        p_total_amount_minor: args.quote.totalAmountMinor,
        p_match_percent_basis_points: args.quote.matchPercentBasisPoints,
        p_extra_detour_m: args.quote.extraDetourM,
        p_extra_duration_seconds: args.quote.extraDurationSeconds,
        p_contact_preference: args.contactPreference,
        p_whatsapp_available: args.whatsappAvailable,
        p_viber_available: args.viberAvailable,
      });
      if (error) throw new Error(error.message ?? "writer_failed");
      const row = Array.isArray(data) ? data[0] : data;
      return row;
    },
  });

  for (const line of result.logs) {
    console.error(line);
  }
  return NextResponse.json(result.json, { status: result.status });
}
