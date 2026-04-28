/**
 * phone-validation.test.ts — node:test stdlib runner, no dev-deps required.
 *
 * Run: npx tsx --test src/lib/phone-validation.test.ts
 *
 * Pinning the rules so a future "loosen the validator" change has to
 * update these assertions consciously, not silently.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkPhone, formatPhone, digitsOnly } from "./phone-validation";

// ── Real, callable phones ────────────────────────────────────────────────
test("real 10-digit number is valid", () => {
  const r = checkPhone("267-679-1504");
  assert.equal(r.valid, true);
  assert.equal(r.digits, "2676791504");
});

test("real number with +1 country code is valid", () => {
  const r = checkPhone("+1 (267) 679-1504");
  assert.equal(r.valid, true);
  assert.equal(r.digits, "2676791504");
});

test("real number with parens / spaces / dots is valid", () => {
  assert.equal(checkPhone("(401) 219-2165").valid, true);
  assert.equal(checkPhone("281.766.4227").valid, true);
  assert.equal(checkPhone("609 424 2736").valid, true);
});

// ── Placeholders ─────────────────────────────────────────────────────────
test("Jacob's bypass pattern (283-212-3456) is rejected as placeholder", () => {
  // NPA 283 is a known placeholder pattern in our user data — caught by
  // the explicit deny list (283 is technically also unassigned NANP, but
  // we'd rather be safe and explicit).
  const r = checkPhone("283-212-3456");
  assert.equal(r.valid, false);
  assert.equal(r.reason, "placeholder");
});

test("555-555-5555 is rejected as placeholder", () => {
  const r = checkPhone("555-555-5555");
  assert.equal(r.valid, false);
  assert.equal(r.reason, "placeholder");
});

test("123-456-7890 is rejected as placeholder", () => {
  const r = checkPhone("123-456-7890");
  assert.equal(r.valid, false);
});

// ── NANP rule violations ─────────────────────────────────────────────────
test("area code starting with 0 is invalid_npa", () => {
  const r = checkPhone("078-555-1234");
  assert.equal(r.valid, false);
  assert.equal(r.reason, "invalid_npa");
});

test("area code starting with 1 is invalid_npa", () => {
  // After stripping the leading 1 country code, this becomes "234567890" — only 9 digits → too_short.
  // But raw "0145551234" → invalid_npa.
  const r = checkPhone("0145551234");
  assert.equal(r.valid, false);
  assert.equal(r.reason, "invalid_npa");
});

test("exchange code starting with 0 is invalid_exchange", () => {
  const r = checkPhone("267-079-1504");
  assert.equal(r.valid, false);
  assert.equal(r.reason, "invalid_exchange");
});

// ── Length / empty ───────────────────────────────────────────────────────
test("empty / null / undefined is missing", () => {
  assert.equal(checkPhone("").reason, "missing");
  assert.equal(checkPhone(null).reason, "missing");
  assert.equal(checkPhone(undefined).reason, "missing");
});

test("too short is too_short", () => {
  assert.equal(checkPhone("267-679").reason, "too_short");
  assert.equal(checkPhone("123").reason, "too_short");
});

// ── digitsOnly + formatPhone ─────────────────────────────────────────────
test("digitsOnly strips formatting + leading 1", () => {
  assert.equal(digitsOnly("+1 (267) 679-1504"), "2676791504");
  assert.equal(digitsOnly("267.679.1504"), "2676791504");
  assert.equal(digitsOnly(""), "");
  assert.equal(digitsOnly(null), "");
});

test("formatPhone returns canonical (NPA) NXX-XXXX", () => {
  assert.equal(formatPhone("2676791504"), "(267) 679-1504");
  assert.equal(formatPhone("+1 267 679 1504"), "(267) 679-1504");
});

test("formatPhone passes through invalid input unchanged", () => {
  assert.equal(formatPhone("not-a-phone"), "not-a-phone");
  assert.equal(formatPhone("123"), "123");
});
