/** Generate 15-minute departure windows for a full day: "00:00-00:15" … "23:45-24:00" */
export function generateTimeWindows(): string[] {
  const windows: string[] = [];
  for (let h = 0; h < 24; h++) {
    for (let m = 0; m < 60; m += 15) {
      const startH = String(h).padStart(2, "0");
      const startM = String(m).padStart(2, "0");
      const endTotal = h * 60 + m + 15;
      const endH = String(Math.floor(endTotal / 60) % 24).padStart(2, "0");
      const endM = String(endTotal % 60).padStart(2, "0");
      windows.push(`${startH}:${startM}-${endH}:${endM}`);
    }
  }
  return windows;
}

export const TIME_WINDOWS = generateTimeWindows();

/** Parse window start time "HH:MM" from "HH:MM-HH:MM" */
export function parseWindowStart(window: string): { hours: number; minutes: number } {
  const start = window.split("-")[0] ?? "00:00";
  const [h, m] = start.split(":").map(Number);
  return { hours: h ?? 0, minutes: m ?? 0 };
}

/** Build ISO timestamp for departure_date + window start */
export function buildDepartureTimestamp(date: string, window: string): Date {
  const { hours, minutes } = parseWindowStart(window);
  const d = new Date(`${date}T00:00:00`);
  d.setHours(hours, minutes, 0, 0);
  return d;
}

/** ±30 min range for demand intercept */
export function demandInterceptRange(
  date: string,
  window: string,
): { from: Date; to: Date } {
  const center = buildDepartureTimestamp(date, window);
  const from = new Date(center.getTime() - 30 * 60 * 1000);
  const to = new Date(center.getTime() + 30 * 60 * 1000);
  return { from, to };
}

/** Fuse precise clock + wait-buffer into absolute window "HH:MM-HH:MM". */
export function mergeDepartureWindow(
  departureTime: string,
  timeBufferMinutes: number,
): string {
  const [hRaw, mRaw] = departureTime.split(":").map(Number);
  const startMinutes = (hRaw ?? 0) * 60 + (mRaw ?? 0);
  const buffer = Math.max(0, Math.min(180, Math.floor(timeBufferMinutes)));
  const endMinutes = startMinutes + buffer;
  const fmt = (total: number) => {
    const h = Math.floor(total / 60) % 24;
    const m = total % 60;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  };
  return `${fmt(startMinutes)}-${fmt(endMinutes)}`;
}

export function formatDepartureWindowLabel(window: string): string {
  const [start, end] = window.split("-");
  if (!start || !end) return window;
  return `${start} – ${end}`;
}

export const COUNTRY_DIAL_CODES = [
  { code: "+381", key: "country.sr" },
  { code: "+86", key: "country.cn" },
  { code: "+1", key: "country.us" },
  { code: "+44", key: "country.uk" },
  { code: "+49", key: "country.de" },
  { code: "+33", key: "country.fr" },
  { code: "+39", key: "country.it" },
  { code: "+43", key: "country.at" },
  { code: "+41", key: "country.ch" },
  { code: "+385", key: "country.hr" },
  { code: "+387", key: "country.ba" },
  { code: "+382", key: "country.me" },
  { code: "+389", key: "country.mk" },
] as const;
