# Cargo V2 contract (PHASE 6.7B.1A.2A)

MirioHub V1 is a rideshare-style information match platform. It is **not** a
professional logistics dispatcher, vehicle recommender, or 3D packing engine.

This file is a parse-only domain contract. This phase does **not** add
database columns, RPCs, APIs, UI, or production runtime imports. Server-side
re-parse remains mandatory before any future accept. Trilingual browser copy
is **not** added here.

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
checks:

- actual cargo shape
- vehicle openings
- wheel arches / irregular cabin space
- whether items can rotate or stack
- true remaining space
- weight and safe restraint
- loading and unloading conditions

A `no_obvious_conflict` result is **not** platform approval, a verified
vehicle, or a guaranteed load.

## 3. Structures

`CargoRequirementV1` (Demand): `version`, `requiredSpace`,
`approximateWeightKg`, `escortPassengerCount` (0 or 1), `handlingRequest`,
optional `note`.

`CargoCapacityV1` (Provider): `version`, `basis =
current_trip_available_space`, `availableSpace`, `availablePayloadKg`,
`escortAccommodation`, `handlingOffer`, optional `note`.

Dimensions are required integers, centimetres, `> 0`, finite, safe integers,
with a centralized input ceiling in `cargoPolicy.ts`. The ceiling is only an
input safety bound.

Weight is `{ kind: "known", kg }` (positive, finite, at most one decimal,
capped) or `{ kind: "unknown" }`. Unknown is legal and forces
`needs_confirmation`. Known kg is **this trip's declared remaining payload**,
not GVW from a nameplate.

## 4. Escort and handling

Demand escort is 0 or 1. Provider does **not** enter a generic seat count.
`available` is a self-report. The platform must not show verified / safe /
approved. An escort mismatch is a declared-condition conflict, not a Fraud
hard deny.

Handling uses one scope: `none` | `loading` | `unloading` | `both`.
Compensation exists only when scope is not `none`.

- Demand compensation: willing-to-pay handling help (`fixed` or
  `negotiable`). Currency V1: `RSD` | `EUR`. `amountMinor` is a positive
  safe integer (RSD minor units / EUR cents). Display formatting is later UI.
- Provider compensation: hoped-for handling help (`fixed`, `negotiable`, or
  `voluntary_unpaid`). `voluntary_unpaid` means the Provider offers unpaid
  help voluntarily; the platform is not requiring free labour. It does **not**
  turn the Demand offered amount into a Provider receivable.

Handling assistance is separate from the main transport fee. The final
agreed handling terms belong in a later `agreement_snapshot`, not in this
phase.

## 5. Declared comparison (not a fit verdict)

Statuses:

| Status | Meaning |
| --- | --- |
| `declared_conflict` | Filled-in declarations differ (space, weight, escort, or handling scope). Parties can still talk. Not a Fraud hard deny. |
| `needs_confirmation` | Unknown weight, negotiable fee, currency/amount gap, or Provider escort `requires_confirmation`. |
| `no_obvious_conflict` | No obvious conflict in the filled-in numbers. **Does not mean it fits or the platform approved it.** |

`requiresHumanConfirmation` is **always** `true`.

Space: sort each box's three sides and compare pairwise (rotation of a rough
cuboid only). This is **not** packing proof: doors, arches, stacking, tilt,
and restraint are out of scope. A numeric non-conflict still needs humans.

Weight: both known and Demand kg > Provider kg → `declared_conflict`. Either
unknown → `needs_confirmation`. No legal GVW inference.

Escort: Demand 1 + Provider `not_available` → `declared_conflict`. Provider
`requires_confirmation` → `needs_confirmation`.

Handling coverage: `both` covers loading/unloading/both; `loading` covers
loading only; `unloading` covers unloading only; `none` covers no assistance
request. Demand `none` needs no coverage.

Fee: either `negotiable` → confirmation; both `fixed` with different
currency or Provider amount > Demand amount → confirmation; Provider
amount ≤ Demand amount is not a fee conflict (accept still confirms the
exact amount later); `voluntary_unpaid` is not a fee conflict and does not
auto-assign the Demand offer as payable.

Reason precedence: `declared_conflict` > `needs_confirmation` >
`no_obvious_conflict`. Reasons are stable, de-duplicated public keys. They
must not include phones, addresses, or raw amounts.

The comparison must not auto-accept, auto-reject, hard-deny, write fraud
logs, or prove vehicle legality / space / load safety.

## 6. Parser boundary

Parsers require plain objects, reject unknown keys, reject prototype-polluted
objects and arrays-as-objects, and recursively reject private / contact /
identity / location / code / bid / payment fields. Handling compensation is
the only allowed money field. Parsers return branded
`ParsedCargoRequirementV1` / `ParsedCargoCapacityV1`. The evaluator accepts
only branded values (or `compareDeclaredCargo` which parses first).

## 7. Out of this contract

No per-item entry, presets, vehicle-class recommendation, trailer fallback,
`guaranteed_fit`, photos, user/post ids, phones, plates, GPS, pickup/delivery
codes, or main-fee overrides.

Legacy `count_small/medium/large/xlarge` stay the live luggage columns. They
must not be cast to Cargo V2.

## 8. This phase has no DB / UI / API

No migration, no `posts` change, no application payload, no
`MatchRequestSheet`, no hall button, no RPC. Real users still do not see a
Cargo V2 form.
