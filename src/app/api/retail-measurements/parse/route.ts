import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/api-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/retail-measurements/parse
 *
 * Accepts an EagleView / HOVER / GAF QuickMeasure / Hover PDF as multipart form
 * data (field name "file"), sends it to Claude (Anthropic API) with a structured
 * extraction prompt, and returns the parsed measurements. Used by the retail
 * estimate UI to one-click pre-fill the measurement form from a report PDF.
 *
 * Returns shape:
 *   { measurements: { roof_area_sq, eave_lf, rake_lf, ridge_lf, hip_lf,
 *     valley_lf, ridge_lf_vented, pipe_count_standard, step_flash_lf,
 *     counter_flash_lf }, source: "<provider>" }
 *
 * Fields that the report doesn't contain return as null — the client preserves
 * any value the user already typed.
 */

interface ParsedMeasurements {
  roof_area_sq: number | null;
  eave_lf: number | null;
  rake_lf: number | null;
  ridge_lf: number | null;
  hip_lf: number | null;
  valley_lf: number | null;
  ridge_lf_vented: number | null;
  pipe_count_standard: number | null;
  step_flash_lf: number | null;
  counter_flash_lf: number | null;
  source: string;
}

const SYSTEM_PROMPT = `You extract roof measurements from EagleView, HOVER, GAF QuickMeasure, or
similar aerial-measurement report PDFs.

Output STRICT JSON with this exact shape (numbers in feet/squares, or null):

{
  "roof_area_sq": number | null,           // Total roof area in squares (1 SQ = 100 SF). Look for "Total Area", "Roof Area".
  "eave_lf": number | null,                // Total eave linear feet.
  "rake_lf": number | null,                // Total rake LF.
  "ridge_lf": number | null,               // Total ridge LF.
  "hip_lf": number | null,                 // Total hip LF.
  "valley_lf": number | null,              // Total valley LF.
  "ridge_lf_vented": number | null,        // If specified separately; else equal to ridge_lf.
  "pipe_count_standard": number | null,    // Count of standard plumbing penetrations 1.5–3".
  "step_flash_lf": number | null,          // Step flashing LF at wall/roof.
  "counter_flash_lf": number | null,       // Counter flashing LF (chimney, parapet).
  "source": "EagleView" | "HOVER" | "GAF QuickMeasure" | "Hover" | "Other"
}

Rules:
- If a value is in square feet, convert to squares by dividing by 100.
- If a value is in inches or meters, convert to feet.
- If a field isn't explicitly present in the report, return null. Don't invent.
- Some reports give Total Length (sum of all edge LF) — DON'T put that in any single field.
- ridge_lf and hip_lf are separate — don't lump them together.
- If the report shows multiple roof sections, sum across all sections.

Return JSON only — no markdown, no explanation.`;

export async function POST(req: NextRequest) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth.response;

  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) {
    return NextResponse.json({ error: "ANTHROPIC_API_KEY not configured" }, { status: 503 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Expected multipart form data with 'file' field" }, { status: 400 });
  }
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
  }
  if (file.size > 20 * 1024 * 1024) {
    return NextResponse.json({ error: "File too large (>20MB)" }, { status: 413 });
  }

  const ext = file.name.toLowerCase().split(".").pop();
  if (ext !== "pdf") {
    return NextResponse.json({ error: "Only PDF uploads supported (EagleView/HOVER export as PDF)" }, { status: 415 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const base64 = buffer.toString("base64");

  let answerJson: ParsedMeasurements | null = null;
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 600,
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "document",
                source: { type: "base64", media_type: "application/pdf", data: base64 },
              },
              {
                type: "text",
                text: "Extract the measurements from this aerial-measurement report. Return JSON only.",
              },
            ],
          },
        ],
      }),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      console.error("[retail-measurements/parse] Anthropic error", res.status, errText.slice(0, 300));
      return NextResponse.json({ error: `Anthropic API ${res.status}` }, { status: 502 });
    }
    const json = (await res.json()) as { content?: Array<{ type: string; text?: string }> };
    const text = (json.content || []).find((c) => c.type === "text")?.text || "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return NextResponse.json({ error: "Claude returned no JSON" }, { status: 502 });
    }
    answerJson = JSON.parse(jsonMatch[0]) as ParsedMeasurements;
  } catch (err) {
    console.error("[retail-measurements/parse] threw:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }

  return NextResponse.json({ measurements: answerJson });
}
