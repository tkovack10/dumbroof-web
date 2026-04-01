"use client";

import { useState, useRef, useEffect, useCallback } from "react";

interface TemplateField {
  id: string;
  label: string;
  type: "text" | "signature" | "initials" | "date" | "checkbox";
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize?: number;
  filledBy: string;
  required?: boolean;
  group?: string;
}

interface Props {
  signatureId: string;
  documentType: string;
  homeownerName: string;
  companyName: string;
  claimAddress: string;
  pdfUrl: string | null;
  templateFields?: TemplateField[];
}

const DOC_TYPE_LABELS: Record<string, string> = {
  aob: "Assignment of Benefits",
  contingency: "Contingency Agreement",
  repair_approval: "Repair Work Approval",
};

export function SignForm({ signatureId, documentType, homeownerName, companyName, claimAddress, pdfUrl, templateFields }: Props) {
  const [agreed, setAgreed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // ---- Template mode state ----
  const canvasRefs = useRef<Map<string, HTMLCanvasElement>>(new Map());
  const drawingRefs = useRef<Map<string, boolean>>(new Map());
  const [drawnFields, setDrawnFields] = useState<Set<string>>(new Set());
  const [textValues, setTextValues] = useState<Record<string, string>>({});

  // ---- Legacy mode state ----
  const legacyCanvasRef = useRef<HTMLCanvasElement>(null);
  const legacyDrawingRef = useRef(false);
  const [legacyHasDrawn, setLegacyHasDrawn] = useState(false);
  const [legacySignerName, setLegacySignerName] = useState(homeownerName || "");

  const isTemplateMode = templateFields && templateFields.length > 0;

  // Pre-fill date fields and name fields with defaults
  useEffect(() => {
    if (!isTemplateMode) return;
    const defaults: Record<string, string> = {};
    const today = new Date().toLocaleDateString("en-US");
    for (const f of templateFields) {
      if (f.type === "date") {
        defaults[f.id] = today;
      }
      if (f.type === "text" && f.id.includes("print_name") && homeownerName) {
        defaults[f.id] = homeownerName;
      }
    }
    setTextValues(defaults);
  }, [isTemplateMode, templateFields, homeownerName]);

  // ---- Canvas drawing helpers ----
  const initCanvas = useCallback((canvas: HTMLCanvasElement) => {
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * 2;
    canvas.height = rect.height * 2;
    ctx.scale(2, 2);
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#1a1a2e";
  }, []);

  const getPos = (e: React.TouchEvent | React.MouseEvent, canvas: HTMLCanvasElement) => {
    const rect = canvas.getBoundingClientRect();
    if ("touches" in e) {
      return { x: e.touches[0].clientX - rect.left, y: e.touches[0].clientY - rect.top };
    }
    return { x: (e as React.MouseEvent).clientX - rect.left, y: (e as React.MouseEvent).clientY - rect.top };
  };

  const startDraw = (e: React.TouchEvent | React.MouseEvent, fieldId: string, canvas: HTMLCanvasElement) => {
    e.preventDefault();
    drawingRefs.current.set(fieldId, true);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const pos = getPos(e, canvas);
    ctx.beginPath();
    ctx.moveTo(pos.x, pos.y);
  };

  const draw = (e: React.TouchEvent | React.MouseEvent, fieldId: string, canvas: HTMLCanvasElement) => {
    if (!drawingRefs.current.get(fieldId)) return;
    e.preventDefault();
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const pos = getPos(e, canvas);
    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();
    setDrawnFields((prev) => new Set(prev).add(fieldId));
  };

  const stopDraw = (fieldId: string) => {
    drawingRefs.current.set(fieldId, false);
  };

  const clearCanvas = (fieldId: string) => {
    const canvas = canvasRefs.current.get(fieldId);
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setDrawnFields((prev) => {
      const next = new Set(prev);
      next.delete(fieldId);
      return next;
    });
  };

  // ---- Legacy canvas setup ----
  useEffect(() => {
    if (isTemplateMode) return;
    const canvas = legacyCanvasRef.current;
    if (!canvas) return;
    initCanvas(canvas);
  }, [isTemplateMode, initCanvas]);

  const legacyStartDraw = (e: React.TouchEvent | React.MouseEvent) => {
    e.preventDefault();
    legacyDrawingRef.current = true;
    const canvas = legacyCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const pos = getPos(e, canvas);
    ctx.beginPath();
    ctx.moveTo(pos.x, pos.y);
  };

  const legacyDraw = (e: React.TouchEvent | React.MouseEvent) => {
    if (!legacyDrawingRef.current) return;
    e.preventDefault();
    const canvas = legacyCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const pos = getPos(e, canvas);
    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();
    setLegacyHasDrawn(true);
  };

  const legacyStopDraw = () => { legacyDrawingRef.current = false; };

  const legacyClearCanvas = () => {
    const canvas = legacyCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setLegacyHasDrawn(false);
  };

  // ---- Validation ----
  const isTemplateValid = () => {
    if (!templateFields) return false;
    for (const f of templateFields) {
      if (!f.required) continue;
      if (f.type === "signature" || f.type === "initials") {
        if (!drawnFields.has(f.id)) return false;
      }
      if (f.type === "text") {
        if (!textValues[f.id]?.trim()) return false;
      }
      if (f.type === "date") {
        if (!textValues[f.id]?.trim()) return false;
      }
    }
    return true;
  };

  // ---- Submit ----
  const submit = async () => {
    setSubmitting(true);
    setError(null);

    try {
      let reqBody: Record<string, unknown>;

      if (isTemplateMode) {
        // Collect all signature/initials images
        const signatureImages: Record<string, string> = {};
        for (const f of templateFields) {
          if ((f.type === "signature" || f.type === "initials") && drawnFields.has(f.id)) {
            const canvas = canvasRefs.current.get(f.id);
            if (canvas) {
              signatureImages[f.id] = canvas.toDataURL("image/png");
            }
          }
        }

        reqBody = {
          signer_fields: textValues,
          signature_images: signatureImages,
        };
      } else {
        // Legacy mode
        const canvas = legacyCanvasRef.current;
        if (!canvas) return;
        reqBody = {
          signer_name: legacySignerName,
          signature_image: canvas.toDataURL("image/png"),
        };
      }

      const res = await fetch(`/api/sign/${signatureId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(reqBody),
      });

      const data = await res.json();
      if (res.ok && data.ok) {
        setDone(true);
        setDownloadUrl(data.signed_pdf_url);
      } else {
        setError(data.error || "Failed to submit signature");
      }
    } catch {
      setError("Network error. Please try again.");
    }
    setSubmitting(false);
  };

  // ---- Success screen ----
  if (done) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white rounded-2xl shadow-lg p-8 text-center">
          <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h1 className="text-xl font-bold text-gray-900 mb-2">Document Signed</h1>
          <p className="text-gray-600 text-sm mb-6">
            Your {DOC_TYPE_LABELS[documentType] || "document"} has been signed and submitted successfully.
          </p>
          {downloadUrl && (
            <a
              href={downloadUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-blue-600 text-white text-sm font-semibold rounded-xl hover:bg-blue-700 transition-colors"
            >
              Download Signed Copy
            </a>
          )}
          <p className="text-xs text-gray-400 mt-6">
            A copy has been sent to {companyName}. You may close this page.
          </p>
        </div>
      </div>
    );
  }

  // ---- Helper: group template fields by page ----
  const fieldsByPage = new Map<number, TemplateField[]>();
  if (isTemplateMode) {
    for (const f of templateFields) {
      const arr = fieldsByPage.get(f.page) || [];
      arr.push(f);
      fieldsByPage.set(f.page, arr);
    }
  }

  const canSubmitTemplate = isTemplateMode && agreed && isTemplateValid();
  const canSubmitLegacy = !isTemplateMode && legacyHasDrawn && legacySignerName && agreed;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-4 py-4 sm:px-6">
        <div className="max-w-2xl mx-auto">
          <p className="text-xs font-semibold uppercase tracking-wider text-blue-600 mb-1">
            {DOC_TYPE_LABELS[documentType] || "Document Signing"}
          </p>
          <h1 className="text-lg sm:text-xl font-bold text-gray-900">
            Document Signing Request
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            From <span className="font-semibold text-gray-700">{companyName}</span>
            {claimAddress && <> for property at <span className="font-semibold text-gray-700">{claimAddress}</span></>}
          </p>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-6">
        {/* PDF preview */}
        {pdfUrl && (
          <div className="mb-6">
            <p className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-2">Document to Sign</p>
            <div className="rounded-xl border border-gray-200 overflow-hidden bg-white">
              <iframe
                src={pdfUrl}
                className="w-full h-[500px] sm:h-[650px]"
                title="Document preview"
              />
            </div>
          </div>
        )}

        {/* ---- TEMPLATE MODE: Multi-field signing ---- */}
        {isTemplateMode ? (
          <div className="space-y-6">
            {Array.from(fieldsByPage.entries())
              .sort(([a], [b]) => a - b)
              .map(([pageNum, fields]) => (
                <div key={pageNum} className="bg-white rounded-2xl border border-gray-200 p-4 sm:p-6">
                  <p className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-4">
                    Page {pageNum + 1} — Your Signature & Information
                  </p>

                  <div className="space-y-5">
                    {fields.map((field) => {
                      if (field.type === "signature") {
                        return (
                          <div key={field.id}>
                            <label className="text-xs font-semibold text-gray-600 block mb-1">
                              {field.label} {field.required && <span className="text-red-500">*</span>}
                            </label>
                            <div className="relative">
                              <canvas
                                ref={(el) => {
                                  if (el) {
                                    canvasRefs.current.set(field.id, el);
                                    if (!el.dataset.init) {
                                      el.dataset.init = "1";
                                      initCanvas(el);
                                    }
                                  }
                                }}
                                onMouseDown={(e) => {
                                  const c = canvasRefs.current.get(field.id);
                                  if (c) startDraw(e, field.id, c);
                                }}
                                onMouseMove={(e) => {
                                  const c = canvasRefs.current.get(field.id);
                                  if (c) draw(e, field.id, c);
                                }}
                                onMouseUp={() => stopDraw(field.id)}
                                onMouseLeave={() => stopDraw(field.id)}
                                onTouchStart={(e) => {
                                  const c = canvasRefs.current.get(field.id);
                                  if (c) startDraw(e, field.id, c);
                                }}
                                onTouchMove={(e) => {
                                  const c = canvasRefs.current.get(field.id);
                                  if (c) draw(e, field.id, c);
                                }}
                                onTouchEnd={() => stopDraw(field.id)}
                                className="w-full h-32 sm:h-36 border-2 border-dashed border-gray-300 rounded-xl bg-white cursor-crosshair touch-none"
                              />
                              {!drawnFields.has(field.id) && (
                                <p className="absolute inset-0 flex items-center justify-center text-gray-400 text-sm pointer-events-none">
                                  Sign here
                                </p>
                              )}
                            </div>
                            <button
                              onClick={() => clearCanvas(field.id)}
                              className="mt-1 text-xs text-gray-500 hover:text-gray-700"
                            >
                              Clear
                            </button>
                          </div>
                        );
                      }

                      if (field.type === "initials") {
                        return (
                          <div key={field.id}>
                            <label className="text-xs font-semibold text-gray-600 block mb-1">
                              {field.label} {field.required && <span className="text-red-500">*</span>}
                            </label>
                            <div className="relative">
                              <canvas
                                ref={(el) => {
                                  if (el) {
                                    canvasRefs.current.set(field.id, el);
                                    if (!el.dataset.init) {
                                      el.dataset.init = "1";
                                      initCanvas(el);
                                    }
                                  }
                                }}
                                onMouseDown={(e) => {
                                  const c = canvasRefs.current.get(field.id);
                                  if (c) startDraw(e, field.id, c);
                                }}
                                onMouseMove={(e) => {
                                  const c = canvasRefs.current.get(field.id);
                                  if (c) draw(e, field.id, c);
                                }}
                                onMouseUp={() => stopDraw(field.id)}
                                onMouseLeave={() => stopDraw(field.id)}
                                onTouchStart={(e) => {
                                  const c = canvasRefs.current.get(field.id);
                                  if (c) startDraw(e, field.id, c);
                                }}
                                onTouchMove={(e) => {
                                  const c = canvasRefs.current.get(field.id);
                                  if (c) draw(e, field.id, c);
                                }}
                                onTouchEnd={() => stopDraw(field.id)}
                                className="w-32 h-16 border-2 border-dashed border-gray-300 rounded-lg bg-white cursor-crosshair touch-none"
                              />
                              {!drawnFields.has(field.id) && (
                                <p className="absolute inset-0 flex items-center justify-center text-gray-400 text-[10px] pointer-events-none">
                                  Initials
                                </p>
                              )}
                            </div>
                            <button
                              onClick={() => clearCanvas(field.id)}
                              className="mt-1 text-xs text-gray-500 hover:text-gray-700"
                            >
                              Clear
                            </button>
                          </div>
                        );
                      }

                      if (field.type === "text") {
                        return (
                          <div key={field.id}>
                            <label className="text-xs font-semibold text-gray-600 block mb-1">
                              {field.label} {field.required && <span className="text-red-500">*</span>}
                            </label>
                            <input
                              value={textValues[field.id] || ""}
                              onChange={(e) => setTextValues((prev) => ({ ...prev, [field.id]: e.target.value }))}
                              placeholder={`Enter ${field.label.toLowerCase()}`}
                              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                            />
                          </div>
                        );
                      }

                      if (field.type === "date") {
                        return (
                          <div key={field.id}>
                            <label className="text-xs font-semibold text-gray-600 block mb-1">
                              {field.label} {field.required && <span className="text-red-500">*</span>}
                            </label>
                            <input
                              type="text"
                              value={textValues[field.id] || ""}
                              onChange={(e) => setTextValues((prev) => ({ ...prev, [field.id]: e.target.value }))}
                              className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm text-gray-700 bg-gray-50"
                            />
                          </div>
                        );
                      }

                      return null;
                    })}
                  </div>
                </div>
              ))}

            {/* Agreement checkbox */}
            <div className="bg-white rounded-2xl border border-gray-200 p-4 sm:p-6">
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={agreed}
                  onChange={(e) => setAgreed(e.target.checked)}
                  className="mt-1 w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                <span className="text-xs text-gray-600 leading-relaxed">
                  I acknowledge that I have read and understand this {DOC_TYPE_LABELS[documentType]?.toLowerCase() || "document"} and
                  agree to its terms. This electronic signature has the same legal effect as a handwritten signature.
                </span>
              </label>

              {error && (
                <div className="mt-4 p-3 rounded-lg bg-red-50 border border-red-200">
                  <p className="text-sm text-red-600">{error}</p>
                </div>
              )}

              <button
                onClick={submit}
                disabled={!canSubmitTemplate || submitting}
                className="mt-4 w-full py-3 rounded-xl bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {submitting ? "Submitting Signatures..." : "Sign Document"}
              </button>
            </div>
          </div>
        ) : (
          /* ---- LEGACY MODE: Single signature ---- */
          <div className="bg-white rounded-2xl border border-gray-200 p-4 sm:p-6 mb-6">
            <p className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-4">Your Signature</p>

            <div className="relative mb-4">
              <canvas
                ref={legacyCanvasRef}
                onMouseDown={legacyStartDraw}
                onMouseMove={legacyDraw}
                onMouseUp={legacyStopDraw}
                onMouseLeave={legacyStopDraw}
                onTouchStart={legacyStartDraw}
                onTouchMove={legacyDraw}
                onTouchEnd={legacyStopDraw}
                className="w-full h-32 sm:h-40 border-2 border-dashed border-gray-300 rounded-xl bg-white cursor-crosshair touch-none"
              />
              {!legacyHasDrawn && (
                <p className="absolute inset-0 flex items-center justify-center text-gray-400 text-sm pointer-events-none">
                  Sign here with your finger or mouse
                </p>
              )}
            </div>

            <div className="flex items-center justify-between mb-4">
              <button onClick={legacyClearCanvas} className="text-xs text-gray-500 hover:text-gray-700 transition-colors">
                Clear Signature
              </button>
            </div>

            <div className="mb-4">
              <label className="text-xs font-semibold text-gray-600 block mb-1">Full Legal Name</label>
              <input
                value={legacySignerName}
                onChange={(e) => setLegacySignerName(e.target.value)}
                placeholder="Enter your full name"
                className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>

            <div className="mb-4">
              <label className="text-xs font-semibold text-gray-600 block mb-1">Date</label>
              <input
                type="text"
                readOnly
                value={new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
                className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm text-gray-500 bg-gray-50"
              />
            </div>

            <label className="flex items-start gap-3 mb-6 cursor-pointer">
              <input
                type="checkbox"
                checked={agreed}
                onChange={(e) => setAgreed(e.target.checked)}
                className="mt-1 w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <span className="text-xs text-gray-600 leading-relaxed">
                I, <span className="font-semibold">{legacySignerName || "[your name]"}</span>, acknowledge that I have read
                and understand this {DOC_TYPE_LABELS[documentType]?.toLowerCase() || "document"} and agree to its terms.
                This electronic signature has the same legal effect as a handwritten signature.
              </span>
            </label>

            {error && (
              <div className="mb-4 p-3 rounded-lg bg-red-50 border border-red-200">
                <p className="text-sm text-red-600">{error}</p>
              </div>
            )}

            <button
              onClick={submit}
              disabled={!canSubmitLegacy || submitting}
              className="w-full py-3 rounded-xl bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {submitting ? "Submitting Signature..." : "Sign Document"}
            </button>
          </div>
        )}

        <p className="text-center text-[10px] text-gray-400">
          Powered by dumbroof.ai &middot; Your IP address is recorded for verification purposes
        </p>
      </div>
    </div>
  );
}
