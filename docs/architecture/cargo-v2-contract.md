# Cargo V2 contract (PHASE 6.7B.1B)

MirioHub V1 is a rideshare-style information match platform. It is **not** a
professional logistics dispatcher, vehicle recommender, or 3D packing engine.

This file is a parse-only domain contract. This phase does **not** add
database columns, RPCs, APIs, UI, or production runtime imports. Server-side
re-parse remains mandatory before any future accept. Trilingual browser copy
is **not** added here (6.7B.1B).

## 1. What each side declares

- **Demand** estimates the **overall** length / width / height this shipment
  roughly needs, as one aggregate box in centimetres. There is **no**
  per-item list, category, quantity, or size preset.
- **Provider** declares the **remaining** length / width / height still
  available on **this trip** after their own belongings. That is not vehicle
  nameplate volume.
- The system only compares those two declarations. It does **not** recommend
  a van class, trailer, or boat. It does **not** prove the goods will fit.
  It does **not** judge legal payload.

## 2. Humans still confirm offline

Both parties must still confirm with text, photos (later, in the
handover/chat flow — **not uploaded in this contract**), and in-person
checks: cargo shape, vehicle openings, wheel arches, rotation/stacking,
true remaining space, weight/restraint, and loading conditions.

A `no_obvious_conflict` result is **not** platform approval.

## 3. Structures

`CargoRequirementV1`: `version`, `requiredSpace`, `approximateWeightKg`,
`escortPassengerCount` (0 or 1), `handlingRequest`, optional `note`.

`CargoCapacityV1`: `version`, `basis = current_trip_available_space`,
`availableSpace`, `availablePayloadKg`, `escortAccommodation`,
`handlingOffer`, optional `note`.

Dimensions: required centimetre integers, `> 0`, finite, safe integers,
ceiling in `cargoPolicy.ts` as an input safety bound only.

Weight: `{ kind: "known", kg }` or `{ kind: "unknown" }`. Unknown forces
`needs_confirmation`. Known kg is this-trip remaining payload, not GVW.

## 4. Handling is four advisory booleans, fee is always later 面议

Demand `handlingRequest`:

- `needsLoadingHelp: boolean` — wants Provider help loading
- `needsUnloadingHelp: boolean` — wants Provider help unloading

Provider `handlingOffer`:

- `canHelpLoading: boolean` — Provider says they can help load
- `canHelpUnloading: boolean` — Provider says they can help unload

Both fields are required strict booleans (`true`/`false` only).

These four flags are **advisory preferences only**. A mismatch:

- does **not** block creating a post
- does **not** block submitting a match request
- does **not** block accepting a request
- is **not** a Fraud signal
- is **not** a hard deny
- is **not** a matching filter or ranking penalty

The UI must require the parties to communicate and confirm when preferences
differ. This contract stores **no** handling fee, currency, min/max, unpaid
flag, Demand offer, or Provider asking price.

Future UI copy (not added this phase):

- Demand: 需要帮助方协助装货 / 需要帮助方协助卸货. If either is on:
  装卸协助费：面议. 请在接受申请前确认是否收费、具体金额和协助范围.
- Provider: 可以协助装货 / 可以协助卸货. If either is on:
  装卸协助费：面议. 是否收费及具体金额，由双方在接受申请前确认.

“Can help” is a self-report. It is **not** free labour, not verified
moving capacity, and not an agreed price.

## 5. Future `agreement_snapshot` (not this phase)

Publish/apply records only the four booleans. After chat, **immediately
before accept**, a later flow confirms: final loading help, final unloading
help, final handling fee and currency, or confirmed unpaid. Those fields
belong on `agreement_snapshot`. This phase does **not** write that snapshot
and does not pre-build an amount model.

## 6. Declared comparison

| Status | Meaning |
| --- | --- |
| `declared_conflict` | Only true declared conflicts: space, known weight vs payload, or escort `not_available`. Still talkable. Not Fraud hard deny. Handling mismatch **never** produces this status by itself. |
| `needs_confirmation` | Unknown weight, escort `requires_confirmation`, or any handling advisory (unavailable help or fee still to negotiate). |
| `no_obvious_conflict` | No obvious conflict in the filled-in numbers. **Does not mean it fits.** |

`requiresHumanConfirmation` is **always** `true`. This module does not
allow, reject, or write Fraud decisions.

True conflict reasons (only these):

- `declared_space_exceeds_available_space`
- `declared_weight_exceeds_available_payload`
- `escort_condition_differs`

Advisory handling reasons (never conflict, never Fraud, never a filter):

- `loading_help_unavailable`
- `unloading_help_unavailable`
- `handling_fee_negotiation_required`

Handling:

- Demand does not need a help type → Provider's corresponding boolean is ignored (no reason).
- Demand needs loading and Provider `canHelpLoading=true` → `handling_fee_negotiation_required` (scope, whether to charge, and the fee need offline confirmation).
- Demand needs unloading and Provider `canHelpUnloading=true` → same single de-duplicated `handling_fee_negotiation_required`.
- Demand needs loading and Provider `canHelpLoading=false` → `loading_help_unavailable` (`needs_confirmation`, not conflict).
- Demand needs unloading and Provider `canHelpUnloading=false` → `unloading_help_unavailable` (`needs_confirmation`, not conflict).
- Partial cover (one can, one cannot) keeps both the unavailable reason and `handling_fee_negotiation_required` for the offered item.
- Handling reasons may sit alongside a true space/weight/escort conflict so the parties still see the full prompt. Handling itself is never the blocking cause.

Space: sort three sides and compare pairwise (rough cuboid rotation only;
not packing proof). Weight: Demand known kg > Provider known kg → conflict;
either unknown → confirmation. Escort: Demand 1 + `not_available` →
conflict; `requires_confirmation` → confirmation.

Precedence: `declared_conflict` > `needs_confirmation` > `no_obvious_conflict`.
Only a true conflict reason may set `declared_conflict`. Reasons are stable
de-duplicated public keys. Comparison must not auto-accept, auto-reject,
hard-deny, write fraud logs, filter matches, apply ranking penalties, or
prove legality.

## 7. Parser boundary

Plain objects only; unknown keys rejected; arrays and prototype-polluted
objects rejected; private/contact/identity/location/code/fee/bid/payment
and leftover compensation/amount/currency keys rejected.

Runtime authenticity: module-private `WeakSet`. Parser freeze + register.
Copies, JSON round-trip, `structuredClone`, and same-shape objects fail
`isParsed*`. No exported runtime brand Symbol. The evaluator accepts only
WeakSet-registered values; `compareDeclaredCargo` parses first.

## 8. Out of this contract

No per-item entry, presets, vehicle-class recommendation, trailer fallback,
`guaranteed_fit`, photos, user/post ids, phones, plates, GPS, codes, or
handling/transport fee amounts.

Legacy `count_small/medium/large/xlarge` stay live luggage columns.

## 9. Application payload wiring (unmounted)

PHASE 6.7B.1B wires Cargo V2 into `ApplicationPayloadV1` and the unmounted
`MatchRequestSheet`:

- Provider applying to a Demand deliver post sends `cargoCapacity`.
- Demand applying to a Provider deliver post sends `cargoRequirement`.
- The applicant does not need to own a post.
- Travel still uses four-tier luggage counts.
- The sheet is **not** mounted on PostCard or the homepage.
- No match-request API, no `match_requests` / `match_contracts` writes, and
  no `agreement_snapshot` write.

Real users still do not see a Cargo V2 form until a later mount phase.
