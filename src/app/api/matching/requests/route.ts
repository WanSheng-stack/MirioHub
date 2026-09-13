import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  generateSessionContactInvitationCode,
  readContactCodePepper,
} from "@/lib/matching/contactInvitationCode";
import { runMatchRequestCreate } from "@/lib/matching/matchRequestCreate";
import { buildProductionServerQuote } from "@/lib/matching/matchRequestCreateCore";
import {
  loadMatchAdmissionThresholds,
  scoreOfficialMatchAdmissionRoute,
} from "@/lib/matching/matchAdmissionServer";
import type { MatchAdmissionPost } from "@/lib/matching/matchAdmissionPolicy";

const POST_SELECT = [
  "id",
  "user_id",
  "post_type",
  "category",
  "status",
  "departure_date",
  "departure_time_window",
  "service_time_window",
  "transport_mode",
  "escort_seats",
  "max_companions",
  "count_small",
  "count_medium",
  "count_large",
  "count_xlarge",
  "origin_address",
  "destination_address",
  "waypoints",
  "origin_gps",
  "destination_gps",
].join(", ");

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
    loadPosts: async (admin, ids) => {
      const client = admin as SupabaseClient;
      const { data, error } = await client
        .from("posts")
        .select(POST_SELECT)
        .in("id", [ids.initiatorPostId, ids.counterpartPostId]);
      if (error) throw new Error("post_lookup_failed");
      const rows = (data ?? []) as unknown as MatchAdmissionPost[];
      return {
        initiator: rows.find((row) => row.id === ids.initiatorPostId) ?? null,
        counterpart: rows.find((row) => row.id === ids.counterpartPostId) ?? null,
      };
    },
    loadActorPhonePresent: async (admin, actorUserId) => {
      const client = admin as SupabaseClient;
      const { data, error } = await client
        .from("profiles")
        .select("phone")
        .eq("id", actorUserId)
        .maybeSingle();
      if (error) throw new Error("profile_lookup_failed");
      const phone = typeof data?.phone === "string" ? data.phone.trim() : "";
      return phone.length > 0;
    },
    scoreRoute: (initiator, counterpart) =>
      scoreOfficialMatchAdmissionRoute({ left: initiator, right: counterpart }),
    loadThresholds: (admin) => loadMatchAdmissionThresholds(admin),
    loadQuote: async () => buildProductionServerQuote(),
    callWriter: async (admin, args) => {
      const client = admin as SupabaseClient;
      const { data, error } = await client.rpc("create_match_request_v95", {
        p_actor_user_id: args.actorUserId,
        p_initiator_post_id: args.initiatorPostId,
        p_counterpart_post_id: args.counterpartPostId,
        p_client_request_id: args.clientRequestId,
        p_client_revision_id: args.clientRevisionId,
        p_contact_code_hash: args.contactCodeHash,
        p_admission_digest: args.admissionDigest,
        p_proposal_digest: args.proposalDigest,
        p_quote_digest: args.quoteDigest,
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
