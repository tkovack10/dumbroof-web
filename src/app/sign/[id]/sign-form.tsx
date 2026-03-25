"use client";

import { useState, useRef, useEffect, useCallback } from "react";

interface Props {
  signatureId: string;
  documentType: string;
  homeownerName: string;
  companyName: string;
  claimAddress: string;
  pdfUrl: string | null;
}

const DOC_TYPE_LABELS: Record<string, string> = {
  aob: "Assignment of Benefits",
  contingency: "Contingency Agreement",
  repair_approval: "Repair Work Approval",
};

export function SignForm({ signatureId, documentType, homeownerName, companyName, claimAddress, pdfUrl }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [signerName, setSignerName] = useState(homeownerName || "");
  const [agreed, setAgreed] = useState(false);
  const [hasDrawn, setHasDrawn] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const isDrawingRef = useRef(false);

  const initCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Set canvas size for crisp drawing
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * 2;
    canvas.height = rect.height * 2;
    ctx.scale(2, 2);
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#1a1a2e";
  }, []);

  useEffect(() => { initCanvas(); }, [initCanvas]);

  const getPos = (e: React.TouchEvent | React.MouseEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    if ("touches" in e) {
      return { x: e.touches[0].clientX - rect.left, y: e.touches[0].clientY - rect.top };
    }
    return { x: (e as React.MouseEvent).clientX - rect.left, y: (e as React.MouseEvent).clientY - rect.top };
  };

  const startDraw = (e: React.TouchEvent | React.MouseEvent) => {
    e.preventDefault();
    isDrawingRef.current = true;
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    const pos = getPos(e);
    ctx.beginPath();
    ctx.moveTo(pos.x, pos.y);
  };

  const draw = (e: React.TouchEvent | React.MouseEvent) => {
    if (!isDrawingRef.current) return;
    e.preventDefault();
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    const pos = getPos(e);
    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();
    setHasDrawn(true);
  };

  const stopDraw = () => {
    isDrawingRef.current = false;
  };

  const clearCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setHasDrawn(false);
  };

  const submit = async () => {
    if (!hasDrawn || !signerName || !agreed) return;
    setSubmitting(true);
    setError(null);

    const canvas = canvasRef.current;
    if (!canvas) return;
    const signatureImage = canvas.toDataURL("image/png");

    try {
      const res = await fetch(`/api/sign/${signatureId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ signer_name: signerName, signature_image: signatureImage }),
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
            From <span className="font-semibold text-gray-700">{companyName}</span> for property at <span className="font-semibold text-gray-700">{claimAddress}</span>
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
                className="w-full h-[400px] sm:h-[500px]"
                title="Document preview"
              />
            </div>
          </div>
        )}

        {/* Signature section */}
        <div className="bg-white rounded-2xl border border-gray-200 p-4 sm:p-6 mb-6">
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-4">Your Signature</p>

          {/* Canvas */}
          <div className="relative mb-4">
            <canvas
              ref={canvasRef}
              onMouseDown={startDraw}
              onMouseMove={draw}
              onMouseUp={stopDraw}
              onMouseLeave={stopDraw}
              onTouchStart={startDraw}
              onTouchMove={draw}
              onTouchEnd={stopDraw}
              className="w-full h-32 sm:h-40 border-2 border-dashed border-gray-300 rounded-xl bg-white cursor-crosshair touch-none"
            />
            {!hasDrawn && (
              <p className="absolute inset-0 flex items-center justify-center text-gray-400 text-sm pointer-events-none">
                Sign here with your finger or mouse
              </p>
            )}
          </div>

          <div className="flex items-center justify-between mb-4">
            <button
              onClick={clearCanvas}
              className="text-xs text-gray-500 hover:text-gray-700 transition-colors"
            >
              Clear Signature
            </button>
          </div>

          {/* Full name */}
          <div className="mb-4">
            <label className="text-xs font-semibold text-gray-600 block mb-1">Full Legal Name</label>
            <input
              value={signerName}
              onChange={(e) => setSignerName(e.target.value)}
              placeholder="Enter your full name"
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>

          {/* Date (auto) */}
          <div className="mb-4">
            <label className="text-xs font-semibold text-gray-600 block mb-1">Date</label>
            <input
              type="text"
              readOnly
              value={new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
              className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm text-gray-500 bg-gray-50"
            />
          </div>

          {/* Agreement checkbox */}
          <label className="flex items-start gap-3 mb-6 cursor-pointer">
            <input
              type="checkbox"
              checked={agreed}
              onChange={(e) => setAgreed(e.target.checked)}
              className="mt-1 w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            <span className="text-xs text-gray-600 leading-relaxed">
              I, <span className="font-semibold">{signerName || "[your name]"}</span>, acknowledge that I have read
              and understand this {DOC_TYPE_LABELS[documentType]?.toLowerCase() || "document"} and agree to its terms.
              This electronic signature has the same legal effect as a handwritten signature.
            </span>
          </label>

          {error && (
            <div className="mb-4 p-3 rounded-lg bg-red-50 border border-red-200">
              <p className="text-sm text-red-600">{error}</p>
            </div>
          )}

          {/* Submit */}
          <button
            onClick={submit}
            disabled={!hasDrawn || !signerName || !agreed || submitting}
            className="w-full py-3 rounded-xl bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {submitting ? "Submitting Signature..." : "Sign Document"}
          </button>
        </div>

        <p className="text-center text-[10px] text-gray-400">
          Powered by dumbroof.ai &middot; Your IP address is recorded for verification purposes
        </p>
      </div>
    </div>
  );
}
