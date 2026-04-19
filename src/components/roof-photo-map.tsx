"use client";

/**
 * Overhead roof map — visualizes EagleView facet polygons colored by per-slope
 * weighted damage % and routes clicks to a side panel showing the photos
 * assigned to each slope.
 *
 * Reads `claims.roof_facets` + `claims.slope_damage` + `claims.full_reroof_trigger`
 * produced by backend/processor.py (extract_roof_facets + slope_mapping).
 */

import { useMemo, useState } from "react";
import type {
  Cardinal,
  RoofFacet,
  RoofFacetsPayload,
  RoofPhotoMapPhoto,
  SlopeDamageRow,
} from "@/types/roof-facets";

// Damage color scale — matches the tone used elsewhere in the app.
// Green under 10%, yellow 10-24%, orange 25-49%, red ≥50%.
function damageColor(pct: number): { fill: string; stroke: string } {
  if (pct >= 0.5)  return { fill: "rgba(239,68,68,0.35)",  stroke: "rgb(239,68,68)" };
  if (pct >= 0.25) return { fill: "rgba(251,146,60,0.30)", stroke: "rgb(251,146,60)" };
  if (pct >= 0.10) return { fill: "rgba(250,204,21,0.25)", stroke: "rgb(250,204,21)" };
  return              { fill: "rgba(34,197,94,0.20)",  stroke: "rgb(34,197,94)" };
}

// Severity chip shown on each photo thumbnail.
const SEVERITY_CHIP: Record<string, string> = {
  critical: "bg-red-500/20 text-red-300 border-red-500/40",
  severe:   "bg-orange-500/20 text-orange-300 border-orange-500/40",
  moderate: "bg-amber-500/20 text-amber-300 border-amber-500/40",
  minor:    "bg-yellow-500/20 text-yellow-300 border-yellow-500/40",
  none:     "bg-white/5 text-[var(--gray-muted)] border-white/10",
};

function polygonCentroid(points: Array<[number, number]>): [number, number] {
  if (!points.length) return [500, 500];
  const sum = points.reduce(
    (acc, [x, y]) => [acc[0] + x, acc[1] + y],
    [0, 0],
  );
  return [sum[0] / points.length, sum[1] / points.length];
}

function pointsToPath(points: Array<[number, number]> | undefined): string {
  if (!points || !points.length) return "";
  return points.map(([x, y], i) => (i === 0 ? `M${x},${y}` : `L${x},${y}`)).join(" ") + " Z";
}

interface RoofPhotoMapProps {
  roofFacets: RoofFacetsPayload | null;
  slopeDamage: SlopeDamageRow[] | null;
  fullReroofTrigger: boolean;
  photos: RoofPhotoMapPhoto[];
  // Signed URL resolver for photo thumbnails. Optional — if absent we show
  // just the annotation key.
  photoUrl?: (annotationKey: string, filename?: string | null) => string | null;
  className?: string;
}

export function RoofPhotoMap({
  roofFacets,
  slopeDamage,
  fullReroofTrigger,
  photos,
  photoUrl,
  className,
}: RoofPhotoMapProps) {
  const [selectedFacetId, setSelectedFacetId] = useState<string | null>(null);

  const facets = roofFacets?.roof_facets ?? [];
  const damageByFacet = useMemo<Record<string, SlopeDamageRow>>(() => {
    const out: Record<string, SlopeDamageRow> = {};
    (slopeDamage ?? []).forEach((row) => {
      if (row?.facet_id) out[row.facet_id] = row;
    });
    return out;
  }, [slopeDamage]);

  const photosByFacet = useMemo<Record<string, RoofPhotoMapPhoto[]>>(() => {
    const out: Record<string, RoofPhotoMapPhoto[]> = {};
    photos.forEach((p) => {
      const sid = p.slope_id || "_unassigned";
      (out[sid] ||= []).push(p);
    });
    return out;
  }, [photos]);

  const selectedPhotos = selectedFacetId ? photosByFacet[selectedFacetId] ?? [] : [];
  const selectedDamage = selectedFacetId ? damageByFacet[selectedFacetId] : null;

  const unassignedCount = photosByFacet["_unassigned"]?.length ?? 0;
  const northAngle = roofFacets?.north_arrow_angle ?? 0;

  // Empty state: no facet data for this claim yet.
  if (!facets.length) {
    return (
      <div
        className={`glass-card p-6 text-[var(--gray)] ${className ?? ""}`}
        data-testid="roof-map-empty"
      >
        <h3 className="text-lg font-semibold text-white mb-2">Overhead Roof Map</h3>
        <p className="text-sm">
          No roof facet data available for this claim yet. Upload an EagleView
          (or equivalent) measurement PDF and reprocess to enable the overhead
          map + per-slope damage breakdown.
        </p>
      </div>
    );
  }

  return (
    <div className={`glass-card p-5 ${className ?? ""}`}>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-lg font-semibold text-white">Overhead Roof Map</h3>
          <p className="text-xs text-[var(--gray-muted)] mt-1">
            Click a slope to view its photos. Colors show per-slope damage %.
          </p>
        </div>
        {fullReroofTrigger && (
          <span
            className="text-xs font-semibold px-3 py-1.5 rounded-full bg-red-500/20 text-red-300 border border-red-500/40"
            title="Area-weighted damage ≥25% across the roof"
          >
            Full Reroof Trigger
          </span>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
        {/* Roof SVG canvas */}
        <div className="md:col-span-3 relative rounded-xl overflow-hidden bg-[rgb(10,14,39)] border border-white/10">
          <svg
            viewBox="0 0 1000 1000"
            className="w-full h-auto block"
            role="img"
            aria-label="Overhead roof map"
          >
            {/* Dot grid background for context */}
            <defs>
              <pattern id="roofmap-grid" width="50" height="50" patternUnits="userSpaceOnUse">
                <circle cx="25" cy="25" r="1" fill="rgba(255,255,255,0.07)" />
              </pattern>
            </defs>
            <rect width="1000" height="1000" fill="url(#roofmap-grid)" />

            {/* Facet polygons */}
            {facets.map((facet) => {
              const dmg = damageByFacet[facet.facet_id]?.weighted_damage_pct ?? 0;
              const color = damageColor(dmg);
              const isSelected = selectedFacetId === facet.facet_id;
              const [cx, cy] = polygonCentroid(facet.polygon_pixels ?? []);
              return (
                <g
                  key={facet.facet_id}
                  onClick={() => setSelectedFacetId(facet.facet_id)}
                  style={{ cursor: "pointer" }}
                >
                  <path
                    d={pointsToPath(facet.polygon_pixels)}
                    fill={color.fill}
                    stroke={color.stroke}
                    strokeWidth={isSelected ? 4 : 2}
                    strokeLinejoin="round"
                    opacity={selectedFacetId && !isSelected ? 0.55 : 1}
                  />
                  {/* Facet label */}
                  <text
                    x={cx}
                    y={cy - 8}
                    textAnchor="middle"
                    className="fill-white"
                    style={{ fontSize: 22, fontWeight: 700, pointerEvents: "none" }}
                  >
                    {facet.facet_id}
                  </text>
                  <text
                    x={cx}
                    y={cy + 18}
                    textAnchor="middle"
                    className="fill-[var(--gray-muted)]"
                    style={{ fontSize: 14, pointerEvents: "none" }}
                  >
                    {facet.cardinal ?? "—"} · {facet.pitch ?? "?/12"} ·{" "}
                    {Math.round(dmg * 100)}%
                  </text>
                </g>
              );
            })}

            {/* Compass rose — north arrow rotated by extracted north_arrow_angle */}
            <g transform={`translate(60,60) rotate(${-northAngle})`}>
              <circle r="32" fill="rgba(255,255,255,0.05)" stroke="rgba(255,255,255,0.2)" />
              <path
                d="M0,-24 L8,8 L0,2 L-8,8 Z"
                fill="var(--cyan, #22d8ff)"
              />
              <text
                x="0"
                y="-36"
                textAnchor="middle"
                fill="var(--cyan, #22d8ff)"
                style={{ fontSize: 14, fontWeight: 700 }}
              >
                N
              </text>
            </g>
          </svg>

          {/* Color scale legend */}
          <div className="flex items-center gap-3 text-[11px] text-[var(--gray-muted)] px-3 py-2 border-t border-white/5 bg-[rgba(6,9,24,0.6)]">
            <span className="inline-block w-3 h-3 rounded-sm bg-green-500/30 border border-green-500" />
            <span>&lt; 10%</span>
            <span className="inline-block w-3 h-3 rounded-sm bg-yellow-500/30 border border-yellow-500 ml-2" />
            <span>10-24%</span>
            <span className="inline-block w-3 h-3 rounded-sm bg-orange-500/30 border border-orange-500 ml-2" />
            <span>25-49%</span>
            <span className="inline-block w-3 h-3 rounded-sm bg-red-500/30 border border-red-500 ml-2" />
            <span>≥ 50%</span>
          </div>
        </div>

        {/* Side panel — selected slope details + photos */}
        <div className="md:col-span-2 flex flex-col gap-3">
          <SlopePanel
            facet={facets.find((f) => f.facet_id === selectedFacetId) ?? null}
            damage={selectedDamage}
            photos={selectedPhotos}
            photoUrl={photoUrl}
            onClear={() => setSelectedFacetId(null)}
          />

          {unassignedCount > 0 && !selectedFacetId && (
            <div className="text-xs text-[var(--gray-muted)] border border-white/10 rounded-lg px-3 py-2">
              {unassignedCount} photo{unassignedCount === 1 ? "" : "s"} could not
              be placed on a slope (missing EXIF compass heading).
            </div>
          )}

          <SlopeSummary
            facets={facets}
            damageByFacet={damageByFacet}
            photosByFacet={photosByFacet}
            selectedFacetId={selectedFacetId}
            onSelect={setSelectedFacetId}
          />
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------
// Subcomponents
// ---------------------------------------------------------------

function SlopePanel({
  facet,
  damage,
  photos,
  photoUrl,
  onClear,
}: {
  facet: RoofFacet | null;
  damage: SlopeDamageRow | null;
  photos: RoofPhotoMapPhoto[];
  photoUrl?: (annotationKey: string, filename?: string | null) => string | null;
  onClear: () => void;
}) {
  if (!facet) {
    return (
      <div className="text-sm text-[var(--gray-muted)] border border-dashed border-white/10 rounded-lg px-4 py-6 text-center">
        Click any slope on the map to see its damage breakdown and photos.
      </div>
    );
  }

  const pct = damage?.weighted_damage_pct ?? 0;
  const color = damageColor(pct);

  return (
    <div className="border border-white/10 rounded-xl overflow-hidden">
      <div
        className="px-4 py-3 flex items-center justify-between"
        style={{ background: color.fill, borderBottom: `1px solid ${color.stroke}` }}
      >
        <div>
          <div className="text-white font-semibold text-base">
            Slope {facet.facet_id}
          </div>
          <div className="text-xs text-[var(--gray-muted)]">
            {facet.cardinal ?? "—"} · {facet.pitch ?? "?/12"} ·{" "}
            {facet.area_pct ? `${Math.round(facet.area_pct)}% of roof` : "area unknown"}
          </div>
        </div>
        <button
          onClick={onClear}
          className="text-[var(--gray-muted)] hover:text-white text-xs px-2 py-1 rounded border border-white/10"
        >
          Clear
        </button>
      </div>

      <div className="px-4 py-3 grid grid-cols-3 gap-2 text-xs border-b border-white/5">
        <Metric label="Damage %" value={`${Math.round(pct * 100)}%`} />
        <Metric
          label="Damage photos"
          value={`${damage?.damage_photos ?? 0} / ${damage?.total_photos ?? 0}`}
        />
        <Metric
          label="Dominant"
          value={damage?.dominant_damage_type ?? "—"}
          mono
        />
      </div>

      {photos.length === 0 ? (
        <div className="px-4 py-4 text-xs text-[var(--gray-muted)]">
          No photos assigned to this slope.
        </div>
      ) : (
        <div className="p-3 grid grid-cols-3 gap-2 max-h-80 overflow-y-auto">
          {photos.map((p) => (
            <PhotoChip key={p.annotation_key} photo={p} photoUrl={photoUrl} />
          ))}
        </div>
      )}
    </div>
  );
}

function Metric({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div>
      <div className="text-[var(--gray-muted)] text-[10px] uppercase tracking-wide">
        {label}
      </div>
      <div
        className={`text-white text-sm font-semibold ${mono ? "font-mono" : ""} truncate`}
      >
        {value}
      </div>
    </div>
  );
}

function PhotoChip({
  photo,
  photoUrl,
}: {
  photo: RoofPhotoMapPhoto;
  photoUrl?: (annotationKey: string, filename?: string | null) => string | null;
}) {
  const url = photoUrl?.(photo.annotation_key, photo.filename);
  const sev = (photo.severity ?? "none").toLowerCase();
  const sevClass = SEVERITY_CHIP[sev] ?? SEVERITY_CHIP.none;
  return (
    <div className="relative rounded-md overflow-hidden border border-white/10 bg-white/5 aspect-square">
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={url}
          alt={photo.annotation_key}
          className="w-full h-full object-cover"
          loading="lazy"
        />
      ) : (
        <div className="w-full h-full flex items-center justify-center text-[10px] text-[var(--gray-muted)]">
          {photo.annotation_key}
        </div>
      )}
      <div
        className={`absolute bottom-1 right-1 text-[9px] font-semibold px-1.5 py-0.5 rounded border ${sevClass}`}
      >
        {sev}
      </div>
    </div>
  );
}

function SlopeSummary({
  facets,
  damageByFacet,
  photosByFacet,
  selectedFacetId,
  onSelect,
}: {
  facets: RoofFacet[];
  damageByFacet: Record<string, SlopeDamageRow>;
  photosByFacet: Record<string, RoofPhotoMapPhoto[]>;
  selectedFacetId: string | null;
  onSelect: (id: string) => void;
}) {
  if (facets.length === 0) return null;
  return (
    <div className="border border-white/10 rounded-xl overflow-hidden">
      <div className="px-3 py-2 text-[10px] uppercase tracking-wide text-[var(--gray-muted)] border-b border-white/5">
        All slopes
      </div>
      <div className="divide-y divide-white/5 max-h-60 overflow-y-auto">
        {facets.map((f) => {
          const dmg = damageByFacet[f.facet_id]?.weighted_damage_pct ?? 0;
          const photoCt = photosByFacet[f.facet_id]?.length ?? 0;
          const color = damageColor(dmg);
          const isSel = selectedFacetId === f.facet_id;
          return (
            <button
              key={f.facet_id}
              onClick={() => onSelect(f.facet_id)}
              className={`w-full flex items-center justify-between px-3 py-2 text-left hover:bg-white/5 transition-colors ${
                isSel ? "bg-white/10" : ""
              }`}
            >
              <div className="flex items-center gap-2 min-w-0">
                <span
                  className="inline-block w-2 h-2 rounded-full"
                  style={{ background: color.stroke }}
                />
                <span className="text-white font-semibold text-sm">
                  {f.facet_id}
                </span>
                <span className="text-[var(--gray-muted)] text-xs truncate">
                  {f.cardinal ?? "—"} · {f.pitch ?? "?/12"}
                </span>
              </div>
              <div className="flex items-center gap-3 text-xs">
                <span className="text-white font-semibold">
                  {Math.round(dmg * 100)}%
                </span>
                <span className="text-[var(--gray-muted)]">
                  {photoCt} photo{photoCt === 1 ? "" : "s"}
                </span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
