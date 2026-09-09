# Cargo V2 contract (PHASE 6.7B.1A.2B)

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

## 4. Handling is four booleans, fee is always later 面议

Demand `handlingRequest`:

- `needsLoadingHelp: boolean` — wants Provider help loading
- `needsUnloadingHelp: boolean` — wants Provider help unloading

Provider `handlingOffer`:

- `canHelpLoading: boolean` — Provider says they can help load
- `canHelpUnloading: boolean` — Provider says they can help unload

Both fields are required strict booleans (`true`/`false` only).

This contract stores **no** handling fee, currency, min/max, unpaid flag,
Demand offer, or Provider asking price.

Future UI copy (not added this phase):

- Demand: 需要帮助方协助装货 / 需要帮助方协助卸货. If either is on:
  装卸协助费：面议. 请在接受申请前确认是否收费、具体金额和协助范围.
- Provider: 可以协助装货 / 可以协助卸货. If either is on:
  装卸协助费：面议. 是否收费及具体金额，由双方在接受申请前确认.

“Can help” is a self-report. It is **not** free labour, not verified
moving capacity, and not an agreed price.

## 5. Future `agreement_snapshot` (not this phase)

Publish/apply records only the four booleans. After chat, **before accept**,
a later flow confirms: final loading help, final unloading help, final
handling fee and currency, or confirmed unpaid. Those fields belong on
`agreement_snapshot`. Do not pre-build an amount model here.

## 6. Declared comparison

| Status | Meaning |
| --- | --- |
| `declared_conflict` | Declarations differ (space, weight, escort, or a requested help the Provider cannot give). Still talkable. Not Fraud hard deny. |
| `needs_confirmation` | Unknown weight, escort `requires_confirmation`, or requested help is offered so fee must be negotiated. |
| `no_obvious_conflict` | No obvious conflict in the filled-in numbers. **Does not mean it fits.** |

`requiresHumanConfirmation` is **always** `true`.

Handling:

- Demand does not need a help type → Provider's corresponding boolean is ignored (no reason).
- Demand needs loading and Provider `canHelpLoading=false` → `loading_help_unavailable`.
- Demand needs unloading and Provider `canHelpUnloading=false` → `unloading_help_unavailable`.
- Every requested help is offered → `handling_fee_negotiation_required` (`needs_confirmation`).
- Unavailable outranks negotiation.

Space: sort three sides and compare pairwise (rough cuboid rotation only;
not packing proof). Weight: Demand known kg > Provider known kg → conflict;
either unknown → confirmation. Escort: Demand 1 + `not_available` →
conflict; `requires_confirmation` → confirmation.

Precedence: `declared_conflict` > `needs_confirmation` > `no_obvious_conflict`.
Reasons are stable de-duplicated public keys. Comparison must not
auto-accept, auto-reject, hard-deny, write fraud logs, or prove legality.

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

## 9. This phase has no DB / UI / API

No migration, no application payload, no `MatchRequestSheet`, no hall
button, no RPC. Real users still do not see a Cargo V2 form.
