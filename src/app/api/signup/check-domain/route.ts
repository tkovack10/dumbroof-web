import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

// Personal email domains — never treat as "company match" since they don't
// indicate shared employer.
const PERSONAL_DOMAINS = new Set([
  "gmail.com", "yahoo.com", "hotmail.com", "outlook.com", "icloud.com",
  "aol.com", "live.com", "msn.com", "me.com", "protonmail.com",
  "comcast.net", "verizon.net", "att.net", "sbcglobal.net", "cox.net",
  "charter.net", "earthlink.net", "ymail.com", "rocketmail.com",
  "googlemail.com", "duck.com", "hey.com", "fastmail.com",
]);

interface MatchedCompany {
  companyId: string;
  companyName: string | null;
  memberCount: number;
  ownerEmail: string | null;
}

/**
 * Public endpoint (no auth) — checks if the signup email's domain is already
 * associated with an existing company. If so, returns minimal metadata so the
 * signup UI can show "join your team" guidance.
 *
 * Information disclosure: returns company_name + member_count + owner_email
 * for the matching company. All three are low-sensitivity (the user is
 * presumably an employee or applicant). Personal domains never match.
 */
export async function POST(req: NextRequest) {
  let body: { email?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ matched: null });
  }

  const email = (body.email || "").trim().toLowerCase();
  if (!email.includes("@")) {
    return NextResponse.json({ matched: null });
  }

  const domain = email.split("@")[1];
  if (!domain || PERSONAL_DOMAINS.has(domain)) {
    return NextResponse.json({ matched: null });
  }

  // Find any company_profiles row whose email shares this domain. We DON'T
  // search by company_name (too noisy) — domain is the strongest signal.
  // ilike pattern: anything @<domain>
  const { data: rows, error: lookupErr } = await supabaseAdmin
    .from("company_profiles")
    .select("user_id, email, company_name, company_id, role, is_admin, created_at")
    .ilike("email", `%@${domain}`)
    .not("company_id", "is", null)
    .order("created_at", { ascending: true });

  if (lookupErr) {
    console.error("[check-domain] supabase lookup failed", { domain, error: lookupErr.message });
    return NextResponse.json({ matched: null });
  }

  if (!rows || rows.length === 0) {
    return NextResponse.json({ matched: null });
  }

  // Group by company_id and pick the largest cohort. If the domain spans
  // multiple companies (rare), the dominant one wins.
  const byCompany = new Map<string, typeof rows>();
  for (const r of rows) {
    const cid = r.company_id as string;
    const arr = byCompany.get(cid) || [];
    arr.push(r);
    byCompany.set(cid, arr);
  }

  let best: MatchedCompany | null = null;
  for (const [cid, members] of byCompany) {
    if (best && members.length <= best.memberCount) continue;
    // Owner = first member by created_at, OR explicit role=owner
    const owner = members.find((m) => m.role === "owner") || members[0];
    best = {
      companyId: cid,
      companyName: members.find((m) => m.company_name)?.company_name || null,
      memberCount: members.length,
      ownerEmail: owner?.email || null,
    };
  }

  if (!best) return NextResponse.json({ matched: null });

  return NextResponse.json({
    matched: {
      companyName: best.companyName,
      memberCount: best.memberCount,
      ownerEmail: best.ownerEmail,
      // companyId intentionally omitted — UI doesn't need it (user can't
      // self-join; they have to ask owner to invite them).
    },
  });
}
