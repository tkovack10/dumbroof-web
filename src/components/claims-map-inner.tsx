"use client";

import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { Claim } from "@/types/claim";

function scoreColor(score: number | null | undefined): string {
  if (score == null) return "#9ca3af"; // gray
  if (score < 30) return "#22c55e"; // green
  if (score < 60) return "#eab308"; // yellow
  if (score < 80) return "#f97316"; // orange
  return "#ef4444"; // red
}

function makeIcon(score: number | null | undefined) {
  const color = scoreColor(score);
  const label = score != null ? String(score) : "?";
  return L.divIcon({
    className: "",
    iconSize: [28, 28],
    iconAnchor: [14, 14],
    html: `<div style="width:28px;height:28px;border-radius:50%;background:${color};border:2px solid white;box-shadow:0 1px 4px rgba(0,0,0,0.3);display:flex;align-items:center;justify-content:center;color:white;font-size:10px;font-weight:700;font-family:system-ui;text-shadow:0 1px 1px rgba(0,0,0,0.3);">${label}</div>`,
  });
}

function fmtMoney(val: number): string {
  if (val >= 1_000_000) return `$${(val / 1_000_000).toFixed(2)}M`;
  if (val >= 1_000) return `$${(val / 1_000).toFixed(0)}K`;
  return `$${val.toFixed(0)}`;
}

interface Props {
  claims: Claim[];
  height: string;
  showUserEmail: boolean;
}

export default function ClaimsMapInner({ claims, height, showUserEmail }: Props) {
  const mapRef = useRef<L.Map | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current, {
      scrollWheelZoom: true,
    }).setView([39.8283, -98.5795], 5);

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 19,
    }).addTo(map);

    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    // Clear existing markers
    map.eachLayer((layer) => {
      if (layer instanceof L.Marker) map.removeLayer(layer);
    });

    const bounds: L.LatLngExpression[] = [];

    for (const claim of claims) {
      if (!claim.latitude || !claim.longitude) continue;
      const pos: L.LatLngExpression = [claim.latitude, claim.longitude];
      bounds.push(pos);

      const rcv = claim.contractor_rcv ? fmtMoney(claim.contractor_rcv) : "—";
      const carrierRcv = claim.original_carrier_rcv ? fmtMoney(claim.original_carrier_rcv) : "—";
      const scoreText = claim.damage_score != null ? `${claim.damage_score}/100 (${claim.damage_grade || "?"})` : "—";
      const statusBadge = claim.claim_outcome === "won"
        ? '<span style="color:green;font-weight:bold;">Won</span>'
        : claim.status.charAt(0).toUpperCase() + claim.status.slice(1);

      let popup = `<div style="min-width:200px;font-family:system-ui;font-size:13px;">
        <p style="font-weight:700;margin:0 0 4px;">${claim.address}</p>
        ${showUserEmail && claim.user_email ? `<p style="color:#6b7280;font-size:11px;margin:0 0 4px;">${claim.user_email}</p>` : ""}
        <p style="margin:2px 0;"><b>Carrier:</b> ${claim.carrier || "—"}</p>
        <p style="margin:2px 0;"><b>Damage:</b> ${scoreText}</p>
        <p style="margin:2px 0;"><b>RCV:</b> ${rcv} | Carrier: ${carrierRcv}</p>
        <p style="margin:2px 0;"><b>Status:</b> ${statusBadge}</p>
        <a href="/dashboard/claim/${claim.id}" style="color:#2563eb;font-size:12px;">View Claim &rarr;</a>
      </div>`;

      L.marker(pos, { icon: makeIcon(claim.damage_score) })
        .addTo(map)
        .bindPopup(popup);
    }

    if (bounds.length > 0) {
      map.fitBounds(L.latLngBounds(bounds), { padding: [30, 30], maxZoom: 12 });
    }
  }, [claims, showUserEmail]);

  return <div ref={containerRef} className="rounded-xl overflow-hidden border border-[var(--border-glass)]" style={{ height }} />;
}
