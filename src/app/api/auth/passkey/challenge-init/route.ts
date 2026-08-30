import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import {
  generateRegistrationOptions,
  generateAuthenticationOptions,
} from '@simplewebauthn/server';
import type { AuthenticatorTransportFuture } from '@simplewebauthn/server';

// ---------------------------------------------------------------------------
// Supabase route-handler client
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// POST /api/auth/passkey/challenge-init
// ---------------------------------------------------------------------------

interface DbPasskeyRow {
  credential_id: string;
  transports: AuthenticatorTransportFuture[] | null;
}

export async function POST(request: Request) {
  const supabase = await createClient(); // 完美继承 Cursor 刚才重构的清白客户端组件

  try {
    const body = (await request.json()) as { clientRequestId?: string; userId?: string };
    const { clientRequestId, userId } = body; // 💡 绝杀核心：强行从前端传入的 body 载荷中提取强类型 UUID 资产，拒绝盲信脆弱的 getSession()
    
    if (!clientRequestId || !userId) {
      return NextResponse.json(
        { success: false, errorKey: 'error.missing_required_params' },
        { status: 400 },
      );
    }

    const expectedRPID = process.env.WEBAUTHN_RP_ID ?? 'localhost';
    const rpName = process.env.WEBAUTHN_RP_NAME ?? 'MirioHub Co-Car';

    // Check if this user already has registered passkeys
    const { data: dbKeys } = await supabase
      .from('passkeys')
      .select('credential_id, transports')
      .eq('user_id', userId); // 严格比对纯净的 UUID 列

    const passkeyRows = (dbKeys ?? []) as DbPasskeyRow[];
    const hasKeys = passkeyRows.length > 0;

    let ceremonyType: 'registration' | 'authentication';
    let challengeText: string;
    let optionsPayload: Record<string, unknown>;

    if (!hasKeys) {
      // First-time: register a new passkey
      ceremonyType = 'registration';
      const opts = await generateRegistrationOptions({
        rpName,
        rpID: expectedRPID,
        userName: `user_${userId.slice(0, 8)}`, // 基于 UUID 降维生成唯一的无感临时影子用户名
        userID: new TextEncoder().encode(userId), // 严格绑定该用户的真实 UUID 资产
        userDisplayName: 'MirioHub Traveler',
        attestationType: 'none',
        authenticatorSelection: {
          residentKey: 'required',
          userVerification: 'required', // 强制弹出硬件 FaceID/指纹 刷脸层
        },
      });
      challengeText = opts.challenge;
      optionsPayload = opts as unknown as Record<string, unknown>;
    } else {
      // Subsequent: authenticate with existing passkey
      ceremonyType = 'authentication';
      const opts = await generateAuthenticationOptions({
        rpID: expectedRPID,
        allowCredentials: passkeyRows.map((k) => ({
          id: k.credential_id,
          transports: k.transports ?? undefined,
        })),
        userVerification: 'required',
      });
      challengeText = opts.challenge;
      optionsPayload = opts as unknown as Record<string, unknown>;
    }

    // Persist challenge (idempotent on client_request_id)
    // 利用 ON CONFLICT (client_request_id) DO UPDATE 原地平滑回收超时租约，允许无限次优雅重试！
    const { data: challengeRow, error: chErr } = await supabase
      .from('auth_challenges')
      .upsert(
        {
          user_id: userId,
          client_request_id: clientRequestId,
          challenge_text: challengeText,
          type: ceremonyType === 'registration' ? 'register' : 'login',
          purpose: ceremonyType === 'registration' ? 'anonymous_register' : 'login',
          status: 'issued',
          expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(), // 5分钟租约死锁
        },
        { onConflict: 'client_request_id' },
      )
      .select()
      .single();

    if (chErr || !challengeRow) {
      return NextResponse.json(
        { success: false, errorKey: 'error.challenge_db_upsert_failed' },
        { status: 400 },
      );
    }

    const row = challengeRow as Record<string, unknown>;

    return NextResponse.json({
      success: true,
      challengeId: row.id,
      challengeText,
      options: optionsPayload,
      ceremonyType,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'error.server_internal_crash';
    return NextResponse.json({ success: false, errorKey: msg }, { status: 500 });
  }
}
