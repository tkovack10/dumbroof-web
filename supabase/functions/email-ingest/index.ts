/**
 * Supabase Edge Function — Email Ingest Webhook
 *
 * Receives parsed email from Cloudflare Email Worker:
 * 1. Validates webhook secret
 * 2. Deduplicates on message_id
 * 3. Maps forwarder email → user_id
 * 4. Runs claim matching algorithm
 * 5. Uploads PDF attachments to Storage
 * 6. Inserts carrier_correspondence record
 * 7. Triggers AI analysis if matched
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.47.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const WEBHOOK_SECRET = Deno.env.get("WEBHOOK_SECRET")!;
const BACKEND_URL = Deno.env.get("BACKEND_URL") || "http://localhost:8000";

interface EmailPayload {
  message_id: string | null;
  from_email: string;
  to_email: string;
  subject: string;
  date: string | null;
  is_forwarded: boolean;
  original_from: string | null;
  original_subject: string | null;
  original_date: string | null;
  original_body: string;
  forwarder_note: string;
  text_body: string;
  html_body: string;
  in_reply_to: string | null;
  references: string | null;
  attachments: Array<{
    filename: string;
    mimeType: string;
    content: string; // base64
    size: number;
  }>;
}

interface MatchResult {
  claim_id: string | null;
  method: string;
  confidence: number;
  carrier_name: string | null;
  claim_number: string | null;
  address: string | null;
}

// Known carrier email domains
const CARRIER_DOMAINS: Record<string, string> = {
  "statefarm.com": "State Farm",
  "allstate.com": "Allstate",
  "libertymutual.com": "Liberty Mutual",
  "assurant.com": "Assurant",
  "nycm.com": "NYCM",
  "erieinsurance.com": "Erie Insurance",
  "travelers.com": "Travelers",
  "nationwide.com": "Nationwide",
  "progressive.com": "Progressive",
  "usaa.com": "USAA",
  "geico.com": "GEICO",
  "amica.com": "Amica",
  "hanover.com": "The Hanover",
  "thehartford.com": "The Hartford",
  "chubb.com": "Chubb",
  "safeco.com": "Safeco",
  "mapfre.com": "MAPFRE",
  "csaa.com": "CSAA",
  "farmersinsurance.com": "Farmers",
};

Deno.serve(async (req: Request) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
      },
    });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405 });
  }

  // Validate webhook secret
  const authHeader = req.headers.get("authorization");
  if (!authHeader || authHeader !== `Bearer ${WEBHOOK_SECRET}`) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  try {
    const payload: EmailPayload = await req.json();
    console.log(`[INGEST] Processing email from ${payload.from_email}, message_id=${payload.message_id}`);

    // 1. Dedup check on message_id
    if (payload.message_id) {
      const { data: existing } = await supabase
        .from("carrier_correspondence")
        .select("id")
        .eq("message_id", payload.message_id)
        .maybeSingle();

      if (existing) {
        console.log(`[INGEST] Duplicate message_id: ${payload.message_id}`);
        return new Response(JSON.stringify({ id: existing.id, duplicate: true }), { status: 200 });
      }
    }

    // 2. Map forwarder email → user_id
    const forwarderEmail = payload.from_email.toLowerCase();
    const userId = await resolveUserId(supabase, forwarderEmail);

    if (!userId) {
      console.log(`[INGEST] Unknown forwarder: ${forwarderEmail}`);
      return new Response(
        JSON.stringify({ error: "Unknown forwarder email", from: forwarderEmail }),
        { status: 403 }
      );
    }

    // 3. Identify carrier from original sender
    const carrierEmail = payload.original_from || forwarderEmail;
    const carrierName = identifyCarrier(carrierEmail, payload.text_body);

    // 4. Extract claim number and address from email content
    const searchText = `${payload.subject} ${payload.original_subject || ""} ${payload.text_body}`;
    const claimNumber = extractClaimNumber(searchText);
    const addressParsed = extractAddress(searchText);

    // 5. Run claim matching
    const match = await matchToClaim(supabase, userId, {
      inReplyTo: payload.in_reply_to,
      claimNumber,
      address: addressParsed,
      carrierName,
      carrierEmail,
      subject: payload.original_subject || payload.subject,
    });

    // 6. Upload attachments to Storage
    const attachmentPaths: string[] = [];
    const claimSlug = match.claim_id ? await getClaimSlug(supabase, match.claim_id) : "unmatched";

    for (const att of payload.attachments) {
      const storagePath = `${userId}/${claimSlug}/correspondence/${Date.now()}_${att.filename}`;
      const bytes = Uint8Array.from(atob(att.content), (c) => c.charCodeAt(0));

      const { error: uploadError } = await supabase.storage
        .from("claim-documents")
        .upload(storagePath, bytes, {
          contentType: att.mimeType,
          upsert: false,
        });

      if (uploadError) {
        console.error(`[INGEST] Upload failed for ${att.filename}:`, uploadError.message);
      } else {
        attachmentPaths.push(storagePath);
      }
    }

    // 7. Insert carrier_correspondence record
    const correspondenceRecord = {
      claim_id: match.claim_id,
      user_id: userId,
      message_id: payload.message_id,
      from_email: payload.from_email,
      original_from: payload.original_from || payload.from_email,
      original_subject: payload.original_subject || payload.subject,
      original_date: payload.original_date ? tryParseDate(payload.original_date) : payload.date,
      text_body: payload.is_forwarded ? payload.original_body : payload.text_body,
      html_body: payload.html_body,
      is_forwarded: payload.is_forwarded,
      carrier_name: match.carrier_name || carrierName,
      claim_number_parsed: match.claim_number || claimNumber,
      address_parsed: match.address || addressParsed,
      attachment_paths: attachmentPaths,
      match_method: match.method,
      match_confidence: match.confidence,
      status: match.claim_id ? "matched" : "unmatched",
      analysis_status: "pending",
    };

    const { data: inserted, error: insertError } = await supabase
      .from("carrier_correspondence")
      .insert(correspondenceRecord)
      .select("id")
      .single();

    if (insertError) {
      console.error(`[INGEST] Insert failed:`, insertError.message);
      return new Response(JSON.stringify({ error: insertError.message }), { status: 500 });
    }

    console.log(`[INGEST] Created correspondence ${inserted.id}, matched=${!!match.claim_id}, confidence=${match.confidence}`);

    // 8. Update claim correspondence_count
    if (match.claim_id) {
      await supabase.rpc("increment_claim_field", {
        claim_id_param: match.claim_id,
        field_name: "correspondence_count",
      }).then(() => {}).catch(() => {
        // Fallback: direct update if RPC doesn't exist yet
        supabase
          .from("claims")
          .select("correspondence_count")
          .eq("id", match.claim_id!)
          .single()
          .then(({ data }) => {
            const current = data?.correspondence_count || 0;
            supabase
              .from("claims")
              .update({ correspondence_count: current + 1 })
              .eq("id", match.claim_id!)
              .then(() => {});
          });
      });
    }

    // 9. Trigger AI analysis if matched with sufficient confidence
    if (match.claim_id && match.confidence >= 50) {
      try {
        await fetch(`${BACKEND_URL}/api/analyze-correspondence/${inserted.id}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
        });
        console.log(`[INGEST] Triggered AI analysis for ${inserted.id}`);
      } catch (analysisError) {
        console.error(`[INGEST] Failed to trigger analysis:`, analysisError);
        // Non-fatal — user can trigger manually from dashboard
      }
    }

    return new Response(
      JSON.stringify({
        id: inserted.id,
        matched: !!match.claim_id,
        claim_id: match.claim_id,
        confidence: match.confidence,
        method: match.method,
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }
    );

  } catch (error) {
    console.error(`[INGEST] Error:`, error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Internal error" }),
      { status: 500 }
    );
  }
});

// ============================================================
// HELPER FUNCTIONS
// ============================================================

/** Resolve forwarder email to a user_id */
async function resolveUserId(
  supabase: ReturnType<typeof createClient>,
  email: string
): Promise<string | null> {
  // 1. Check auth.users table
  const { data: users } = await supabase.auth.admin.listUsers();
  const authUser = users?.users?.find(
    (u: { email?: string }) => u.email?.toLowerCase() === email
  );
  if (authUser) return authUser.id;

  // 2. Check authorized_forwarders table
  const { data: forwarder } = await supabase
    .from("authorized_forwarders")
    .select("user_id")
    .eq("email", email)
    .maybeSingle();

  return forwarder?.user_id || null;
}

/** Identify carrier from email domain or body text */
function identifyCarrier(email: string, body: string): string | null {
  // Check email domain
  const domain = email.split("@")[1]?.toLowerCase();
  if (domain && CARRIER_DOMAINS[domain]) {
    return CARRIER_DOMAINS[domain];
  }

  // Check body for carrier names
  const bodyLower = body.toLowerCase();
  for (const [, carrier] of Object.entries(CARRIER_DOMAINS)) {
    if (bodyLower.includes(carrier.toLowerCase())) {
      return carrier;
    }
  }

  return null;
}

/** Extract claim/policy number from text */
function extractClaimNumber(text: string): string | null {
  // Common patterns: "Claim #12345", "Claim Number: 12-AB-123456", "Policy: HO-1234567"
  const patterns = [
    /claim\s*#?\s*:?\s*([A-Z0-9][\w-]{4,20})/i,
    /policy\s*#?\s*:?\s*([A-Z0-9][\w-]{4,20})/i,
    /file\s*#?\s*:?\s*([A-Z0-9][\w-]{4,20})/i,
    /reference\s*#?\s*:?\s*([A-Z0-9][\w-]{4,20})/i,
    // Numeric claim numbers (7+ digits)
    /\b(\d{7,15})\b/,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return match[1];
  }

  return null;
}

/** Extract address from text (looks for street number + street name pattern) */
function extractAddress(text: string): string | null {
  // Match: "123 Main Street" or "1234 N Pennsylvania Ave"
  const match = text.match(
    /\b(\d{1,5}\s+(?:[NSEW]\.?\s+)?(?:[A-Z][a-z]+\s*){1,4}(?:St(?:reet)?|Ave(?:nue)?|Rd|Road|Blvd|Boulevard|Dr(?:ive)?|Ln|Lane|Way|Ct|Court|Pl(?:ace)?|Pkwy|Cir(?:cle)?))\b/i
  );
  return match ? match[1] : null;
}

/** Run claim matching algorithm — returns best match */
async function matchToClaim(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  params: {
    inReplyTo: string | null;
    claimNumber: string | null;
    address: string | null;
    carrierName: string | null;
    carrierEmail: string | null;
    subject: string;
  }
): Promise<MatchResult> {
  // Strategy 1: Thread match via In-Reply-To header (confidence: 99)
  if (params.inReplyTo) {
    const { data: threadMatch } = await supabase
      .from("email_drafts")
      .select("claim_id")
      .eq("gmail_thread_id", params.inReplyTo)
      .maybeSingle();

    if (threadMatch?.claim_id) {
      return {
        claim_id: threadMatch.claim_id,
        method: "thread",
        confidence: 99,
        carrier_name: params.carrierName,
        claim_number: params.claimNumber,
        address: params.address,
      };
    }
  }

  // Get all user's claims for subsequent matching
  const { data: userClaims } = await supabase
    .from("claims")
    .select("id, address, carrier, claim_outcome")
    .eq("user_id", userId);

  if (!userClaims || userClaims.length === 0) {
    return {
      claim_id: null,
      method: "none",
      confidence: 0,
      carrier_name: params.carrierName,
      claim_number: params.claimNumber,
      address: params.address,
    };
  }

  // Strategy 2: Address match (confidence: 85)
  if (params.address) {
    const normalizedAddress = normalizeAddress(params.address);
    for (const claim of userClaims) {
      const claimAddress = normalizeAddress(claim.address || "");
      if (claimAddress && normalizedAddress && fuzzyAddressMatch(normalizedAddress, claimAddress)) {
        return {
          claim_id: claim.id,
          method: "address",
          confidence: 85,
          carrier_name: params.carrierName || claim.carrier,
          claim_number: params.claimNumber,
          address: claim.address,
        };
      }
    }
  }

  // Strategy 3: Carrier + subject keywords (confidence: 60)
  if (params.carrierName) {
    const carrierClaims = userClaims.filter(
      (c: { carrier?: string }) => c.carrier?.toLowerCase().includes(params.carrierName!.toLowerCase())
    );

    if (carrierClaims.length === 1) {
      // Only one claim with this carrier — high confidence
      return {
        claim_id: carrierClaims[0].id,
        method: "carrier_single",
        confidence: 75,
        carrier_name: params.carrierName,
        claim_number: params.claimNumber,
        address: carrierClaims[0].address,
      };
    }

    // Multiple claims with same carrier — try subject line address fragments
    if (carrierClaims.length > 1 && params.subject) {
      const subjectLower = params.subject.toLowerCase();
      for (const claim of carrierClaims) {
        const addressWords = (claim.address || "").toLowerCase().split(/\s+/);
        const streetNumber = addressWords[0];
        const streetName = addressWords.slice(1, 3).join(" ");
        if (
          (streetNumber && subjectLower.includes(streetNumber)) ||
          (streetName && subjectLower.includes(streetName))
        ) {
          return {
            claim_id: claim.id,
            method: "subject_keywords",
            confidence: 60,
            carrier_name: params.carrierName,
            claim_number: params.claimNumber,
            address: claim.address,
          };
        }
      }
    }
  }

  // No match
  return {
    claim_id: null,
    method: "none",
    confidence: 0,
    carrier_name: params.carrierName,
    claim_number: params.claimNumber,
    address: params.address,
  };
}

/** Normalize address for matching */
function normalizeAddress(addr: string): string {
  return addr
    .toLowerCase()
    .replace(/\bstreet\b/g, "st")
    .replace(/\bavenue\b/g, "ave")
    .replace(/\broad\b/g, "rd")
    .replace(/\bboulevard\b/g, "blvd")
    .replace(/\bdrive\b/g, "dr")
    .replace(/\blane\b/g, "ln")
    .replace(/\bcourt\b/g, "ct")
    .replace(/\bplace\b/g, "pl")
    .replace(/[.,#]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Fuzzy address match — checks if core components match */
function fuzzyAddressMatch(a: string, b: string): boolean {
  // Extract street number and first word of street name
  const partsA = a.split(" ");
  const partsB = b.split(" ");

  // Street number must match
  if (partsA[0] !== partsB[0]) return false;

  // At least one street name word must match
  const wordsA = new Set(partsA.slice(1));
  const wordsB = new Set(partsB.slice(1));
  for (const word of wordsA) {
    if (wordsB.has(word) && word.length > 2) return true;
  }

  return false;
}

/** Get claim file_path slug for storage organization */
async function getClaimSlug(
  supabase: ReturnType<typeof createClient>,
  claimId: string
): Promise<string> {
  const { data } = await supabase
    .from("claims")
    .select("file_path, address")
    .eq("id", claimId)
    .single();

  if (data?.file_path) {
    // Extract last segment of file_path as slug
    const parts = data.file_path.split("/");
    return parts[parts.length - 1] || "claim";
  }

  // Fallback: slugify address
  return (data?.address || "claim")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .substring(0, 50);
}

/** Try to parse a date string from email headers */
function tryParseDate(dateStr: string): string | null {
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return null;
    return d.toISOString();
  } catch {
    return null;
  }
}
