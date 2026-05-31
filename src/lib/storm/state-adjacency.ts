/**
 * US state land-border adjacency. Powers the storm-alert "radius": when a
 * qualifying hail/wind event hits state X, we alert past users in X AND every
 * state that borders X (Tom: zip-level is too narrow — roofers travel for
 * storms, so region = home state + adjacent states).
 *
 * Radius and send-frequency are independent: this widens WHO is eligible; the
 * per-user 5-day throttle in the alert cron caps HOW OFTEN anyone hears from us.
 * So a wide radius is safe.
 *
 * Includes DC and the Four Corners point-adjacencies (AZ-CO, NM-UT). Map is
 * symmetric. Alaska and Hawaii have no land neighbors (own-state only).
 */

export const STATE_ADJACENCY: Record<string, string[]> = {
  AL: ["FL", "GA", "MS", "TN"],
  AK: [],
  AZ: ["CA", "CO", "NV", "NM", "UT"],
  AR: ["LA", "MS", "MO", "OK", "TN", "TX"],
  CA: ["AZ", "NV", "OR"],
  CO: ["AZ", "KS", "NE", "NM", "OK", "UT", "WY"],
  CT: ["MA", "NY", "RI"],
  DE: ["MD", "NJ", "PA"],
  DC: ["MD", "VA"],
  FL: ["AL", "GA"],
  GA: ["AL", "FL", "NC", "SC", "TN"],
  HI: [],
  ID: ["MT", "NV", "OR", "UT", "WA", "WY"],
  IL: ["IN", "IA", "KY", "MO", "WI"],
  IN: ["IL", "KY", "MI", "OH"],
  IA: ["IL", "MN", "MO", "NE", "SD", "WI"],
  KS: ["CO", "MO", "NE", "OK"],
  KY: ["IL", "IN", "MO", "OH", "TN", "VA", "WV"],
  LA: ["AR", "MS", "TX"],
  ME: ["NH"],
  MD: ["DE", "PA", "VA", "WV", "DC"],
  MA: ["CT", "NH", "NY", "RI", "VT"],
  MI: ["IN", "OH", "WI"],
  MN: ["IA", "ND", "SD", "WI"],
  MS: ["AL", "AR", "LA", "TN"],
  MO: ["AR", "IL", "IA", "KS", "KY", "NE", "OK", "TN"],
  MT: ["ID", "ND", "SD", "WY"],
  NE: ["CO", "IA", "KS", "MO", "SD", "WY"],
  NV: ["AZ", "CA", "ID", "OR", "UT"],
  NH: ["ME", "MA", "VT"],
  NJ: ["DE", "NY", "PA"],
  NM: ["AZ", "CO", "OK", "TX", "UT"],
  NY: ["CT", "MA", "NJ", "PA", "VT"],
  NC: ["GA", "SC", "TN", "VA"],
  ND: ["MN", "MT", "SD"],
  OH: ["IN", "KY", "MI", "PA", "WV"],
  OK: ["AR", "CO", "KS", "MO", "NM", "TX"],
  OR: ["CA", "ID", "NV", "WA"],
  PA: ["DE", "MD", "NJ", "NY", "OH", "WV"],
  RI: ["CT", "MA"],
  SC: ["GA", "NC"],
  SD: ["IA", "MN", "MT", "NE", "ND", "WY"],
  TN: ["AL", "AR", "GA", "KY", "MS", "MO", "NC", "VA"],
  TX: ["AR", "LA", "NM", "OK"],
  UT: ["AZ", "CO", "ID", "NV", "NM", "WY"],
  VT: ["MA", "NH", "NY"],
  VA: ["KY", "MD", "NC", "TN", "WV", "DC"],
  WA: ["ID", "OR"],
  WV: ["KY", "MD", "OH", "PA", "VA"],
  WI: ["IL", "IA", "MI", "MN"],
  WY: ["CO", "ID", "MT", "NE", "SD", "UT"],
};

/** Valid 2-letter USPS codes we recognize (states + DC). */
export const VALID_STATES = new Set(Object.keys(STATE_ADJACENCY));

/**
 * The alert radius for a storm in `state`: the state itself plus all bordering
 * states. Returns a Set of 2-letter codes (always includes `state`).
 */
export function stormRadius(state: string): Set<string> {
  const s = state.toUpperCase().trim();
  const out = new Set<string>([s]);
  for (const adj of STATE_ADJACENCY[s] || []) out.add(adj);
  return out;
}
