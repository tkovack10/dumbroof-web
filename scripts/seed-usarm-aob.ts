/**
 * Seed script: Upload the USARM AOB NY combined PDF to Supabase storage
 * and insert the document_templates row with field definitions.
 *
 * Usage: npx tsx scripts/seed-usarm-aob.ts
 *
 * Prerequisites:
 *   - Combined 2-page PDF at /tmp/usarm-aob-ny-combined.pdf
 *   - .env.local with NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_KEY
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";

// Load .env.local manually
const envContent = readFileSync(".env.local", "utf-8");
for (const line of envContent.split("\n")) {
  const match = line.match(/^([^#=]+)=(.*)$/);
  if (match) process.env[match[1].trim()] = match[2].trim();
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY!;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_KEY in .env.local");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const STORAGE_PATH = "templates/usarm-aob-ny-v1.pdf";
const PDF_LOCAL_PATH = "/tmp/usarm-aob-ny-combined.pdf";

// Field definitions from usarm-aob-template.ts (imported as JSON for the seed)
import { USARM_AOB_NY_FIELDS } from "../src/lib/usarm-aob-template";

async function main() {
  console.log("1. Uploading USARM AOB PDF to Supabase storage...");

  const pdfBytes = readFileSync(PDF_LOCAL_PATH);

  const { error: uploadError } = await supabase.storage
    .from("claim-documents")
    .upload(STORAGE_PATH, pdfBytes, {
      contentType: "application/pdf",
      upsert: true,
    });

  if (uploadError) {
    console.error("Upload failed:", uploadError.message);
    process.exit(1);
  }
  console.log(`   Uploaded to claim-documents/${STORAGE_PATH}`);

  console.log("2. Checking for existing USARM AOB template...");

  const { data: existing } = await supabase
    .from("document_templates")
    .select("id")
    .eq("name", "USARM AOB NY")
    .eq("is_system", true)
    .limit(1);

  if (existing && existing.length > 0) {
    console.log(`   Existing template found (${existing[0].id}), updating...`);

    const { error: updateError } = await supabase
      .from("document_templates")
      .update({
        pdf_storage_path: STORAGE_PATH,
        page_count: 2,
        fields: USARM_AOB_NY_FIELDS,
        updated_at: new Date().toISOString(),
      })
      .eq("id", existing[0].id);

    if (updateError) {
      console.error("Update failed:", updateError.message);
      process.exit(1);
    }
    console.log(`   Template updated: ${existing[0].id}`);
  } else {
    console.log("   No existing template, inserting...");

    const { data: inserted, error: insertError } = await supabase
      .from("document_templates")
      .insert({
        name: "USARM AOB NY",
        document_type: "aob",
        description: "USA Roof Masters — Authorization & Assignment of Insurance Claim Benefits (New York)",
        pdf_storage_path: STORAGE_PATH,
        page_count: 2,
        fields: USARM_AOB_NY_FIELDS,
        is_system: true,
        is_active: true,
      })
      .select("id")
      .single();

    if (insertError) {
      console.error("Insert failed:", insertError.message);
      process.exit(1);
    }
    console.log(`   Template created: ${inserted.id}`);
  }

  console.log("\nDone! USARM AOB NY template is ready.");
  console.log(`Fields: ${USARM_AOB_NY_FIELDS.length} total`);
  console.log(`  Auto: ${USARM_AOB_NY_FIELDS.filter((f) => f.filledBy === "auto").length}`);
  console.log(`  Sender: ${USARM_AOB_NY_FIELDS.filter((f) => f.filledBy === "sender").length}`);
  console.log(`  Signer: ${USARM_AOB_NY_FIELDS.filter((f) => f.filledBy === "signer").length}`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
