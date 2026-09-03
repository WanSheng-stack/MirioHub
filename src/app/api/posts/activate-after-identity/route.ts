/**
 * POST /api/posts/activate-after-identity
 *
 * Activates eligible draft posts owned by the current Account after a
 * verified identity event (Passkey / Google linking / email verification).
 *
 * Body (all optional):
 *   { postId?: string }
 *   - postId present → target only that draft post
 *   - postId absent  → target ALL draft posts owned by the current user
 *
 * Server-side activation policy (identical to complete-contact):
 *   canActivate = has_passkey OR google_identity OR email_confirmed_at
 *
 * Never trusts client-supplied identity claims (no identityVerified,
 * hasPasskey, googleLinked, etc. in request body).
 *
 * Idempotent: already-active posts are counted in the response but not
 * double-updated.
 *
 * Cross-user protection:
 *   - auth.getUser() (not getSession()) is used — forgeable JWTs rejected
 *   - .eq('user_id', user.id) enforces ownership server-side
 *   - RLS adds a second layer of enforcement
 *
 * Returns: { ok: true, activated: string[], alreadyActive: string[] }
 */

import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import type { User } from '@supabase/supabase-js';

// ---------------------------------------------------------------------------
// Supabase client (anon key — RLS enforces post ownership)
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
// Canonical server-side activation policy
// (same logic as complete-contact; co-located to avoid import cycles)
// ---------------------------------------------------------------------------

async function checkCanActivatePost(
  supabase: Awaited<ReturnType<typeof createClient>>,
  user: User,
): Promise<boolean> {
  // 1. Passkey registered for this Account
  const { data: profile } = await supabase
    .from('profiles')
    .select('has_passkey')
    .eq('id', user.id)
    .maybeSingle();
  if ((profile as { has_passkey?: boolean } | null)?.has_passkey) return true;

  // 2. Google OAuth identity linked to THIS exact UUID
  //    (preserved only when linkIdentity() was used — not signInWithOAuth)
  if (user.identities?.some((i) => i.provider === 'google')) return true;

  // 3. Email confirmed for THIS UUID
  if (user.email_confirmed_at) return true;

  return false;
}

// ---------------------------------------------------------------------------
// POST handler
// ---------------------------------------------------------------------------

export async function POST(request: Request) {
  const supabase = await createClient();

  // auth.getUser() — not getSession() — validates the JWT server-side
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

  // Parse optional postId (empty body is valid — activates all user drafts)
  let postId: string | null = null;
  try {
    const body = (await request.json()) as { postId?: unknown };
    if (typeof body.postId === 'string' && body.postId.trim()) {
      postId = body.postId.trim();
    }
  } catch {
    // Empty / malformed body → activate all drafts
  }

  // ── Activation policy check ───────────────────────────────────────────────
  const canActivate = await checkCanActivatePost(supabase, user);
  if (!canActivate) {
    // User does not yet hold a verified identity — return ok but nothing done
    return NextResponse.json({ ok: true, activated: [], alreadyActive: [] });
  }

  // ── Fetch target draft(s) ─────────────────────────────────────────────────
  // Only fetch posts the current auth.uid() owns (RLS + explicit eq clause)
  let selectQuery = supabase
    .from('posts')
    .select('id, status')
    .eq('user_id', user.id)
    .in('status', ['draft', 'active']); // fetch both so we can report already-active

  if (postId) {
    selectQuery = selectQuery.eq('id', postId);
  }

  const { data: posts, error: fetchErr } = await selectQuery;

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

  const typedPosts = (posts ?? []) as { id: string; status: string }[];

  const alreadyActive = typedPosts
    .filter((p) => p.status === 'active')
    .map((p) => p.id);

  const draftIds = typedPosts
    .filter((p) => p.status === 'draft')
    .map((p) => p.id);

  if (draftIds.length === 0) {
    // Nothing to activate — idempotent success
    return NextResponse.json({ ok: true, activated: [], alreadyActive });
  }

  // ── Activate draft(s) in-place ────────────────────────────────────────────
  const { error: updateErr } = await supabase
    .from('posts')
    .update({ status: 'active', updated_at: new Date().toISOString() })
    .in('id', draftIds)
    .eq('user_id', user.id) // ownership double-check (RLS provides third layer)
    .eq('status', 'draft');  // only flip actual drafts

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

  return NextResponse.json({
    ok: true,
    activated: draftIds,
    alreadyActive,
  });
}
