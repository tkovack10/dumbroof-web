/**
 * Single source of truth for the "$100 signed-AOB" commission gate.
 *
 * Tom's rule (2026-05-29): a rep only gets the $100 once they've done the
 * real work of starting a proper claim — they must create the claim, have
 * homeowner name/phone/email, the carrier claim number, a deliverable carrier
 * email (the adjuster's OR the insurance company's general claims email — we
 * can't have claims we can't send a supplement/COC to), inspection photos
 * uploaded (so a forensic can generate), AND the signed AOB uploaded.
 *
 * Imported by BOTH the server gate (POST /api/claim/[id]/commission-request)
 * and the client checklist (AobCommissionModal) so the UI can never drift
 * from what the API actually enforces — see the detection-superset principle.
 */

export interface AobClaimFields {
  homeowner_name?: string | null;
  homeowner_phone?: string | null;
  homeowner_email?: string | null;
  claim_number?: string | null;
  adjuster_email?: string | null;
  carrier_email?: string | null;
  photo_files?: string[] | null;
  aob_files?: string[] | null;
}

export interface AobCheckItem {
  key: keyof AobClaimFields;
  label: string;
  hint: string;
  ok: boolean;
}

/** The exact columns the gate reads — select these and nothing else. */
export const AOB_CLAIM_FIELDS: (keyof AobClaimFields)[] = [
  "homeowner_name",
  "homeowner_phone",
  "homeowner_email",
  "claim_number",
  "adjuster_email",
  "carrier_email",
  "photo_files",
  "aob_files",
];

const hasText = (v: unknown): boolean =>
  typeof v === "string" && v.trim().length > 0;
const hasFiles = (v: unknown): boolean => Array.isArray(v) && v.length > 0;

/** Ordered checklist with pass/fail for each requirement. */
export function aobChecklist(claim: AobClaimFields): AobCheckItem[] {
  return [
    {
      key: "homeowner_name",
      label: "Homeowner name",
      hint: "On the claim record",
      ok: hasText(claim.homeowner_name),
    },
    {
      key: "homeowner_phone",
      label: "Homeowner phone",
      hint: "On the claim record",
      ok: hasText(claim.homeowner_phone),
    },
    {
      key: "homeowner_email",
      label: "Homeowner email",
      hint: "On the claim record",
      ok: hasText(claim.homeowner_email),
    },
    {
      key: "claim_number",
      label: "Claim number",
      hint: "Carrier claim #",
      ok: hasText(claim.claim_number),
    },
    {
      key: "adjuster_email",
      label: "Adjuster or carrier claims email",
      hint: "So we can send the supplement / COC",
      ok: hasText(claim.adjuster_email) || hasText(claim.carrier_email),
    },
    {
      key: "photo_files",
      label: "Inspection photos uploaded",
      hint: "So a forensic report can generate",
      ok: hasFiles(claim.photo_files),
    },
    {
      key: "aob_files",
      label: "Signed AOB uploaded",
      hint: "The signature page",
      ok: hasFiles(claim.aob_files),
    },
  ];
}

/** Labels of everything still missing (empty array = eligible for the $100). */
export function aobMissing(claim: AobClaimFields): string[] {
  return aobChecklist(claim)
    .filter((item) => !item.ok)
    .map((item) => item.label);
}

/** True when the claim satisfies every $100-AOB requirement. */
export function isAobEligible(claim: AobClaimFields): boolean {
  return aobMissing(claim).length === 0;
}
