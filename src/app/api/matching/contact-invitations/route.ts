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
  type ContactInvitationWriterRow,
} from "@/lib/matching/contactInvitationCreate";

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
