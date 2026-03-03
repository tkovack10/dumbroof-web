/**
 * Forward Parser — Detects and extracts original email from forwarded messages
 *
 * Supports:
 * - Gmail:      "---------- Forwarded message ----------"
 * - Outlook:    "-----Original Message-----"
 * - Apple Mail: "Begin forwarded message:"
 * - Yahoo:      "----- Forwarded Message -----"
 */

export interface ParsedForward {
  isForwarded: boolean;
  originalFrom: string | null;
  originalTo: string | null;
  originalSubject: string | null;
  originalDate: string | null;
  originalBody: string;
  forwarderNote: string; // Text the forwarder added above the forward block
}

// Header extraction patterns
const HEADER_PATTERNS = {
  from: /^(?:From|De|Van|Von):\s*(.+)$/im,
  to: /^(?:To|A|Aan|An):\s*(.+)$/im,
  subject: /^(?:Subject|Sujet|Onderwerp|Betreff):\s*(.+)$/im,
  date: /^(?:Date|Datum|Fecha):\s*(.+)$/im,
};

/**
 * Gmail-style forward:
 * ---------- Forwarded message ----------
 * From: adjuster@carrier.com
 * Date: Mon, Mar 3, 2026
 * Subject: Re: Claim #12345
 * To: sales@company.com
 *
 * [body]
 */
function parseGmailForward(text: string): ParsedForward | null {
  const marker = "---------- Forwarded message ----------";
  const idx = text.indexOf(marker);
  if (idx === -1) return null;

  const forwarderNote = text.substring(0, idx).trim();
  const rest = text.substring(idx + marker.length).trim();

  // Split at first blank line — headers above, body below
  const blankLineIdx = rest.search(/\n\s*\n/);
  const headerBlock = blankLineIdx !== -1 ? rest.substring(0, blankLineIdx) : rest;
  const body = blankLineIdx !== -1 ? rest.substring(blankLineIdx).trim() : "";

  return {
    isForwarded: true,
    originalFrom: extractHeader(headerBlock, "from"),
    originalTo: extractHeader(headerBlock, "to"),
    originalSubject: extractHeader(headerBlock, "subject"),
    originalDate: extractHeader(headerBlock, "date"),
    originalBody: body,
    forwarderNote,
  };
}

/**
 * Outlook-style forward:
 * -----Original Message-----
 * From: adjuster@carrier.com
 * Sent: Monday, March 3, 2026
 * To: sales@company.com
 * Subject: Re: Claim #12345
 *
 * [body]
 */
function parseOutlookForward(text: string): ParsedForward | null {
  const marker = "-----Original Message-----";
  const idx = text.indexOf(marker);
  if (idx === -1) return null;

  const forwarderNote = text.substring(0, idx).trim();
  const rest = text.substring(idx + marker.length).trim();

  const blankLineIdx = rest.search(/\n\s*\n/);
  const headerBlock = blankLineIdx !== -1 ? rest.substring(0, blankLineIdx) : rest;
  const body = blankLineIdx !== -1 ? rest.substring(blankLineIdx).trim() : "";

  // Outlook uses "Sent:" instead of "Date:"
  const dateMatch = headerBlock.match(/^Sent:\s*(.+)$/im);
  const outlookDate = dateMatch ? dateMatch[1].trim() : null;

  return {
    isForwarded: true,
    originalFrom: extractHeader(headerBlock, "from"),
    originalTo: extractHeader(headerBlock, "to"),
    originalSubject: extractHeader(headerBlock, "subject"),
    originalDate: outlookDate || extractHeader(headerBlock, "date"),
    originalBody: body,
    forwarderNote,
  };
}

/**
 * Apple Mail-style forward:
 * Begin forwarded message:
 *
 * > From: adjuster@carrier.com
 * > Subject: Re: Claim #12345
 * > Date: March 3, 2026
 * > To: sales@company.com
 * >
 * > [body]
 */
function parseAppleMailForward(text: string): ParsedForward | null {
  const marker = "Begin forwarded message:";
  const idx = text.indexOf(marker);
  if (idx === -1) return null;

  const forwarderNote = text.substring(0, idx).trim();
  let rest = text.substring(idx + marker.length).trim();

  // Remove Apple Mail quote markers ("> ")
  rest = rest
    .split("\n")
    .map((line) => (line.startsWith("> ") ? line.substring(2) : line.startsWith(">") ? line.substring(1) : line))
    .join("\n");

  const blankLineIdx = rest.search(/\n\s*\n/);
  const headerBlock = blankLineIdx !== -1 ? rest.substring(0, blankLineIdx) : rest;
  const body = blankLineIdx !== -1 ? rest.substring(blankLineIdx).trim() : "";

  return {
    isForwarded: true,
    originalFrom: extractHeader(headerBlock, "from"),
    originalTo: extractHeader(headerBlock, "to"),
    originalSubject: extractHeader(headerBlock, "subject"),
    originalDate: extractHeader(headerBlock, "date"),
    originalBody: body,
    forwarderNote,
  };
}

/**
 * Yahoo-style forward:
 * ----- Forwarded Message -----
 * (same header format as Gmail)
 */
function parseYahooForward(text: string): ParsedForward | null {
  const marker = "----- Forwarded Message -----";
  const idx = text.indexOf(marker);
  if (idx === -1) return null;

  const forwarderNote = text.substring(0, idx).trim();
  const rest = text.substring(idx + marker.length).trim();

  const blankLineIdx = rest.search(/\n\s*\n/);
  const headerBlock = blankLineIdx !== -1 ? rest.substring(0, blankLineIdx) : rest;
  const body = blankLineIdx !== -1 ? rest.substring(blankLineIdx).trim() : "";

  return {
    isForwarded: true,
    originalFrom: extractHeader(headerBlock, "from"),
    originalTo: extractHeader(headerBlock, "to"),
    originalSubject: extractHeader(headerBlock, "subject"),
    originalDate: extractHeader(headerBlock, "date"),
    originalBody: body,
    forwarderNote,
  };
}

function extractHeader(block: string, field: keyof typeof HEADER_PATTERNS): string | null {
  const match = block.match(HEADER_PATTERNS[field]);
  return match ? match[1].trim() : null;
}

/**
 * Extract email address from a "From" header value like:
 *   "John Smith <john@example.com>" → "john@example.com"
 *   "john@example.com" → "john@example.com"
 */
export function extractEmailAddress(fromHeader: string): string {
  const bracketMatch = fromHeader.match(/<([^>]+)>/);
  if (bracketMatch) return bracketMatch[1].toLowerCase();
  const emailMatch = fromHeader.match(/[\w.+-]+@[\w.-]+\.\w+/);
  if (emailMatch) return emailMatch[0].toLowerCase();
  return fromHeader.toLowerCase().trim();
}

/**
 * Main entry point — tries all parsers in order, returns first match
 */
export function parseForwardedEmail(text: string): ParsedForward {
  // Try each parser in order of prevalence
  const parsers = [
    parseGmailForward,
    parseOutlookForward,
    parseAppleMailForward,
    parseYahooForward,
  ];

  for (const parser of parsers) {
    const result = parser(text);
    if (result) return result;
  }

  // Not a forwarded email — return as-is
  return {
    isForwarded: false,
    originalFrom: null,
    originalTo: null,
    originalSubject: null,
    originalDate: null,
    originalBody: text,
    forwarderNote: "",
  };
}
