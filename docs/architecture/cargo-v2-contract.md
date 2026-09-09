# Cargo V2 contract (PHASE 6.7B.1A.2)

Domain types only. This phase does **not** add database columns, RPCs, APIs,
UI, or production runtime imports. Server-side re-validation remains mandatory
before any future accept.

Error keys are a contract for a later 6.7B.1B sheet wiring pass. Trilingual
browser copy is **not** added in this phase.

## 1. Travel vs Deliver

- **Travel** keeps people fields (`peopleCount` / `peopleCapacity`) and
  `travelItemUnits` for ordinary small items / luggage. That lane is not Cargo
  V2.
- **Deliver** is the only lane that uses `CargoRequirementV1` (Demand) and
  `CargoCapacityV1` (Provider current-trip remaining space).
- Do not fold furniture, appliances, or mattresses into `travelItemUnits`.
- Do not treat Cargo V2 as a replacement for the live four-tier luggage
  columns in this phase.

## 2. Requirement vs current-trip capacity

- `CargoRequirementV1` is what this Demand needs to move **this time**.
- `CargoCapacityV1` is what this Provider can still offer **on this trip**
  after subtracting their own goods. The `basis` value is always
  `current_trip_available_space`.
- It is **not** the vehicle nameplate volume or legal GVW. Nameplate figures
  must not be copied into `availableSpace` / `availablePayloadKg` as if they
  were remaining capacity.

## 3. Vehicle class is a pre-filter

`recommendCargoVehicleClass` is Demand-form help. Confidence is `estimated`
or `insufficient_data`. It is not a hard deny, not a guaranteed fit, and not
an accept decision. Thresholds live in `cargoPolicy.ts` and may be
recalibrated from real usage. They are not copied from any third-party fleet
catalog.

## 4. Size, weight, and handling

- Custom dimensions are centimetres, integers 1–2000, as a rough bounding box.
- Presets are fill-in shortcuts with centralized estimate sizes. A numeric
  “looks like it fits” preset still needs human confirmation.
- `measurement.kind = "unknown"` is legal and forces confirmation.
- Known weight is kg per unit, `> 0`, `<= 10000`, at most one decimal.
- Pickup and dropoff handling are separate. Default product rule: a ride-along
  cargo trip does **not** automatically include moving labour. Provider help
  must be confirmed explicitly and is not priced in this phase.
- Location access records floor, elevator, and carry distance only. It does
  not store an address or GPS.

## 5. Unknown is legal, and it blocks preliminary compatibility

Unknown item size, unknown item weight, unknown remaining space, unknown
remaining payload, unknown floor/elevator, or unknown carry distance when
Provider help is requested all yield at least `needs_confirmation`.

## 6. Three compatibility statuses

| Status | Meaning |
| --- | --- |
| `incompatible` | Objective filled-in numbers conflict (piece too large, total volume or weight over remaining capacity, escort or loading help clearly unavailable). |
| `needs_confirmation` | Missing estimates, presets, special handling, stairs, or “requires confirmation” labour/escort. |
| `preliminarily_compatible` | No obvious numeric conflict in the filled-in data. |

## 7. `requiresHumanConfirmation` is always `true`

Even `preliminarily_compatible` only means: no obvious remaining-space
conflict was found in the submitted numbers. Both parties must still check
goods, vehicle, loading, and safety before accept.

## 8. The platform does not guarantee a fit

Do not use `guaranteed_fit`, `safe`, `verified`, or `approved`. Remaining
volume not exceeded is **not** a 3D packing proof.

## 9. The platform does not verify vehicle, papers, or insurance

Capacity and escort `available` are Provider declarations. Legal seats, belts,
and load-after-stow safety are accept-time human checks. The platform does
not inspect vehicles, licences, or insurance.

## 10. Dangerous goods are out of V1

There is no hazardous / weapon / contraband category. Those keys are
rejected. Handling flags never mean “licensed dangerous goods”.

## 11. Photos and identity documents are not uploaded here

The contract forbids user id, post id, phone, email, plate, address, GPS,
fee, bid, payment, photo URLs, and pickup/delivery codes.

## 12. Legacy four-tier luggage cannot be upgraded losslessly

Production still uses `count_small/medium/large/xlarge`. Those counts must
not be cast to `CargoRequirementV1`. They lack size, weight, and handling.
A future read-only adapter can at most emit `needs_confirmation`. `xlarge`
must not auto-pick a vehicle class. See `deferred-cleanup.md`.

## 13. This phase has no DB / UI / API

No migration, no `posts` change, no application payload, no
`MatchRequestSheet`, no hall button, no RPC.

## 14. Future 6.7B.1B application sheet

Wire parsers behind an unmounted or newly versioned request sheet. Add
zh/en/sr copy for the cargo error keys at that time. Do not treat browser
JSON as trusted.

## 15. Future accept-time re-read

Before accept, the server must rebuild both snapshots from stored rows (or
the request snapshot plus a fresh Provider capacity declaration), re-run
`parseCargoRequirementV1` / `parseCargoCapacityV1` / 
`evaluateCargoCompatibility`, and still require human confirmation. Do not
trust a previously computed `preliminarily_compatible` flag from the client.
