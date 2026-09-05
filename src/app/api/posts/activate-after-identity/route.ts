/**
 * POST /api/posts/activate-after-identity
 *
 * Activates ONE specific draft post owned by the current Account, after the
 * Account has acquired a verified identity (Passkey / Google linking /
 * email confirmation).
 *
 * Body (required):
 *   { postId: string }
 *   - postId absent or blank → 400 error.target_post_required
 *
 * TARGETED activation only — NEVER batch-activates all user drafts.
 * The caller must supply an explicit postId because identity verification
 * grants "publish eligibility", not "publish everything ever drafted".
 *
 * Idempotency:
 *   CASE A: post is draft + account verified  → UPDATE active → { isActive: true }
 *   CASE B: post is already active            → no mutation   → { isActive: true, alreadyActive: true }
 *   CASE C: post not owned by current user    → 404
 *   CASE D: post is draft but account lacks verified identity
 *           → 403 error.identity_verification_required
 *   CASE E: postId absent/blank              → 400 error.target_post_required
 *
 * Security:
 *   - auth.getUser() (not getSession()) — server-validates JWT
 *   - .eq('user_id', user.id) enforces ownership
 *   - RLS provides a third layer of enforcement
 *   - No client-supplied identity flags accepted
 */

import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { getAccountActivationEligibility } from '@/lib/auth/accountActivationEligibility';
import { evaluateStage1ActivePublicationRisk } from '@/lib/auth/stage1ActiveRisk';

// ---------------------------------------------------------------------------
// Supabase client (anon key — RLS enforces ownership)
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
          // Route handler — ignore cookie-write errors
        }
      },
    },
  });
}

// ---------------------------------------------------------------------------
// POST handler
// ---------------------------------------------------------------------------

export async function POST(request: Request) {
  const supabase = await createClient();

  // auth.getUser() validates the JWT server-side — cannot be forged by client
  const {
    data: { user },
    error: authErr,
  } = await supabase.auth.getUser();

  if (authErr || !user?.id) {
    return NextResponse.json(
      { ok: false, errorKey: 'error.authentication_required' },
      { status: 401 },
    );
  }

  // ── Require explicit postId — NO batch-activation fallback ────────────────
  let postId: string | null = null;
  try {
    const body = (await request.json()) as { postId?: unknown };
    if (typeof body.postId === 'string' && body.postId.trim()) {
      postId = body.postId.trim();
    }
  } catch {
    // Malformed JSON body — postId stays null → 400 below
  }

  if (!postId) {
    // Missing target = cannot know which post the user intends to publish.
    // Returning 400 prevents any unintended batch activation.
    return NextResponse.json(
      { ok: false, errorKey: 'error.target_post_required' },
      { status: 400 },
    );
  }

  // ── Fetch targeted post with ownership check ──────────────────────────────
  const { data: post, error: fetchErr } = await supabase
    .from('posts')
    .select('id, user_id, status, post_type, departure_date, departure_time_window')
    .eq('id', postId)
    .eq('user_id', user.id) // server-enforces ownership — RLS is third layer
    .maybeSingle();

  if (fetchErr) {
    console.error('[activate-after-identity] fetch error:', {
      message: fetchErr.message,
      code: fetchErr.code,
    });
    return NextResponse.json(
      { ok: false, errorKey: 'error.submit_failed' },
      { status: 500 },
    );
  }

  // CASE C / E: post not found or not owned by this user
  if (!post) {
    return NextResponse.json(
      { ok: false, errorKey: 'error.not_found' },
      { status: 404 },
    );
  }

  const typedPost = post as {
    id: string;
    user_id: string;
    status: string;
    post_type: string;
    departure_date: string | null;
    departure_time_window: string | null;
  };

  // CASE B: already active → idempotent success (no mutation)
  if (typedPost.status === 'active') {
    return NextResponse.json({
      ok: true,
      postId,
      isActive: true,
      alreadyActive: true,
    });
  }

  // Non-draft, non-active status (e.g. matched, completed) — not eligible
  if (typedPost.status !== 'draft') {
    return NextResponse.json(
      { ok: false, errorKey: 'error.invalid_post_status' },
      { status: 400 },
    );
  }

  // ── Activation policy — all claims come from server-trusted sources ───────
  const { eligible } = await getAccountActivationEligibility(supabase, user);

  // CASE D: post is draft but account lacks verified identity
  if (!eligible) {
    return NextResponse.json(
      { ok: false, errorKey: 'error.identity_verification_required' },
      { status: 403 },
    );
  }

  const risk = await evaluateStage1ActivePublicationRisk(supabase, user.id, typedPost);
  if (!risk.allowed) {
    return NextResponse.json(
      { ok: false, errorKey: risk.errorKey },
      { status: 400 },
    );
  }

  // ── CASE A: Activate the targeted draft in-place (status only) ────────────
  const { error: updateErr } = await supabase
    .from('posts')
    .update({ status: 'active', updated_at: new Date().toISOString() })
    .eq('id', postId)
    .eq('user_id', user.id) // ownership double-check
    .eq('status', 'draft');  // guard: only flip actual drafts

  if (updateErr) {
    console.error('[activate-after-identity] update error:', {
      message: updateErr.message,
      code: updateErr.code,
    });
    return NextResponse.json(
      { ok: false, errorKey: 'error.submit_failed' },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, postId, isActive: true });
}
