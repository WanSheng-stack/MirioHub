/**
 * Pure mirror of complete_post_contact_v102 ghost-presence fail-closed rules.
 * SQL is authoritative; this exists for unit coverage of the reject matrix.
 */

export type GhostPresenceInput = {
  has_phone: boolean;
  raw_phone: string | null;
  normalized_phone: string | null;
  phone_id: number | null;
  has_plate: boolean;
  raw_license_plate: string | null;
  normalized_license_plate: string | null;
  plate_id: number | null;
  has_provider_name: boolean;
  provider_name: string | null;
  has_vehicle_brand: boolean;
  vehicle_brand: string | null;
  has_vehicle_color: boolean;
  vehicle_color: string | null;
  has_transport_mode: boolean;
  transport_mode: string | null;
  destination_update_kind: "omit" | "point" | "use_origin";
  destination_gps: unknown | null;
};

/** Returns true when the RPC must reject with error.submit_failed. */
export function ghostPresenceRejects(input: GhostPresenceInput): boolean {
  if (
    !input.has_phone &&
    (input.raw_phone !== null ||
      input.normalized_phone !== null ||
      input.phone_id !== null)
  ) {
    return true;
  }
  if (
    !input.has_plate &&
    (input.raw_license_plate !== null ||
      input.normalized_license_plate !== null ||
      input.plate_id !== null)
  ) {
    return true;
  }
  if (!input.has_provider_name && input.provider_name !== null) return true;
  if (!input.has_vehicle_brand && input.vehicle_brand !== null) return true;
  if (!input.has_vehicle_color && input.vehicle_color !== null) return true;
  if (!input.has_transport_mode && input.transport_mode !== null) return true;
  if (
    (input.destination_update_kind === "omit" ||
      input.destination_update_kind === "use_origin") &&
    input.destination_gps !== null
  ) {
    return true;
  }
  if (
    input.destination_update_kind === "point" &&
    input.destination_gps === null
  ) {
    return true;
  }
  return false;
}

export function cleanGhostPresenceInput(
  overrides: Partial<GhostPresenceInput> = {},
): GhostPresenceInput {
  return {
    has_phone: false,
    raw_phone: null,
    normalized_phone: null,
    phone_id: null,
    has_plate: false,
    raw_license_plate: null,
    normalized_license_plate: null,
    plate_id: null,
    has_provider_name: false,
    provider_name: null,
    has_vehicle_brand: false,
    vehicle_brand: null,
    has_vehicle_color: false,
    vehicle_color: null,
    has_transport_mode: false,
    transport_mode: null,
    destination_update_kind: "omit",
    destination_gps: null,
    ...overrides,
  };
}
