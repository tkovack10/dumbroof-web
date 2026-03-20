"use client";

import dynamic from "next/dynamic";
import type { Claim } from "@/types/claim";

const ClaimsMapInner = dynamic(() => import("./claims-map-inner"), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center bg-white/[0.06] rounded-xl" style={{ height: "400px" }}>
      <p className="text-[var(--gray-dim)] text-sm">Loading map...</p>
    </div>
  ),
});

interface ClaimsMapProps {
  claims: Claim[];
  height?: string;
  showUserEmail?: boolean;
}

export function ClaimsMap({ claims, height = "400px", showUserEmail = false }: ClaimsMapProps) {
  const geolocated = claims.filter((c) => c.latitude && c.longitude);
  if (geolocated.length === 0) {
    return (
      <div className="flex items-center justify-center bg-white/[0.06] rounded-xl border border-[var(--border-glass)]" style={{ height }}>
        <div className="text-center">
          <p className="text-[var(--gray-muted)] text-sm font-medium">No geocoded claims</p>
          <p className="text-[var(--gray-dim)] text-xs mt-1">Claims will appear on the map after processing</p>
        </div>
      </div>
    );
  }
  return <ClaimsMapInner claims={geolocated} height={height} showUserEmail={showUserEmail} />;
}
