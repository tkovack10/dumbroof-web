"use client";

import { Fragment, useEffect, useState, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import type { ScopeComparisonRow, CodeCitation } from "@/types/scope-comparison";

interface LineItem {
  id: string;
  category: string;
  description: string;
  qty: number;
  unit: string;
  unit_price: number;
  xactimate_code: string;
  trade: string;
  source: string;
}

interface Photo {
  annotation_key: string;
  annotation_text: string;
  damage_type: string;
  material: string;
  trade: string;
  severity: string;
  signed_url?: string;
  storage_path?: string;
}

interface Props {
  claimId: string;
}

type Tab = "estimate" | "damage" | "codes";

const SEVERITY_STYLES: Record<string, { bg: string; text: string; icon: string }> = {
  critical: { bg: "bg-red-100", text: "text-red-800", icon: "!!!" },
  severe: { bg: "bg-red-50", text: "text-red-700", icon: "!!" },
  moderate: { bg: "bg-amber-50", text: "text-amber-700", icon: "!" },
  minor: { bg: "bg-yellow-50", text: "text-yellow-700", icon: "~" },
};

const SECTION_ORDER: Record<string, number> = {
  "ROOFING": 0, "SIDING": 1, "GUTTERS": 2, "INTERIOR": 3, "GENERAL": 4,
};

export function EstimateView({ claimId }: Props) {
  const [items, setItems] = useState<LineItem[]>([]);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [comparisonRows, setComparisonRows] = useState<ScopeComparisonRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<Tab>("estimate");
  const [expanded, setExpanded] = useState(false);
  const [photoUrls, setPhotoUrls] = useState<Record<string, string>>({});

  const supabase = useMemo(() => createClient(), []);

  useEffect(() => {
    async function fetchData() {
      try {
        // Fetch line items
        const itemsRes = await fetch(`/api/scope-review?claim_id=${claimId}`);
        if (itemsRes.ok) {
          const data = await itemsRes.json();
          setItems(data.items || []);
        }

        // Fetch photos from Supabase
        const { data: photosData } = await supabase
          .from("photos")
          .select("annotation_key, annotation_text, damage_type, material, trade, severity, storage_path")
          .eq("claim_id", claimId);
        if (photosData) setPhotos(photosData);

        // Fetch comparison rows (for code citations)
        const compRes = await fetch(`/api/scope-comparison?claim_id=${claimId}`);
        if (compRes.ok) {
          const compData = await compRes.json();
          setComparisonRows(compData.comparison_rows || []);
        }
      } catch {
        // Non-fatal — component just won't show data
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, [claimId, supabase]);

  if (loading || items.length === 0) return null;

  // Group items by category
  const grouped = items
    .filter((i) => i.source === "usarm" || i.source === "user_added")
    .sort((a, b) => (SECTION_ORDER[a.category?.toUpperCase()] ?? 99) - (SECTION_ORDER[b.category?.toUpperCase()] ?? 99));

  const lineTotal = grouped.reduce((s, i) => s + i.qty * i.unit_price, 0);
  const trades = [...new Set(grouped.map((i) => (i.trade || "").toLowerCase()).filter(Boolean))];

  // Damage findings from photos
  const damagePhotos = photos.filter((p) => p.damage_type && p.damage_type !== "none" && p.damage_type !== "overview");

  // Code citations from comparison rows
  const codeCitations = comparisonRows
    .filter((r) => r.code_citation && r.code_citation.code_tag)
    .map((r) => ({ desc: r.checklist_desc || r.usarm_desc, citation: r.code_citation! }));

  // Dedupe citations by code_tag
  const uniqueCitations: { desc: string; citation: CodeCitation }[] = [];
  const seenTags = new Set<string>();
  for (const c of codeCitations) {
    if (!seenTags.has(c.citation.code_tag)) {
      seenTags.add(c.citation.code_tag);
      uniqueCitations.push(c);
    }
  }

  return (
    <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-6 py-4 hover:bg-gray-50 transition-colors"
      >
        <div className="flex items-center gap-3">
          <h2 className="text-sm font-semibold text-[var(--navy)]">Estimate &amp; Damage Assessment</h2>
          <span className="text-xs text-gray-400">{grouped.length} items, {trades.length} trades</span>
          {damagePhotos.length > 0 && (
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-100 text-red-700">
              {damagePhotos.length} damage findings
            </span>
          )}
          {uniqueCitations.length > 0 && (
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-100 text-blue-700">
              {uniqueCitations.length} code citations
            </span>
          )}
        </div>
        <svg className={`w-5 h-5 text-gray-400 transition-transform ${expanded ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {expanded && (
        <div>
          {/* Tabs */}
          <div className="flex border-b border-gray-200 px-6">
            {([
              ["estimate", `Line Items (${grouped.length})`],
              ["damage", `Damage Assessment (${damagePhotos.length})`],
              ["codes", `Code Compliance (${uniqueCitations.length})`],
            ] as [Tab, string][]).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setActiveTab(key)}
                className={`px-4 py-3 text-xs font-semibold border-b-2 transition-colors ${
                  activeTab === key ? "text-blue-600 border-blue-600" : "text-gray-500 border-transparent hover:text-gray-700"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {activeTab === "estimate" && (
            <LineItemsTable items={grouped} lineTotal={lineTotal} trades={trades} />
          )}
          {activeTab === "damage" && (
            <DamageAssessment photos={damagePhotos} claimId={claimId} supabase={supabase} photoUrls={photoUrls} setPhotoUrls={setPhotoUrls} />
          )}
          {activeTab === "codes" && (
            <CodeCompliance citations={uniqueCitations} />
          )}
        </div>
      )}
    </div>
  );
}

function LineItemsTable({ items, lineTotal, trades }: { items: LineItem[]; lineTotal: number; trades: string[] }) {
  let currentCategory = "";
  const tradeSubtotals: Record<string, number> = {};

  for (const item of items) {
    const cat = (item.category || "GENERAL").toUpperCase();
    tradeSubtotals[cat] = (tradeSubtotals[cat] || 0) + item.qty * item.unit_price;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="bg-gray-50">
            <th className="px-3 py-2 text-[10px] font-semibold text-gray-400 uppercase w-8">#</th>
            <th className="px-3 py-2 text-[10px] font-semibold text-gray-400 uppercase w-16">Action</th>
            <th className="px-3 py-2 text-[10px] font-semibold text-gray-400 uppercase">Description</th>
            <th className="px-3 py-2 text-[10px] font-semibold text-gray-400 uppercase w-20">Code</th>
            <th className="px-3 py-2 text-[10px] font-semibold text-gray-400 uppercase text-right w-16">Qty</th>
            <th className="px-3 py-2 text-[10px] font-semibold text-gray-400 uppercase w-10">Unit</th>
            <th className="px-3 py-2 text-[10px] font-semibold text-gray-400 uppercase text-right w-20">Price</th>
            <th className="px-3 py-2 text-[10px] font-semibold text-gray-400 uppercase text-right w-24">Total</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item, i) => {
            const cat = (item.category || "GENERAL").toUpperCase();
            const showHeader = cat !== currentCategory;
            if (showHeader) currentCategory = cat;

            const desc = item.description || "";
            const action = desc.startsWith("Remove") || desc.startsWith("R&R Remove") ? "Remove"
              : desc.startsWith("R&R") ? "R&R" : "Install";
            const total = item.qty * item.unit_price;

            return (
              <Fragment key={item.id}>
                {showHeader && (
                  <tr>
                    <td colSpan={8} className="px-3 py-2 bg-blue-50 font-bold text-blue-800 text-xs">
                      {cat}
                    </td>
                  </tr>
                )}
                <tr>
                  <td className="px-3 py-1.5 text-gray-400">{i + 1}</td>
                  <td className="px-3 py-1.5 font-semibold text-[var(--navy)] text-[10px]">{action}</td>
                  <td className="px-3 py-1.5 text-gray-700">{desc}</td>
                  <td className="px-3 py-1.5 font-mono text-gray-500 text-[10px]">{item.xactimate_code || ""}</td>
                  <td className="px-3 py-1.5 text-right font-mono">{item.qty.toLocaleString(undefined, { maximumFractionDigits: 2 })}</td>
                  <td className="px-3 py-1.5 text-gray-500">{item.unit}</td>
                  <td className="px-3 py-1.5 text-right font-mono">${item.unit_price.toFixed(2)}</td>
                  <td className="px-3 py-1.5 text-right font-mono font-medium">${total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                </tr>
              </Fragment>
            );
          })}
        </tbody>
        <tfoot>
          {Object.entries(tradeSubtotals).map(([cat, subtotal]) => (
            <tr key={cat} className="bg-amber-50 font-bold">
              <td colSpan={6}></td>
              <td className="px-3 py-2 text-xs">{cat} Subtotal</td>
              <td className="px-3 py-2 text-right font-mono text-xs">${subtotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
            </tr>
          ))}
          <tr className="bg-green-50 font-bold">
            <td colSpan={6}></td>
            <td className="px-3 py-2 text-xs">Line Item Total</td>
            <td className="px-3 py-2 text-right font-mono">${lineTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
          </tr>
          {trades.length >= 3 && (
            <tr className="bg-amber-50 font-bold">
              <td colSpan={6}></td>
              <td className="px-3 py-2 text-xs">O&amp;P (21%) — {trades.length} trades</td>
              <td className="px-3 py-2 text-right font-mono">${(lineTotal * 0.21).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
            </tr>
          )}
        </tfoot>
      </table>
    </div>
  );
}

function DamageAssessment({
  photos,
  claimId,
  supabase,
  photoUrls,
  setPhotoUrls,
}: {
  photos: Photo[];
  claimId: string;
  supabase: ReturnType<typeof createClient>;
  photoUrls: Record<string, string>;
  setPhotoUrls: (urls: Record<string, string>) => void;
}) {
  const [loadingPhotos, setLoadingPhotos] = useState(false);

  // Load photo URLs on first render
  useEffect(() => {
    if (Object.keys(photoUrls).length > 0 || photos.length === 0) return;
    setLoadingPhotos(true);

    async function loadUrls() {
      const urls: Record<string, string> = {};
      // Get claim file_path for storage
      const { data: claim } = await supabase
        .from("claims")
        .select("file_path")
        .eq("id", claimId)
        .single();

      if (!claim?.file_path) { setLoadingPhotos(false); return; }

      for (const photo of photos.slice(0, 20)) { // Limit to first 20
        const path = photo.storage_path || `${claim.file_path}/photos/${photo.annotation_key}.jpg`;
        const { data } = await supabase.storage
          .from("claim-documents")
          .createSignedUrl(path, 3600);
        if (data?.signedUrl) {
          urls[photo.annotation_key] = data.signedUrl;
        }
      }
      setPhotoUrls(urls);
      setLoadingPhotos(false);
    }
    loadUrls();
  }, [photos, claimId, supabase, photoUrls, setPhotoUrls]);

  if (photos.length === 0) {
    return <div className="p-8 text-center text-sm text-gray-400">No damage findings documented</div>;
  }

  // Group by severity
  const bySeverity: Record<string, Photo[]> = {};
  for (const p of photos) {
    const sev = p.severity || "moderate";
    if (!bySeverity[sev]) bySeverity[sev] = [];
    bySeverity[sev].push(p);
  }
  const severityOrder = ["critical", "severe", "moderate", "minor"];

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center gap-3 mb-2">
        <h3 className="text-sm font-semibold text-[var(--navy)]">Inspection Findings</h3>
        <span className="text-xs text-gray-400">{photos.length} damage items documented</span>
      </div>

      {severityOrder.map((sev) => {
        const items = bySeverity[sev];
        if (!items || items.length === 0) return null;
        const style = SEVERITY_STYLES[sev] || SEVERITY_STYLES.moderate;

        return (
          <div key={sev}>
            <p className={`text-[10px] uppercase font-bold tracking-wide mb-2 ${style.text}`}>
              {sev} ({items.length})
            </p>
            <div className="space-y-2">
              {items.map((photo, i) => (
                <div key={photo.annotation_key} className={`flex gap-4 ${style.bg} rounded-lg p-3`}>
                  {/* Photo thumbnail */}
                  <div className="w-20 h-20 rounded-lg overflow-hidden bg-gray-200 shrink-0">
                    {photoUrls[photo.annotation_key] ? (
                      <img
                        src={photoUrls[photo.annotation_key]}
                        alt={photo.annotation_text || photo.annotation_key}
                        className="w-full h-full object-cover"
                      />
                    ) : loadingPhotos ? (
                      <div className="w-full h-full flex items-center justify-center text-gray-400 text-[10px]">Loading...</div>
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-gray-400 text-[10px]">{photo.annotation_key}</div>
                    )}
                  </div>
                  {/* Info */}
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-gray-800">
                      {photo.material ? `${photo.material} — ` : ""}{photo.damage_type}
                    </p>
                    {photo.annotation_text && (
                      <p className="text-xs text-gray-600 mt-1 leading-relaxed line-clamp-3">{photo.annotation_text}</p>
                    )}
                    <div className="flex gap-2 mt-1.5">
                      {photo.trade && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded bg-gray-200 text-gray-600 font-medium">{photo.trade}</span>
                      )}
                      <span className={`text-[9px] px-1.5 py-0.5 rounded font-bold ${style.bg} ${style.text}`}>{sev}</span>
                      <span className="text-[9px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 font-mono">{photo.annotation_key}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function CodeCompliance({ citations }: { citations: { desc: string; citation: CodeCitation }[] }) {
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);

  if (citations.length === 0) {
    return <div className="p-8 text-center text-sm text-gray-400">No code citations available</div>;
  }

  return (
    <div className="p-6 space-y-3">
      <div className="mb-2">
        <h3 className="text-sm font-semibold text-[var(--navy)]">Building Code Citations</h3>
        <p className="text-xs text-gray-400 mt-0.5">{citations.length} items with code authority — click to expand</p>
      </div>

      {citations.map((c, i) => {
        const isExpanded = expandedIdx === i;
        const cit = c.citation;

        return (
          <div key={i} className="border border-gray-200 rounded-lg overflow-hidden">
            {/* Header */}
            <button
              onClick={() => setExpandedIdx(isExpanded ? null : i)}
              className="w-full flex items-center gap-3 px-4 py-3 bg-gray-50 hover:bg-gray-100 transition-colors text-left"
            >
              <span className="inline-block px-2.5 py-1 rounded text-[10px] font-bold font-mono bg-[var(--navy)] text-white shrink-0">
                {cit.code_tag}
              </span>
              <span className="text-sm font-semibold text-gray-800">{cit.title}</span>
              <span className="text-xs text-gray-400 ml-auto shrink-0 hidden sm:block">
                {c.desc}
              </span>
              {cit.has_warranty_void && (
                <span className="text-[9px] font-bold text-red-600 bg-red-50 px-1.5 py-0.5 rounded shrink-0">WARRANTY</span>
              )}
              <svg className={`w-4 h-4 text-gray-400 transition-transform shrink-0 ${isExpanded ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </button>

            {/* Expanded content */}
            {isExpanded && (
              <div className="px-4 py-4 space-y-3">
                {/* Code Requirement */}
                {cit.requirement && (
                  <div className="bg-amber-50 border-l-4 border-amber-400 px-3 py-2 rounded-r">
                    <p className="text-[10px] font-bold text-amber-700 uppercase mb-1">Code Requirement</p>
                    <p className="text-xs text-gray-700 leading-relaxed">{cit.requirement}</p>
                  </div>
                )}

                {/* Supplement Argument */}
                {cit.supplement_argument && (
                  <div className="bg-green-50 border-l-4 border-green-400 px-3 py-2 rounded-r">
                    <p className="text-[10px] font-bold text-green-700 uppercase mb-1">Supplement Argument</p>
                    <p className="text-xs text-gray-700 leading-relaxed">{cit.supplement_argument}</p>
                  </div>
                )}

                {/* Manufacturer Specs */}
                {cit.manufacturer_specs && cit.manufacturer_specs.length > 0 && (
                  <div className="space-y-2">
                    {cit.manufacturer_specs.map((spec, j) => (
                      <div key={j} className="bg-blue-50 border-l-4 border-blue-400 px-3 py-2 rounded-r">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-xs font-bold text-blue-800">{spec.manufacturer}</span>
                          <span className="text-[10px] text-gray-500">{spec.document}</span>
                        </div>
                        <p className="text-xs text-gray-700 leading-relaxed">{spec.requirement}</p>
                        {spec.warranty_void && spec.warranty_text && (
                          <p className="text-xs font-bold text-red-600 mt-1">{spec.warranty_text}</p>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
