"use client";

import { useEffect, useState, useCallback } from "react";
import type { RoofSectionsData, RoofSection } from "@/types/roof-sections";
import { ROOF_MATERIALS } from "@/types/roof-sections";

interface Props {
  claimId: string;
}

function materialLabel(value: string): string {
  const found = ROOF_MATERIALS.find((m) => m.value === value);
  return found ? found.label : value.replace(/_/g, " ");
}

export function RoofSectionsEditor({ claimId }: Props) {
  const [data, setData] = useState<RoofSectionsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchSections = useCallback(async () => {
    try {
      const res = await fetch(`/api/roof-sections?claim_id=${claimId}`);
      if (res.ok) {
        const result = await res.json();
        setData(result.roof_sections);
      }
    } catch {
      // Non-fatal
    }
    setLoading(false);
  }, [claimId]);

  useEffect(() => {
    fetchSections();
  }, [fetchSections]);

  const handleMaterialChange = async (sectionIndex: number, material: string) => {
    if (!data) return;
    setSaving(sectionIndex);
    setError(null);

    // Optimistic update
    const updated = { ...data };
    updated.sections = [...updated.sections];
    updated.sections[sectionIndex] = {
      ...updated.sections[sectionIndex],
      user_material_override: material || null,
    };
    setData(updated);

    try {
      const res = await fetch("/api/roof-sections", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          claim_id: claimId,
          section_index: sectionIndex,
          material: material || null,
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({ error: "Unknown error" }));
        setError(`Failed to save: ${errData.error || res.statusText}`);
        // Revert optimistic update
        fetchSections();
      } else {
        const result = await res.json();
        setData(result.roof_sections);
      }
    } catch (err) {
      setError(`Save failed: ${err instanceof Error ? err.message : "Network error"}`);
      fetchSections();
    }
    setSaving(null);
  };

  if (loading) {
    return (
      <div className="bg-white rounded-2xl border border-gray-200 p-6">
        <p className="text-sm text-gray-400">Loading roof sections...</p>
      </div>
    );
  }

  if (!data || !data.sections || data.sections.length === 0) {
    return (
      <div className="bg-gray-50 border border-gray-200 rounded-2xl p-5">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-full bg-gray-100 flex items-center justify-center">
            <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
            </svg>
          </div>
          <div>
            <p className="text-sm font-medium text-gray-600">No slope breakdown available</p>
            <p className="text-xs text-gray-400">Reprocess with a measurement report to extract per-slope data</p>
          </div>
        </div>
      </div>
    );
  }

  // Compute impact summary: which materials and how much area
  const materialSummary = new Map<string, number>();
  for (const section of data.sections) {
    const mat = section.user_material_override || section.detected_material;
    materialSummary.set(mat, (materialSummary.get(mat) || 0) + section.area_sq);
  }

  // Group sections by structure
  const byStructure = new Map<string, { name: string; sections: { section: RoofSection; globalIndex: number }[] }>();
  data.sections.forEach((section, idx) => {
    const key = String(section.structure_index);
    if (!byStructure.has(key)) {
      byStructure.set(key, { name: section.structure_name, sections: [] });
    }
    byStructure.get(key)!.sections.push({ section, globalIndex: idx });
  });

  const hasOverrides = data.sections.some((s) => s.user_material_override !== null);

  return (
    <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
      {/* Header */}
      <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center">
            <svg className="w-4 h-4 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
            </svg>
          </div>
          <div>
            <h3 className="text-sm font-semibold text-[var(--navy)]">Roof Sections</h3>
            <p className="text-xs text-gray-400">
              {data.total_area_sq.toFixed(1)} SQ total &middot; {data.sections.length} slope{data.sections.length > 1 ? "s" : ""} &middot; {data.provider}
            </p>
          </div>
        </div>
        {hasOverrides && (
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-100 text-amber-700 border border-amber-200">
            Modified
          </span>
        )}
      </div>

      {error && (
        <div className="px-5 py-2">
          <div className="bg-red-50 border border-red-200 text-red-700 text-xs rounded-lg px-3 py-2">
            {error}
          </div>
        </div>
      )}

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 text-xs font-semibold text-gray-400 uppercase">
              <th className="px-5 py-2 text-left">Slope</th>
              <th className="px-3 py-2 text-right">Area (SQ)</th>
              <th className="px-3 py-2 text-center">Pitch</th>
              <th className="px-3 py-2 text-center">%</th>
              <th className="px-5 py-2 text-left">Material</th>
            </tr>
          </thead>
          <tbody>
            {[...byStructure.entries()].map(([, group]) =>
              group.sections.map(({ section, globalIndex }) => {
                const isOverridden = section.user_material_override !== null;
                const effectiveMaterial = section.user_material_override || section.detected_material;
                const isSaving = saving === globalIndex;

                return (
                  <tr
                    key={globalIndex}
                    className={`border-t border-gray-100 ${isOverridden ? "bg-amber-50/30" : ""}`}
                  >
                    <td className="px-5 py-2.5 text-gray-700">
                      <span className="font-medium">{section.structure_name}</span>
                      {section.pitch && <span className="ml-1 text-gray-400">({section.pitch})</span>}
                    </td>
                    <td className="px-3 py-2.5 text-right text-gray-600 font-mono">
                      {section.area_sq.toFixed(1)}
                    </td>
                    <td className="px-3 py-2.5 text-center text-gray-500">
                      {section.pitch || "—"}
                    </td>
                    <td className="px-3 py-2.5 text-center text-gray-400">
                      {section.percent > 0 ? `${section.percent}%` : "—"}
                    </td>
                    <td className="px-5 py-2.5">
                      <div className="flex items-center gap-2">
                        <select
                          value={effectiveMaterial}
                          onChange={(e) => handleMaterialChange(globalIndex, e.target.value)}
                          disabled={isSaving}
                          className={`rounded-lg border px-2 py-1.5 text-sm min-w-[180px] ${
                            isOverridden
                              ? "border-amber-300 bg-amber-50 text-amber-800 font-medium"
                              : "border-gray-200 text-gray-700"
                          } disabled:opacity-50`}
                        >
                          {ROOF_MATERIALS.map((m) => (
                            <option key={m.value} value={m.value}>
                              {m.label}
                            </option>
                          ))}
                        </select>
                        {isOverridden && (
                          <button
                            onClick={() => handleMaterialChange(globalIndex, "")}
                            className="text-xs text-amber-600 hover:text-amber-800 font-medium whitespace-nowrap"
                            title="Reset to detected material"
                          >
                            Reset
                          </button>
                        )}
                        {isSaving && (
                          <svg className="animate-spin w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                          </svg>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Material impact summary */}
      {hasOverrides && (
        <div className="px-5 py-3 border-t border-gray-100 bg-amber-50/30">
          <p className="text-xs font-semibold text-amber-700 mb-1">Impact Preview</p>
          <div className="flex flex-wrap gap-2">
            {[...materialSummary.entries()].map(([mat, sq]) => (
              <span key={mat} className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-white border border-gray-200 text-gray-700">
                {materialLabel(mat)}: {sq.toFixed(1)} SQ
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
