import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  generateSessionContactInvitationCode,
  readContactCodePepper,
} from "@/lib/matching/contactInvitationCode";
import {
  runContactInvitationCreate,
  type ContactInvitationInspectRow,
  type ContactInvitationWriterRow,
} from "@/lib/matching/contactInvitationCreate";
import type { ContactInvitationEligibilityPost } from "@/lib/matching/contactInvitationEligibilityCore";
import { scoreOfficialContactInvitationRoute } from "@/lib/matching/contactInvitationEligibility";

const ELIGIBILITY_POST_SELECT = [
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
  const result = await runContactInvitationCreate({
    readBody: () => request.json(),
    getUser: async () => {
      const supabase = await createClient();
      const { data, error } = await supabase.auth.getUser();
      if (error) {
        throw new Error("auth_lookup_failed");
      }
      return data.user?.id ?? null;
    },
    readPepper: () => readContactCodePepper(),
    generateCode: (actorUserId, clientRequestId) =>
      generateSessionContactInvitationCode(actorUserId, clientRequestId),
    createAdmin: () => createAdminClient(),
    inspect: async (admin, args) => {
      const client = admin as SupabaseClient;
      const { data, error } = await client.rpc(
        "inspect_match_contact_invitation_v95",
        {
          p_actor_user_id: args.actorUserId,
          p_initiator_post_id: args.initiatorPostId,
          p_client_request_id: args.clientRequestId,
        },
      );
      if (error) {
        throw new Error(error.message ?? "inspect_failed");
      }
      const row = Array.isArray(data) ? data[0] : data;
      return row as ContactInvitationInspectRow;
    },
    loadPosts: async (admin, ids) => {
      const client = admin as SupabaseClient;
      const { data, error } = await client
        .from("posts")
        .select(ELIGIBILITY_POST_SELECT)
        .in("id", [ids.initiatorPostId, ids.counterpartPostId]);
      if (error) {
        throw new Error("post_lookup_failed");
      }
      const rows = (data ?? []) as unknown as ContactInvitationEligibilityPost[];
      return {
        initiator: rows.find((row) => row.id === ids.initiatorPostId) ?? null,
        counterpart: rows.find((row) => row.id === ids.counterpartPostId) ?? null,
      };
    },
    scoreRoute: (initiator, counterpart) =>
      scoreOfficialContactInvitationRoute({ initiator, counterpart }),
    callWriter: async (admin, args) => {
      const client = admin as SupabaseClient;
      const { data, error } = await client.rpc(
        "create_match_contact_invitation_v95",
        {
          p_actor_user_id: args.actorUserId,
          p_initiator_post_id: args.initiatorPostId,
          p_counterpart_post_id: args.counterpartPostId,
          p_client_request_id: args.clientRequestId,
          p_contact_code_hash: args.contactCodeHash,
        },
      );
      if (error) {
        throw new Error(error.message ?? "writer_failed");
      }
      const row = Array.isArray(data) ? data[0] : data;
      return row as ContactInvitationWriterRow;
    },
  });

  for (const line of result.logs) {
    console.error(line);
  }
  return NextResponse.json(result.json, { status: result.status });
}
