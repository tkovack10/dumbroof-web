/**
 * Phone validation — NANP (US/Canada) aware, catches common placeholders.
 *
 * Used by the phone-nag modal on dashboard login + the profile-edit form.
 * Goal: stop users from typing "283-212-3456" or "555-555-5555" and never
 * giving Tom a real number to call.
 */

export type PhoneCheck = {
  valid: boolean;
  reason?: "missing" | "too_short" | "invalid_npa" | "invalid_exchange" | "placeholder";
  digits: string;
};

const KNOWN_PLACEHOLDERS = new Set([
  "5555555555",
  "1234567890",
  "0000000000",
  "1111111111",
  "9999999999",
  "2832123456", // Jacob Henderson's typed-this-to-bypass entry — the trigger for adding this validator
  "1112223333",
  "1231231234",
]);

/** Strip every non-digit; drop a leading 1 country code if present (NANP-only). */
export function digitsOnly(phone: string | null | undefined): string {
  if (!phone) return "";
  let d = phone.replace(/\D/g, "");
  if (d.length === 11 && d.startsWith("1")) d = d.slice(1);
  return d;
}

/**
 * Validate a NANP phone. Rules per ITU-T E.164 + NANP plan:
 *   - 10 digits after stripping country code
 *   - Area code (NPA) starts 2-9 (0/1 reserved)
 *   - Exchange code (NXX) starts 2-9 (same rule)
 *   - Not a known placeholder
 */
export function checkPhone(phone: string | null | undefined): PhoneCheck {
  const digits = digitsOnly(phone);
  if (!digits) return { valid: false, reason: "missing", digits };
  if (digits.length !== 10) return { valid: false, reason: "too_short", digits };
  if (KNOWN_PLACEHOLDERS.has(digits)) return { valid: false, reason: "placeholder", digits };
  const npa = digits[0];
  const nxx = digits[3];
  if (npa === "0" || npa === "1") return { valid: false, reason: "invalid_npa", digits };
  if (nxx === "0" || nxx === "1") return { valid: false, reason: "invalid_exchange", digits };
  return { valid: true, digits };
}

/** Format 10 NANP digits as `(NPA) NXX-XXXX`. Returns input unchanged if not 10 digits. */
export function formatPhone(phone: string | null | undefined): string {
  const d = digitsOnly(phone);
  if (d.length !== 10) return phone || "";
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
}

/** Human-readable explanation for the user when validation fails. */
export function explainCheckFailure(check: PhoneCheck): string {
  switch (check.reason) {
    case "missing":
      return "Please add your phone number so we can reach you directly about urgent claims.";
    case "too_short":
      return "Phone number must be 10 digits. Please re-enter.";
    case "invalid_npa":
      return "Area code can't start with 0 or 1 — please double-check.";
    case "invalid_exchange":
      return "The middle three digits can't start with 0 or 1 — please double-check.";
    case "placeholder":
      return "That looks like a placeholder. Please enter your real phone number.";
    default:
      return "Phone number doesn't look right. Please re-enter.";
  }
}
