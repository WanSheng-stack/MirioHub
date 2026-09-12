# Deferred cleanup ledger

This ledger records **parked** surfaces. Do not delete them in the current
phase. `public_posts_safe` is **not** a deletion candidate: it remains the
hall public-read privacy boundary. `supabase/init.sql` is not the live
schema authority; this repo currently must not modify it.

## 1. `src/components/credit/CreditDashboard.tsx`

- **Current state:** File kept. Unwired from hall `PostCard` / HomeConsole
  as of PHASE 6.6B.1. Completion-rate UI was untrusted (wrong denominator,
  N+1, not `matches.provider_user_id` fulfillment).
- **Future replacement:** Contract-based credit from
  `match_contracts` (status + frozen snapshots), not author-owned completed
  provider posts.
- **Earliest safe deletion:** After a replacement credit UI ships on
  `match_contracts` and hall/detail no longer import this component.
- **Preconditions:** New credit algorithm; hall/detail callers gone;
  snapshot schema frozen.
- **Risk if deleted early:** Loses a visual reference; any stray import
  would break the build.

## 2. `src/lib/credit-stats.ts`

- **Current state:** File kept. Hall no longer calls `computeCreditStats`.
- **Future replacement:** Stats derived from `match_contracts` rows for
  `provider_user_id` / `demand_user_id`, not `public_posts_safe` completed
  provider posts.
- **Earliest safe deletion:** Same as CreditDashboard.
- **Preconditions:** No remaining imports; new stats module exists.
- **Risk if deleted early:** Build break if a leftover import remains.

## 3. `src/lib/post-form/providerMatch.ts`

- **Current state:** No runtime caller. File is kept temporarily as a
  reference for the old Route/Capacity client path. Direct `confirm_match`
  is frozen; preflight API returns 409.
- **Future replacement:** PHASE 6.7D accept-time orchestration will
  decide whether to reuse pieces of this module or delete it.
- **Earliest safe deletion:** After 6.7D accept-time orchestration is in
  place and this file is confirmed unused.
- **Preconditions:** New request/accept UI; 409 freeze helper no longer
  needed; no `rpc("confirm_match")`.
- **Risk if deleted early:** Loss of a reference implementation for
  Route/Capacity client wiring.

## 4. `evaluateFraudIntercept.ts` legacy Provider Match path

- **Current state:** `evaluateProviderMatchFraud` kept from PHASE 6.6B.
  Disabled preflight route must not call it until a real request/accept
  exists.
- **Future replacement:** Fraud at accept time against
  `match_contracts.demand_snapshot` + current-window metrics (PHASE 6.7D).
- **Earliest safe deletion:** After accept-time fraud is live and this
  wrapper has no callers.
- **Preconditions:** Match-request accept API owns fraud; route no longer
  re-enabled as a bare preflight.
- **Risk if deleted early:** 6.7D has no existing intercept to reuse;
  current-window cargo rules could regress.

## 5. `runFraudIntercept.ts` legacy Provider Match path

- **Current state:** `runProviderMatchIntercept` + `isPureCargoDemand`
  kept. Pure cargo is a property of the **target Demand**, not the clicker.
- **Future replacement:** Same functions (or successors) invoked only
  when accepting a request whose snapshot is pure cargo.
- **Earliest safe deletion:** After accept-time orchestration no longer
  imports this path.
- **Preconditions:** Contract snapshots exist; work pool does not use
  `posts.status = 'matched'`.
- **Risk if deleted early:** Loses injectable current-window cargo
  intercept and 6.6B tests.

## 6. `public.confirm_match(uuid)`

- **Current state:** Function retained. EXECUTE revoked from PUBLIC /
  anon / authenticated / service_role (PHASE 6.6B.1 / 20260908000003).
- **Future replacement:** Server-only accept RPC that inserts
  `match_contracts` from a pending `match_requests` row.
- **Earliest safe deletion:** After the replacement accept path is in
  production and no session can EXECUTE this signature.
- **Preconditions:** New accept RPC; app has no `rpc("confirm_match")`;
  ACL still fail-closed; historical matches readable if needed.
- **Risk if deleted early:** Breaks any leftover admin/SQL that still
  calls the old signature; harder to compare old vs new match rows.

## 7. `public.matches`

- **Current state:** Legacy match rows and table remain. New lifecycle
  uses `match_requests` + `match_contracts`.
- **Future replacement:** `match_contracts` as fulfillment authority.
- **Earliest safe deletion:** After all live matches are represented as
  contracts (or archived) and no UI/RPC reads `public.matches`.
- **Preconditions:** Reveal/cancel/completion migrated; no FK from live
  app code; backfill or dual-read period complete.
- **Risk if deleted early:** Drops historical match rows; breaks
  `cancel_match_no_fault` / `reveal_contact` / participant UI.

## 8. Posts completion fields (`completion_type`, `completion_note`, `auto_melt_deadline`)

- **Current state:** Still on `posts` / `public_posts_safe` privacy
  boundary (safe view must keep excluding secrets). Auto Melt UI still
  exists for **existing** matches.
- **Future replacement:** Completion and melt policy on
  `match_contracts` (status timestamps + later dedicated columns), not
  post-level notes.
- **Earliest safe deletion:** After completion/Auto Melt run on
  contracts and the safe view no longer needs to hide these columns
  because they are gone or unused.
- **Preconditions:** New completion API; Auto Melt scheduler on
  contracts; `public_posts_safe` reviewed so it still does not leak
  remaining private columns.
- **Risk if deleted early:** Breaks AutoMeltDialog / completion RPC;
  may force an unsafe view rewrite.

---

`public_posts_safe` is **not** listed for deletion. It is the hall
safe-read boundary.

`supabase/init.sql` is **not** listed for deletion or rewrite this
phase. It is not live schema authority, and this project currently
must not modify it.

## 9. Cargo V2 domain contract (not on the production path)

- **Current state:** PHASE 6.7B.1B wires the parse-only Cargo V2 contract into
  `ApplicationPayloadV1` and the unmounted `MatchRequestSheet`. Demand
  applicants to a Provider deliver post send `cargoRequirement` (overall
  required L×W×H + two needs-help booleans). Provider applicants to a
  Demand deliver post send `cargoCapacity` (this-trip remaining L×W×H + two
  can-help booleans). Handling flags remain **advisory preferences only**.
  The sheet is not mounted on PostCard or the homepage. No match-request
  API writes `match_requests` / `match_contracts` / `agreement_snapshot`.
  Legacy `count_small/medium/large/xlarge` remain the production **publish**
  luggage model and travel-application counts.
- **Future replacement:** A later mount phase may show hall apply buttons.
  6.7C/6.7D must re-parse both snapshots server-side, then write final help
  + fee onto `agreement_snapshot` immediately before accept. This phase
  does not write that snapshot.
- **Earliest safe production use:** After hall/button mount, a real
  match-request API, and server-side re-parse on accept. Not this phase.
- **Preconditions:** Escort stays Demand 0/1 vs Provider accommodation;
  remaining-trip space is not nameplate volume; no vehicle-class
  recommendation; no handling amount/currency on the publish/apply payload;
  handling mismatch must stay advisory; photos stay in a later handover
  flow.
- **Risk if wired early:** Mounts apply buttons before the API exists,
  treats incomplete four-tier rows as a fit decision, treats handling
  mismatch as a block/filter/Fraud signal, or stores a handling price
  before the parties agreed.

## 10. `public.profile_cards` (dropped live; still in frozen `init.sql`)

- **Current state:** PHASE 6.6A.1 drops the live Security Definer view.
  Hall names use `get_public_profile_cards_v92(uuid[])` (id + `full_name`
  only). Match-hall admin reads `profiles` `id, full_name` directly.
  `supabase/init.sql` still defines the old six-column view; that file is
  not live schema authority and must not be edited this phase.
- **Future replacement:** None. Do not recreate a public profile view
  that projects plate / vehicle / facebook / viber.
- **Earliest safe deletion of the init.sql snapshot:** When `init.sql` is
  allowed to be rewritten to match live schema.
- **Preconditions:** Live verify shows `to_regclass('public.profile_cards')`
  is null; production TS callers of `profile_cards` remain zero.
- **Risk if recreated early:** Reopens Security Advisor
  `security_definer_view` and re-leaks contact fields to anon SELECT.

`public.public_posts_safe` remains the hall public-read privacy boundary.
PHASE 6.6A.1 does **not** set `security_invoker=true` on it.

After a successful v92 apply, Security Advisor is expected to still report
**two** items:

1. `public.public_posts_safe` — Security Definer View (later dedicated phase)
2. `public.spatial_ref_sys` — RLS Disabled in Public (owned by
   `supabase_admin`; SQL Editor `postgres` cannot ALTER it; escalated to
   Supabase Support; intentionally outside v92)

Do not claim that v92 leaves only one Advisor finding. Do not clear
Advisor count by breaking anonymous hall reads or by SET ROLE / ALTER
OWNER against PostGIS.

## 11. Google avatar hotlink

- **Current state:** Profile may still use the Google-provided photo URL
  directly. That hotlink can return 429 / ORB. The current fallback is
  initials, not a proxy.
- **Future replacement:** Controlled avatar storage or a tightly scoped
  same-origin proxy, after a separate security review.
- **Earliest safe production use:** After review. Do **not** build an
  unrestricted image proxy.
- **Preconditions:** Allowlist, size limits, and no open-relay fetch of
  arbitrary URLs.
- **Risk if built early:** SSRF and quota abuse via an open image proxy.

## 12. Dual-post matching foundation (v93 schema only)

- **Current state:** v93 is live on the catalog via SQL Editor. The four tables
  (`match_contact_invitations`, `contact_grants`, `match_requests`,
  `match_contracts`) exist, are empty, have RLS enabled, FORCE RLS off, no
  policies, and no app-role grants. Manual apply did **not** write
  `schema_migrations`; absence from migration history must not be treated as
  “v93 undeployed”. Do not re-run v93, forge history, or edit the executed
  v93 files. `MatchRequestSheet` remains unmounted. No writer.
- **Resolved in 6.7A.2A:** array CHECK bypasses (2-D / NULL / non-1 lower);
  one-way invitation timestamps; coarse v90 column existence guard; verify
  sequence name-scan and function name-regex false positives.
- **Still unresolved:** no invitation/request/accept API, no capacity writer,
  no fee, membership, fulfillment, or Fraud work.
- **Future replacement:** A later server API will re-read posts/profiles and
  write invitations, grants, and requests. Contract INSERT stays forbidden
  until a safe-accept transaction exists (6.7C.3).
- **Earliest safe production use:** After a dedicated writer phase ships.
- **Preconditions:** Keep the four tables empty until a production writer
  exists. Demand may have many pending requests; one contract per Demand post
  including terminal rows.
- **Risk if wired early:** Client code inserting contracts without capacity
  and accept-time revalidation, or treating invitations as orders.

## 13. Allocation and event foundation (v94 schema only)

- **Current state:** PHASE 6.7A.3B.1 — the v94 main migration is already
  deployed (six tables exist) and is frozen. Do not rewrite or re-run it.
  First live verify returned 267 PASS + 1 false FAIL on check 930
  (`volume_cm3 numeric-then-multiply`). PostgreSQL renders
  `(space_length_cm)::numeric`; the old verify searched
  `space_length_cm::numeric`. The deployed `contract_allocations_deliver_shape`
  CHECK is correct. This round repairs verify only. The original 6.7A.3 /
  6.7A.3A / 6.7A.3B work added six tables: `provider_trip_state`,
  `contract_allocations`, `contract_state_projections`, `contract_events`,
  `safety_checklist_acceptances`, and `safety_checklist_acceptance_items`.
  Guard fingerprints the **live v93 catalog** (columns, constraints,
  independent indexes, RLS, FORCE off, empty counts) and refuses
  pre-existing v94 tables. Constraint and independent-index expected defs
  are frozen production `pg_get_constraintdef` / `pg_get_indexdef` forms;
  compare is whitespace-only and does not strip parentheses or rewrite
  IN / ANY / ALL / BETWEEN. It does not read migration history. All six
  tables: RLS on, not FORCE, no policy, no GRANT, UUID defaults, no
  RPC/trigger/sequence. No production writer, API, or UI. Checklist item
  keys are a child table; `confirmed_items text[]` and 2016 pairwise array
  comparisons were removed in 6.7A.3A. `item_order` 1–64 UNIQUE per
  acceptance caps cardinality. **non-empty checklist items is a future
  transactional writer invariant** — DDL does not require a header to have
  a child row. Actor-is-contract-participant is also a future writer
  re-read, not a single-table CHECK. `contract_events.event_payload` CHECK
  blocks listed sensitive keys at the **top level only**; the future writer
  must recursively inspect the JSON tree. Browser has no write privilege;
  tables stay empty until that writer exists.
- **Still unresolved / later phases:** 6.7C.3 owns the atomic accept
  transaction (lock mother trip, sum interval allocations, insert contract +
  allocation + formed event + projection together, refuse new contracts after
  trip start). 6.8A owns notifications, credit aggregation, and related
  writers. 6.8B owns completion/consignee codes, verification tables, and the
  72-hour auto-complete job. Dispute handling is not a writer in this phase.
- **Future replacement:** Server writers only. Ordinary DTOs after
  `terminal_privacy_at` must stop returning counterpart phone, WhatsApp/Viber
  capability, full plate, precise address/GPS, delegate contacts, and
  identity-document fields; server-restricted snapshots remain.
- **Earliest safe production use:** After the repaired verify.sql is run
  read-only against the already-applied v94 catalog, and 6.7C.3 ships.
  This round does not re-apply v94.
- **Preconditions:** v93 four tables still empty at apply time; v94 tables
  must not already exist; do not claim single-table CHECKs prevent
  cross-contract interval oversell.
- **Risk if wired early:** Half-contracts, oversell, or browser DML against
  fail-closed tables.

## 14. Contact invitation creation boundary (v95)

- **Current state:** PHASE 6.7C.1A.1 keeps the undeployed v95 writer as the
  only success authority. `inspect_match_contact_invitation_v95` is a
  non-atomic cost hint and never authorizes HTTP 200 or fabricates a writer
  row. Exact idempotent retries still resolve
  `(initiator_user_id, client_request_id)` first, then compare the recovered
  `contact_code_hash` inside the writer. Hall, contact invitation, and
  evaluate-route-match share `src/lib/matching/matchAdmissionPolicy.ts`.
  Route admission is not `calculateRouteMatchScore.ok`; it also applies
  `matching_route_max_extra_detour_km` (default 30) and
  `matching_route_max_extra_detour_ratio` (default 0.5). Active posts can
  still refresh GPS / fill null `transport_mode` via complete-contact, so
  new creates bind a server admission digest after the writer locks posts.
  Limits stay writer-atomic. This phase does not write `contact_grants`,
  match requests, contracts, allocations, or Fraud tables, and does not
  mount UI.
- **Still unresolved / later phases:** invitation list, notifications,
  contact-grant writer, MatchRequestSheet mount, formal match request,
  accept/reject, and 6.7C.3 contract+allocation transaction.
- **Future replacement:** A later grant writer must re-check recipient
  settings and confirmed channels before any contact DTO.
- **Earliest safe production use:** After v95 is applied, verify.sql is run
  read-only, and a dedicated UI phase mounts the API. Not this phase.
- **Preconditions:** matching foundation tables still empty at apply;
  `MATCH_CONTACT_CODE_PEPPER` is server-only and at least 32 characters.
- **Risk if wired early:** Treating an invitation as an order, or returning
  phone numbers from `disclosure_mode` alone.
