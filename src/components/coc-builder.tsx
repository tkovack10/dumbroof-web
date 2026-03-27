"use client";

import { useState, useEffect, useCallback } from "react";
import { FileUploadZone } from "@/components/file-upload-zone";
import { directUpload } from "@/lib/upload-utils";
import { CrmImportModal } from "@/components/crm-import-modal";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8000";

interface Props {
  claimId: string;
  claimAddress: string;
  carrierName: string;
  userId: string;
  filePath: string;
  claimNumber?: string;
  adjusterEmail?: string;
}

interface CocRecord {
  id: string;
  completion_date: string;
  work_summary: string | null;
  warranty_terms: string | null;
  pdf_path: string | null;
  sent_to_carrier: boolean;
  sent_to_homeowner: boolean;
  sent_at: string | null;
}

export function CocBuilder({ claimId, claimAddress, carrierName, userId, filePath, claimNumber, adjusterEmail }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [existing, setExisting] = useState<CocRecord | null>(null);
  const [completionDate, setCompletionDate] = useState(new Date().toISOString().split("T")[0]);
  const [workSummary, setWorkSummary] = useState("");
  const [warrantyTerms, setWarrantyTerms] = useState("10-year manufacturer warranty. 5-year workmanship.");
  const [generating, setGenerating] = useState(false);
  const [pdfPath, setPdfPath] = useState<string | null>(null);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [sending, setSending] = useState<string | null>(null); // "carrier" | "homeowner" | null
  const [sendEmail, setSendEmail] = useState(adjusterEmail || "");
  const [sendCc, setSendCc] = useState("");
  const [sent, setSent] = useState<{ carrier: boolean; homeowner: boolean }>({ carrier: false, homeowner: false });
  const [completionPhotos, setCompletionPhotos] = useState<File[]>([]);
  const [completionPhotoPaths, setCompletionPhotoPaths] = useState<string[]>([]);
  const [uploadingPhotos, setUploadingPhotos] = useState(false);
  const [cocMode, setCocMode] = useState<"generate" | "upload">("generate");
  const [ownCocFile, setOwnCocFile] = useState<File[]>([]);
  const [uploadingCoc, setUploadingCoc] = useState(false);
  const [showCrmModal, setShowCrmModal] = useState(false);
  const [crmIntegrations, setCrmIntegrations] = useState<{ acculynx: boolean; companycam: boolean }>({ acculynx: false, companycam: false });
  const [claimNum, setClaimNum] = useState(claimNumber || "");

  const uploadFile = async (file: File, folder: string): Promise<string> => {
    const res = await fetch("/api/storage/sign-upload", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ folder, fileName: file.name, claimPath: filePath }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed to get signed upload URL");
    await directUpload(data.signedUrl, file);
    return data.path;
  };

  const uploadCompletionPhotos = async () => {
    if (completionPhotos.length === 0) return;
    setUploadingPhotos(true);
    try {
      const paths: string[] = [];
      for (const file of completionPhotos) {
        const path = await uploadFile(file, "completion-photos");
        paths.push(path);
      }
      setCompletionPhotoPaths((prev) => [...prev, ...paths]);
      setCompletionPhotos([]);
    } catch {
      /* ignore */
    }
    setUploadingPhotos(false);
  };

  const uploadOwnCoc = async () => {
    if (ownCocFile.length === 0) return;
    setUploadingCoc(true);
    try {
      const path = await uploadFile(ownCocFile[0], "coc");
      setPdfPath(path);
      setOwnCocFile([]);
    } catch {
      /* ignore */
    }
    setUploadingCoc(false);
  };

  const fetchExisting = useCallback(async () => {
    try {
      const res = await fetch(`/api/coc?claim_id=${claimId}`);
      if (res.ok) {
        const data = await res.json();
        if (data.coc) {
          setExisting(data.coc);
          setCompletionDate(data.coc.completion_date || completionDate);
          setWorkSummary(data.coc.work_summary || "");
          setWarrantyTerms(data.coc.warranty_terms || warrantyTerms);
          setPdfPath(data.coc.pdf_path);
          setSent({
            carrier: data.coc.sent_to_carrier || false,
            homeowner: data.coc.sent_to_homeowner || false,
          });
        }
      }
    } catch { /* ignore */ }
    setLoading(false);
  }, [claimId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { fetchExisting(); }, [fetchExisting]);

  useEffect(() => {
    fetch(`${BACKEND_URL}/api/integrations/status?user_id=${userId}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data) setCrmIntegrations({ acculynx: !!data.acculynx, companycam: !!data.companycam }); })
      .catch(() => {});
  }, [userId]);

  const generatePdf = async () => {
    setGenerating(true);
    try {
      const res = await fetch("/api/coc", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          claim_id: claimId,
          completion_date: completionDate,
          work_summary: workSummary || null,
          warranty_terms: warrantyTerms,
          completion_photo_paths: completionPhotoPaths.length > 0 ? completionPhotoPaths : undefined,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        setPdfPath(data.pdf_path);
        setDownloadUrl(data.download_url);
        await fetchExisting();
      }
    } catch { /* ignore */ }
    setGenerating(false);
  };

  const sendCoc = async (recipientType: "carrier" | "homeowner") => {
    if (!sendEmail || !pdfPath) return;
    setSending(recipientType);
    try {
      const res = await fetch("/api/coc", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          claim_id: claimId,
          pdf_path: pdfPath,
          to_email: sendEmail,
          cc: sendCc || null,
          recipient_type: recipientType,
          completion_photo_paths: completionPhotoPaths.length > 0 ? completionPhotoPaths : undefined,
        }),
      });

      if (res.ok) {
        setSent((prev) => ({ ...prev, [recipientType]: true }));
        setSendEmail("");
        setSendCc("");
        await fetchExisting();
      }
    } catch { /* ignore */ }
    setSending(null);
  };

  if (loading) return (
    <div className="glass-card p-6 animate-pulse">
      <div className="h-5 w-48 bg-white/5 rounded" />
    </div>
  );

  return (
    <div className="glass-card overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between p-6 hover:bg-white/[0.02] transition-colors"
      >
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-purple-500/10 flex items-center justify-center">
            <svg className="w-5 h-5 text-purple-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12c0 1.268-.63 2.39-1.593 3.068a3.745 3.745 0 01-1.043 3.296 3.745 3.745 0 01-3.296 1.043A3.745 3.745 0 0112 21c-1.268 0-2.39-.63-3.068-1.593a3.746 3.746 0 01-3.296-1.043 3.745 3.745 0 01-1.043-3.296A3.745 3.745 0 013 12c0-1.268.63-2.39 1.593-3.068a3.745 3.745 0 011.043-3.296 3.746 3.746 0 013.296-1.043A3.746 3.746 0 0112 3c1.268 0 2.39.63 3.068 1.593a3.746 3.746 0 013.296 1.043 3.746 3.746 0 011.043 3.296A3.745 3.745 0 0121 12z" />
            </svg>
          </div>
          <div className="text-left">
            <h3 className="text-lg font-bold text-[var(--white)]">Certificate of Completion</h3>
            <p className="text-xs text-[var(--gray-muted)]">
              Generate and send a professional COC to carrier and homeowner
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {pdfPath && (
            <span className="text-xs px-2.5 py-1 rounded-full bg-purple-500/10 text-purple-400 font-semibold">
              PDF Ready
            </span>
          )}
          {(sent.carrier || sent.homeowner) && (
            <span className="text-xs px-2.5 py-1 rounded-full bg-green-500/10 text-green-400 font-semibold">
              {sent.carrier && sent.homeowner ? "Sent to Both" : sent.carrier ? "Sent to Carrier" : "Sent to Homeowner"}
            </span>
          )}
          <svg className={`w-5 h-5 text-[var(--gray-muted)] transition-transform ${expanded ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </button>

      {expanded && (
        <div className="px-4 sm:px-6 pb-6 border-t border-white/[0.06]">
          {/* Mode toggle */}
          <div className="flex gap-2 mt-4 mb-4">
            <button
              onClick={() => setCocMode("generate")}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                cocMode === "generate" ? "bg-purple-500/10 text-purple-400" : "bg-white/5 text-[var(--gray-muted)]"
              }`}
            >
              Generate COC
            </button>
            <button
              onClick={() => setCocMode("upload")}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                cocMode === "upload" ? "bg-purple-500/10 text-purple-400" : "bg-white/5 text-[var(--gray-muted)]"
              }`}
            >
              Upload Your Own COC
            </button>
          </div>

          {cocMode === "upload" ? (
            /* Upload own COC */
            <div className="space-y-4">
              <FileUploadZone
                label="Certificate of Completion PDF"
                description="Upload your own COC document"
                accept=".pdf"
                files={ownCocFile}
                onFilesChange={setOwnCocFile}
              />
              {ownCocFile.length > 0 && !pdfPath && (
                <button
                  onClick={uploadOwnCoc}
                  disabled={uploadingCoc}
                  className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-purple-500 to-purple-600 text-white text-sm font-semibold hover:shadow-lg hover:shadow-purple-500/20 transition-all disabled:opacity-50"
                >
                  {uploadingCoc ? "Uploading..." : "Upload COC"}
                </button>
              )}
              {pdfPath && cocMode === "upload" && (
                <p className="text-xs text-green-400 flex items-center gap-1">
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                  COC uploaded — ready to send below
                </p>
              )}
            </div>
          ) : (
            /* Generate COC form */
            <div className="space-y-4">
              {/* Completion date */}
              <div>
                <label className="text-xs font-semibold uppercase tracking-wider text-[var(--gray-muted)] block mb-1.5">
                  Completion Date
                </label>
                <input
                  type="date"
                  value={completionDate}
                  onChange={(e) => setCompletionDate(e.target.value)}
                  className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-[var(--white)] w-full sm:w-48"
                />
              </div>

              {/* Work summary */}
              <div>
                <label className="text-xs font-semibold uppercase tracking-wider text-[var(--gray-muted)] block mb-1.5">
                  Work Summary
                </label>
                <textarea
                  rows={4}
                  value={workSummary}
                  onChange={(e) => setWorkSummary(e.target.value)}
                  placeholder="Describe the work completed (auto-populated from approved scope if left blank)..."
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-[var(--white)] placeholder:text-[var(--gray-dim)] resize-none"
                />
              </div>

              {/* Warranty terms */}
              <div>
                <label className="text-xs font-semibold uppercase tracking-wider text-[var(--gray-muted)] block mb-1.5">
                  Warranty Terms
                </label>
                <input
                  value={warrantyTerms}
                  onChange={(e) => setWarrantyTerms(e.target.value)}
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-[var(--white)]"
                />
              </div>

              {/* Completion photos */}
              <div className="space-y-2">
                <FileUploadZone
                  label="Completion Photos"
                  description="Attach photos showing the completed work"
                  accept="image/*,.heic,.heif"
                  multiple
                  files={completionPhotos}
                  onFilesChange={setCompletionPhotos}
                />
                {completionPhotos.length > 0 && (
                  <button
                    onClick={uploadCompletionPhotos}
                    disabled={uploadingPhotos}
                    className="px-3 py-1.5 rounded-lg bg-purple-500/10 text-purple-400 text-xs font-semibold hover:bg-purple-500/20 transition-colors disabled:opacity-50"
                  >
                    {uploadingPhotos
                      ? `Uploading ${completionPhotos.length} photo${completionPhotos.length !== 1 ? "s" : ""}...`
                      : `Upload ${completionPhotos.length} Photo${completionPhotos.length !== 1 ? "s" : ""}`}
                  </button>
                )}
                {(crmIntegrations.acculynx || crmIntegrations.companycam) && (
                  <button
                    onClick={() => setShowCrmModal(true)}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--cyan)]/10 text-[var(--cyan)] text-sm font-semibold hover:bg-[var(--cyan)]/20 transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
                    </svg>
                    Import from CRM
                  </button>
                )}
                {completionPhotoPaths.length > 0 && (
                  <p className="text-[10px] text-green-400 flex items-center gap-1">
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                    {completionPhotoPaths.length} completion photo{completionPhotoPaths.length !== 1 ? "s" : ""} ready
                  </p>
                )}
              </div>

              {/* Generate button */}
              <button
                onClick={generatePdf}
                disabled={generating}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-purple-500 to-purple-600 text-white text-sm font-semibold hover:shadow-lg hover:shadow-purple-500/20 transition-all disabled:opacity-50"
              >
                {generating ? (
                  <>
                    <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    Generating PDF...
                  </>
                ) : pdfPath ? (
                  "Regenerate PDF"
                ) : (
                  "Generate Certificate of Completion"
                )}
              </button>
            </div>
          )}

          {/* PDF preview / download */}
          {pdfPath && (
            <div className="mt-4 rounded-xl bg-purple-500/[0.06] border border-purple-500/20 p-4">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <svg className="w-5 h-5 text-purple-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                  </svg>
                  <p className="text-sm font-semibold text-[var(--white)]">Certificate of Completion — {claimAddress}</p>
                </div>
                {downloadUrl && (
                  <a
                    href={downloadUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-purple-400 hover:text-purple-300 font-semibold"
                  >
                    Download PDF
                  </a>
                )}
              </div>

              {/* Send section */}
              <div className="space-y-3">
                <p className="text-xs font-semibold uppercase tracking-wider text-[var(--gray-muted)]">Send Certificate</p>

                <div>
                  <label className="text-[10px] font-semibold uppercase tracking-wider text-[var(--gray-muted)] block mb-1">
                    Claim Number
                  </label>
                  <input
                    placeholder="Auto-populated from claim"
                    value={claimNum}
                    onChange={(e) => setClaimNum(e.target.value)}
                    className="w-full sm:w-48 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-[var(--white)] placeholder:text-[var(--gray-dim)]"
                  />
                </div>

                <div className="grid sm:grid-cols-2 gap-3">
                  <input
                    placeholder="Recipient email address"
                    value={sendEmail}
                    onChange={(e) => setSendEmail(e.target.value)}
                    className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-[var(--white)] placeholder:text-[var(--gray-dim)]"
                  />
                  <input
                    placeholder="CC (optional)"
                    value={sendCc}
                    onChange={(e) => setSendCc(e.target.value)}
                    className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-[var(--white)] placeholder:text-[var(--gray-dim)]"
                  />
                </div>

                <div className="flex flex-col sm:flex-row gap-3">
                  <button
                    onClick={() => sendCoc("carrier")}
                    disabled={!sendEmail || sending === "carrier"}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg bg-purple-500/10 text-purple-400 text-sm font-semibold hover:bg-purple-500/20 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    {sending === "carrier" ? "Sending..." : sent.carrier ? "Resend to Carrier" : "Send to Carrier"}
                  </button>
                  <button
                    onClick={() => sendCoc("homeowner")}
                    disabled={!sendEmail || sending === "homeowner"}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg bg-white/5 text-[var(--gray)] text-sm font-semibold hover:bg-white/10 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    {sending === "homeowner" ? "Sending..." : sent.homeowner ? "Resend to Homeowner" : "Send to Homeowner"}
                  </button>
                </div>

                {(sent.carrier || sent.homeowner) && existing?.sent_at && (
                  <p className="text-[10px] text-[var(--gray-dim)]">
                    Last sent: {new Date(existing.sent_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })}
                  </p>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      <CrmImportModal
        open={showCrmModal}
        onClose={() => setShowCrmModal(false)}
        integrations={crmIntegrations}
        backendUrl={BACKEND_URL}
        userId={userId}
        targetPath={filePath}
        targetFolder="completion-photos"
        onImport={() => {}}
        onPhotoPaths={(paths) => {
          setCompletionPhotoPaths((prev) => [...prev, ...paths]);
        }}
      />
    </div>
  );
}
