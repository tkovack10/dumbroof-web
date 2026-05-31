/**
 * NOAA Storm Prediction Center (SPC) daily storm-report ingest.
 *
 * SPC publishes free, no-key daily CSVs of preliminary hail/wind/tornado
 * reports. We pull hail + wind. Verified live schema (2026-05-31):
 *
 *   Time,Size,Location,County,State,Lat,Lon,Comments
 *
 * - Hail `Size` = hail diameter in HUNDREDTHS OF AN INCH (100 = 1.00", quarter).
 * - Wind `Size` = gust in MPH, sometimes prefixed by a source letter:
 *   `E` = estimated (e.g. "E70"), `M` = measured. "UNK"/blank => unknown, skip.
 * - `Comments` may contain commas; we only read columns 0-6, so it's ignored.
 *
 * Endpoints: today / yesterday. We ingest `yesterday_*` on the daily cron so we
 * capture the full convective day (SPC's day is 12Z-12Z).
 *   https://www.spc.noaa.gov/climo/reports/yesterday_hail.csv
 *   https://www.spc.noaa.gov/climo/reports/yesterday_wind.csv
 */

import { VALID_STATES } from "./state-adjacency";

/** Claim-generating severity gates (tunable). */
export const HAIL_MIN_HUNDREDTHS = 100; // 1.00" — quarter size, the practical hail-damage floor
export const WIND_MIN_MPH = 58; // NWS severe-thunderstorm wind criterion

export type StormType = "hail" | "wind";

export interface StormReport {
  type: StormType;
  /** Hail: inches (e.g. 1.75). Wind: mph (e.g. 70). */
  magnitude: number;
  /** Raw magnitude token as published (e.g. "175", "E70"). */
  magnitudeRaw: string;
  location: string;
  county: string;
  state: string; // 2-letter USPS, validated
  lat: number | null;
  lon: number | null;
  timeRaw: string; // HHMM as published
}

const SPC_BASE = "https://www.spc.noaa.gov/climo/reports";

/** Parse a wind speed token: strip a leading source letter (E/M/...), parse int. */
function parseWindMph(raw: string): number | null {
  const digits = raw.replace(/[^0-9]/g, "");
  if (!digits) return null;
  const n = parseInt(digits, 10);
  return Number.isFinite(n) ? n : null;
}

/** Parse hundredths-inch hail token into inches. */
function parseHailInches(raw: string): number | null {
  const n = parseInt(raw.replace(/[^0-9]/g, ""), 10);
  return Number.isFinite(n) ? n / 100 : null;
}

function num(s: string): number | null {
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

/**
 * Parse one SPC CSV body into reports at/above threshold. Only columns 0-6 are
 * read; malformed rows and below-threshold rows are dropped silently.
 */
export function parseSpcCsv(type: StormType, body: string): StormReport[] {
  const out: StormReport[] = [];
  const lines = body.split(/\r?\n/);
  for (const line of lines) {
    if (!line.trim()) continue;
    const f = line.split(",");
    if (f.length < 7) continue;
    if (f[0].trim().toLowerCase() === "time") continue; // header (repeats per WFO in SPC files)
    if (f[1].trim().toLowerCase() === "size" || f[1].trim().toLowerCase() === "speed") continue;

    const state = f[4].trim().toUpperCase();
    if (!VALID_STATES.has(state)) continue;

    const magnitudeRaw = f[1].trim();
    let magnitude: number | null;
    if (type === "hail") {
      magnitude = parseHailInches(magnitudeRaw);
      if (magnitude === null || magnitude * 100 < HAIL_MIN_HUNDREDTHS) continue;
    } else {
      magnitude = parseWindMph(magnitudeRaw);
      if (magnitude === null || magnitude < WIND_MIN_MPH) continue;
    }

    out.push({
      type,
      magnitude,
      magnitudeRaw,
      location: f[2].trim(),
      county: f[3].trim(),
      state,
      lat: num(f[5]),
      lon: num(f[6]),
      timeRaw: f[0].trim(),
    });
  }
  return out;
}

/** Fetch + parse one SPC report file. `when` selects today vs yesterday. */
export async function fetchSpcReports(
  type: StormType,
  when: "today" | "yesterday" = "yesterday",
): Promise<StormReport[]> {
  const url = `${SPC_BASE}/${when}_${type}.csv`;
  const res = await fetch(url, {
    headers: { "User-Agent": "DumbRoof storm-ingest (tom@dumbroof.ai)" },
    // SPC updates these files frequently; never serve a stale cache.
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`SPC fetch failed ${type}/${when}: HTTP ${res.status}`);
  }
  const body = await res.text();
  return parseSpcCsv(type, body);
}

/** A storm report's stable dedup key for the storm_events table. */
export function stormEventKey(r: StormReport, eventDate: string): string {
  return `${r.type}|${eventDate}|${r.state}|${r.county}|${r.timeRaw}|${r.magnitudeRaw}`;
}
