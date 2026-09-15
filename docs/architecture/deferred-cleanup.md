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
  required LÃÂÃÂWÃÂÃÂH + two needs-help booleans). Provider applicants to a
  Demand deliver post send `cargoCapacity` (this-trip remaining LÃÂÃÂWÃÂÃÂH + two
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

1. `public.public_posts_safe` ÃÂ¢ÃÂ?Security Definer View (later dedicated phase)
2. `public.spatial_ref_sys` ÃÂ¢ÃÂ?RLS Disabled in Public (owned by
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
  ÃÂ¢ÃÂÃÂv93 undeployedÃÂ¢ÃÂ? Do not re-run v93, forge history, or edit the executed
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

- **Current state:** PHASE 6.7A.3B.1 ÃÂ¢ÃÂ?the v94 main migration is already
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
  comparisons were removed in 6.7A.3A. `item_order` 1ÃÂ¢ÃÂ?4 UNIQUE per
  acceptance caps cardinality. **non-empty checklist items is a future
  transactional writer invariant** ÃÂ¢ÃÂ?DDL does not require a header to have
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

## 14. Atomic match-request creation boundary (v95)

- **Current state:** PHASE 6.7C.1B.3A bound the v95 guard to encoding-v2
  fingerprints; v95 has now been applied by the user and official verify
  is 69/69 PASS. PHASE 6.7C.2A / 6.7C.2A.1 v96 is applied (verify 78/78):
  `posts.service_subtype`, `origin_country_code`, `origin_timezone`,
  `night_policy_version`, and `night_service_policies` with an RS country
  default (`Europe/Belgrade`, 22:00ÃÂ¢ÃÂ?6:00, enabled=false). Historical
  travel/deliver NULL subtype is legacy_unknown and must fail closed for
  new matching. Travel/Deliver also fail closed when `transportMode` is
  NULL, empty, or unknown, even if night policy is disabled. Unique
  indexes prevent same-scope/version duplicates and multiple open-ended
  rows; they do not fully prevent overlapping bounded intervals of
  different versions. Future reader order is locked: enabled, in-force
  window, exact region before country default, then
  `policy_version DESC`, `effective_from DESC`, `id ASC`, take one.
  Future writers must close the old interval before inserting a new
  version. The next admission-hash writer/snapshot (v99 or later; PostGIS
  already used v97 and publish subtype used v98) must add those four
  fields to server admission facts; do not patch the deployed v95 hash
  helper. Creation stays false. MatchRequestSheet stays unmounted. Night
  policy stays disabled.
  v96 verify names `public.night_service_policies` directly: a missing
  table errors at parse/plan time and fail-closes; a present table with
  drifted inner objects returns FAIL/NULL. Neither path can overall PASS.
  v96 verify VALUES aliases must not use reserved identifiers such as
  `notnull` (PostgreSQL 42601). Catalog `"char"` values such as
  `relkind` must be `::text` before they enter the verify UNION.
  CHECK 112/226 compare the frozen pg_get_constraintdef text, folding
  whitespace only.
  The candidate snapshot is a single SQL statement: one MATERIALIZED
  `posts` read feeds both returned fields and `admission_facts_hash`.
  Shared helpers build jsonb facts and hash them without rereading
  `posts`. The writer rebuilds that same jsonb after `FOR UPDATE`.
  Exact retry still skips snapshot/OSRM/quote. The pre-apply inventory
  now covers columns/defaults/identity, constraint deferrability,
  indexes, RLS policies, table ACL, non-internal triggers, owned
  sequences, the empty v93/v94 function set, and pgcrypto/PostGIS
  prerequisites. PUBLIC table ACL is direct-only via
  `aclexplode`/`grantee = 0`; named roles use real OIDs or
  `role_missing`. Policy `polroles` OID 0 is `PUBLIC`; unknown OIDs
  are `missing_oid:<oid>`. Inventory UNION branches share one 38-column
  result schema. Owned-sequence `object_identity` casts
  `pg_depend.deptype` to text before `||`. No live PostgreSQL/MVCC run
  was performed. Creation stays false. MatchRequestSheet stays unmounted.
- **Still unresolved / later phases:** create_match_request_v99 + API cutover
  owned by 6.7C.2C.2/v99B (unapplied until user applies). Request list, resend,
  accept/reject, contact DTO, MatchRequestSheet mount, country pricing,
  trusted location resolver, and contract capacity/fulfillment remain later.
- **Future replacement:** A later grant writer must re-check recipient
  settings and confirmed channels before any contact DTO.
- **Earliest safe production use:** After v95 is applied, verify.sql is run
  read-only, and a dedicated UI phase mounts the API. Not this phase.
- **Preconditions:** matching foundation tables still empty at apply;
  `MATCH_CONTACT_CODE_PEPPER` is server-only and at least 32 characters.
- **Risk if wired early:** Treating an invitation as an order, or returning
  phone numbers from `disclosure_mode` alone.

## 15. PostGIS extensions rebind (v97)

- **Current state:** PostGIS relocation is complete. Supabase Support moved
  PostGIS from `public` to `extensions`. User applied v97; repaired verify
  is officially **15/15 PASS** (`overall_pass=PASS`). Support ticket may
  close. v97 migration and verify are applied history and must not be
  edited or re-run. PREP.1A fixed false fails on 302/303 by comparing
  `oidvectortypes(proargtypes)` and `proargnames` instead of named
  `pg_get_function_identity_arguments()` to type-only strings, with OID
  locked by `to_regprocedure(...) = oid`. Creation stays false.
  MatchRequestSheet stays unmounted.
- **Still unresolved / later phases:** none for PostGIS rebind itself.
  Matching writer/API cutover is owned by v99B. Do not patch the deployed
  v95 hash helper in place.
- **Future replacement:** none; this is a one-shot post-move rebind.
- **Earliest safe production use:** already applied and verify-green.
- **Preconditions:** v95/v96 already applied; PostGIS in `extensions`.
- **Risk if wired early:** n/a. Do not re-run the applied v97 migration.

## 16. Stage-1 publish service_subtype (v98)

- **Current state:** PHASE 6.7C.2B applied by the user; official verify is
  **19/19 PASS**. Forward-only v98 adds `insert_stage1_post_v98` plus
  publish/shadow/Passkey wrappers that write `posts.service_subtype` from
  server canonical JSON. Travel/Deliver require a legal non-NULL subtype;
  Buy/Onsite/Errand require NULL. Subtype enters the payload hash. Browsers
  must not submit `origin_country_code`, `origin_timezone`, or
  `night_policy_version` as authority; those columns remain NULL on the
  current publish path. Night policy remains enabled=false. Creation stays
  false. v90ÃÂ¢ÃÂÃÂv97 and `init.sql` are untouched applied history.
- **Still unresolved / later phases:** admission writer/API switch (after
  v99A snapshot); night runtime enforcement; trusted country/IANA timezone
  resolver; request list/resend/accept; MatchRequestSheet.
- **Future replacement:** later publish RPCs may supersede v98; do not
  CREATE OR REPLACE the applied v86 path in place.
- **Earliest safe production use:** publish subtype path is verify-green
  after user apply; matching creation remains off.
- **Preconditions:** v95/v96/v97 applied; creation=false; night RS seed
  enabled=false.
- **Risk if wired early:** n/a for applied publish path while creation stays
  false.

## 17. Match admission authority facts/hash/snapshot (v99A)

- **Current state:** PHASE 6.7C.2C.1 / v99A. Forward-only, **applied**
  (verify 12/12 PASS). Adds three SECURITY DEFINER helpers only:
  `match_request_admission_post_facts_v99`,
  `match_request_admission_facts_hash_v99`,
  `read_match_request_candidate_snapshot_v99`. Does **not** create
  `create_match_request_v99` inside v99A itself. PostGIS types/functions
  use `extensions.` (post-v97). Facts include `admission_schema_version=99`
  plus `service_subtype` / `origin_country_code` / `origin_timezone` /
  `night_policy_version`. Snapshot is one SQL statement with one
  MATERIALIZED `posts` read; hash order is post id ascending. NULL country /
  timezone / policy values may be returned and hashed as-is; they must not
  be inferred. v95 five formal functions remain untouched.
- **Still unresolved / later phases:** night runtime; trusted country/IANA
  timezone resolver; enabling creation after fail-closed writer is verified.
- **Future replacement:** later writers must not CREATE OR REPLACE the
  deployed v95/v99A helpers in place.
- **Earliest safe production use:** snapshot helpers are applied; production
  matching still gated by creation=false and v99B writer apply.
- **Preconditions:** v95ÃÂ¢ÃÂÃÂv98 applied; PostGIS in `extensions`;
  creation=false; night RS enabled=false.
- **Risk if wired early:** enabling creation before the fail-closed writer.

## 18. Match request writer + API cutover (v99B)

- **Current state:** PHASE 6.7C.2C.2 / v99B. Forward-only, **applied**
  (verify 11/11 PASS). Adds `create_match_request_v99`. POST
  `/api/matching/requests` loads snapshot/writer v99; keeps
  `inspect_match_request_v95`. Exact retry precedes creation/lock/hash.
  Fresh requests require exact subtype pair match and full v98
  subtypeÃÂÃÂtransport allowlists on both posts. Creation and RS night
  remain false. PHASE 6.7C.2C.2A repaired pair/transport gates pre-apply.
- **Still unresolved / later phases:** trusted country/timezone publish
  path (see ÃÂÃÂ§19); night runtime; enabling creation.
- **Future replacement:** later writers must not CREATE OR REPLACE v99B
  in place without a new forward-only version.
- **Earliest safe production use:** matching creation still off; posts
  still lack non-NULL authority fields from publish.
- **Preconditions:** v99A applied; creation=false; night RS enabled=false.
- **Risk if wired early:** enabling creation while posts still carry NULL
  country/timezone/policy.

## 19. Trusted origin geocode / country / timezone resolver (2C.3B / 2C.3B.1)

- **Current state:** PHASE 6.7C.2C.3B.1. Server-only module
  `src/lib/geo/trustedOriginResolver.ts` resolves origin address Ã¢ÂÂ lat/lon/WKT
  / ISO country / IANA timezone. Two-level typed results in `route-kms.ts`:
  (1) **coordinate hit** Ã¢ÂÂ valid lat/lon, `countryCode` may be null (enough for
  `geocodeAddress` / OSRM); (2) **trusted authority** Ã¢ÂÂ requires `^[A-Z]{2}$`
  country + unique valid IANA timezone (fail closed). Country comes from the
  **same** Nominatim search hit as coordinates (`format=jsonv2`,
  `addressdetails=1`, 8s timeout); timezone from offline `geo-tz` only.
  Unified `parseFiniteCoordinate` / `isValidLatLon` for all lat/lon entry
  points. Public Nominatim batch geocode is **sequential** (original order,
  normalized-address dedupe, injectable Ã¢ÂÂ¥1000ms delay between HTTP calls) Ã¢ÂÂ
  this is a local courtesy throttle only, **not** a global rate-limit across
  serverless instances. Before production scale, replace public Nominatim with
  a compliant commercial provider or self-hosted Nominatim. Does **not** write
  posts, does not change publish APIs, does not add authority fields to
  CanonicalStage1Payload / toRpcStage1Payload / RPCs. `posts_update_own`
  bypass remains for a later writer/API cutover.
- **Still unresolved / later phases:** service_role publish writer; three API
  cutover; column/trigger seal on authority fields; enabling creation / RS
  night; Nominatim provider replacement / self-host.
- **Earliest safe production use:** resolver is library-only until a later
  publish phase wires it; public Nominatim is not production-scale-ready.
- **Preconditions:** v99B applied; creation=false; night RS enabled=false.
- **Risk if wired early:** treating resolver output as DB authority before
  service_role-only writer and UPDATE seal ship; public Nominatim rate limits
  across concurrent serverless instances.

## 20. Night policy selector v100 (2C.3C / 2C.3C.1)

- **Current state:** PHASE 6.7C.2C.3C.1. Forward-only unapplied migration
  `20260917000001_night_policy_selector_v100.sql` adds
  `public.select_night_service_policy_v100(text,text,text,timestamptz)` —
  LANGUAGE sql, SECURITY DEFINER, STABLE, fixed
  `search_path=pg_catalog, public, pg_temp`. service_role EXECUTE only;
  PUBLIC/anon/authenticated revoked. Does **not** grant table ACL on
  `night_service_policies`. Fail-closed on illegal country/region/timezone/
  evaluation_time (zero rows, no uppercase coercion, no Europe/Belgrade
  fallback). Selector requires `enabled IS TRUE`, exact timezone match,
  inclusive `effective_from`, exclusive `effective_until`, exact region over
  country default, then `policy_version DESC`, `effective_from DESC`,
  `id ASC`, `LIMIT 1`. Guard/verify pin `system_configs.id = 1` (exact one
  row, creation=false) and RS seed identity
  `(RS, region NULL, policy_version=1)` with `22:00`/`06:00`,
  `enabled=false`, `effective_until NULL`. Verify check 21 uses
  `seed.effective_from + interval '1 second'` so a not-yet-effective seed
  cannot fake disabled PASS; missing seed yields `selector_count` NULL → FAIL.
  `overall_pass` is text `PASS`/`FAIL`. Pure TS fixture mirror:
  `src/lib/safety/nightPolicySelectorV100.ts` (tests only).
- **Still unresolved / later phases:** service_role publish writer that calls
  this selector; API cutover; posts_update_own seal; enabling creation / RS
  night.
- **Earliest safe production use:** after live apply of v100 and a later
  writer phase; not before.
- **Preconditions:** v96 table+RS seed; v99A/v99B functions; creation=false.
- **Risk if wired early:** calling selector from client roles (blocked by ACL);
  treating disabled RS seed as an active policy (selector correctly returns
  zero rows).
