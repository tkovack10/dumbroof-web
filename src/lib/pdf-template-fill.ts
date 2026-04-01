/**
 * PDF Template Fill — uses pdf-lib to overlay text, checkmarks, and signature
 * images onto a template PDF.
 *
 * Two modes:
 *   "prefill" — fills auto + sender fields (before sending to homeowner)
 *   "sign"    — fills signer fields + overlays signature/initials images
 */

import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import type { TemplateField } from "./usarm-aob-template";

export interface FillContext {
  /** Auto-fill values keyed by binding name */
  bindings: Record<string, string>;
  /** Sender-filled field values keyed by field ID */
  senderFields: Record<string, string>;
  /** Signer-filled text/date values keyed by field ID (sign mode only) */
  signerFields?: Record<string, string>;
  /** Signature/initials images keyed by field ID (sign mode only) — base64 PNG */
  signatureImages?: Record<string, string>;
}

export async function fillTemplatePdf(
  pdfBytes: Uint8Array,
  fields: TemplateField[],
  context: FillContext,
  mode: "prefill" | "sign",
// eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any> {
  const pdfDoc = await PDFDocument.load(pdfBytes);
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const pages = pdfDoc.getPages();

  const textColor = rgb(0.05, 0.05, 0.15); // near-black navy

  for (const field of fields) {
    // Determine if this field should be filled in this mode
    const shouldFill =
      (mode === "prefill" && (field.filledBy === "auto" || field.filledBy === "sender")) ||
      (mode === "sign" && field.filledBy === "signer");

    if (!shouldFill) continue;

    const page = pages[field.page];
    if (!page) continue;

    // Resolve the value for this field
    let value: string | undefined;

    if (field.filledBy === "auto" && field.binding) {
      value = context.bindings[field.binding];
    } else if (field.filledBy === "sender") {
      value = context.senderFields[field.id];
    } else if (field.filledBy === "signer") {
      // For signature/initials, the image is in signatureImages
      if (field.type === "signature" || field.type === "initials") {
        const imgData = context.signatureImages?.[field.id];
        if (imgData) {
          try {
            const base64 = imgData.replace(/^data:image\/png;base64,/, "");
            const imgBytes = Buffer.from(base64, "base64");
            const img = await pdfDoc.embedPng(imgBytes);
            const aspect = img.height / img.width;
            const drawWidth = Math.min(field.width, 200);
            const drawHeight = drawWidth * aspect;
            page.drawImage(img, {
              x: field.x,
              y: field.y,
              width: drawWidth,
              height: Math.min(drawHeight, field.height + 10),
            });
          } catch {
            // Skip if image can't be embedded
          }
        }
        continue;
      }
      // Text/date signer fields
      value = context.signerFields?.[field.id];
    }

    if (!value) continue;

    if (field.type === "checkbox") {
      // Draw a bold X for checked boxes
      if (value === "true" || value === "1" || value === "checked") {
        const size = Math.min(field.width, field.height, 11);
        page.drawText("X", {
          x: field.x,
          y: field.y,
          size,
          font,
          color: textColor,
        });
      }
      continue;
    }

    // Text / date fields — draw text at field coordinates
    const fontSize = field.fontSize || 10;
    // Truncate if text would overflow the field width
    let displayText = value;
    const maxChars = Math.floor(field.width / (fontSize * 0.5));
    if (displayText.length > maxChars) {
      displayText = displayText.substring(0, maxChars);
    }

    page.drawText(displayText, {
      x: field.x,
      y: field.y,
      size: fontSize,
      font,
      color: textColor,
    });
  }

  return pdfDoc.save();
}

/**
 * Add IP / timestamp audit trail to the last page after signing.
 */
export async function addAuditTrail(
  pdfBytes: Uint8Array,
  signerName: string,
  ip: string,
// eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any> {
  const pdfDoc = await PDFDocument.load(pdfBytes);
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const pages = pdfDoc.getPages();
  const lastPage = pages[pages.length - 1];

  const gray = rgb(0.5, 0.5, 0.5);
  const dateStr = new Date().toLocaleDateString("en-US");

  lastPage.drawText(`Electronically signed by ${signerName} on ${dateStr} | IP: ${ip}`, {
    x: 37,
    y: 15,
    size: 6,
    font,
    color: gray,
  });

  return pdfDoc.save();
}
