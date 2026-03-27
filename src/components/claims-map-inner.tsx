"use client";

import { useEffect, useRef, useState } from "react";
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

function hailColor(size: number | undefined): string {
  if (!size) return "rgba(59, 130, 246, 0.3)"; // blue default
  if (size < 1) return "rgba(34, 197, 94, 0.35)"; // green <1"
  if (size < 1.5) return "rgba(234, 179, 8, 0.4)"; // yellow 1-1.5"
  if (size < 2) return "rgba(249, 115, 22, 0.45)"; // orange 1.5-2"
  return "rgba(239, 68, 68, 0.5)"; // red 2"+
}

function windColor(speed: number | undefined): string {
  if (!speed) return "rgba(96, 165, 250, 0.3)";
  if (speed < 60) return "rgba(96, 165, 250, 0.35)";
  if (speed < 80) return "rgba(168, 85, 247, 0.4)";
  return "rgba(239, 68, 68, 0.45)";
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
  showStormEvents?: boolean;
}

export default function ClaimsMapInner({ claims, height, showUserEmail, showStormEvents = true }: Props) {
  const mapRef = useRef<L.Map | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const stormLayerRef = useRef<L.LayerGroup | null>(null);
  const [stormVisible, setStormVisible] = useState(true);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current, {
      scrollWheelZoom: true,
    }).setView([39.8283, -98.5795], 5);

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 19,
    }).addTo(map);

    // Create storm events layer group
    const stormLayer = L.layerGroup().addTo(map);
    stormLayerRef.current = stormLayer;

    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
      stormLayerRef.current = null;
    };
  }, []);

  // Toggle storm layer visibility
  useEffect(() => {
    const map = mapRef.current;
    const layer = stormLayerRef.current;
    if (!map || !layer) return;

    if (stormVisible) {
      if (!map.hasLayer(layer)) map.addLayer(layer);
    } else {
      if (map.hasLayer(layer)) map.removeLayer(layer);
    }
  }, [stormVisible]);

  useEffect(() => {
    const map = mapRef.current;
    const stormLayer = stormLayerRef.current;
    if (!map) return;

    // Clear existing markers
    map.eachLayer((layer) => {
      if (layer instanceof L.Marker) map.removeLayer(layer);
    });

    // Clear storm events
    if (stormLayer) stormLayer.clearLayers();

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
        <p style="margin:2px 0;"><b>Status:</b> ${statusBadge}</p>`;

      // Add weather summary if available
      const wd = claim.weather_data;
      if (wd && wd.event_count && wd.event_count > 0) {
        popup += `<hr style="margin:4px 0;border-color:#e5e7eb;" />`;
        popup += `<p style="margin:2px 0;font-size:11px;color:#6b7280;"><b>Storm Events:</b> ${wd.event_count}`;
        if (wd.max_hail_inches) popup += ` | Max Hail: ${wd.max_hail_inches}"`;
        if (wd.max_wind_mph) popup += ` | Max Wind: ${wd.max_wind_mph}mph`;
        popup += `</p>`;
      }

      popup += `<a href="/dashboard/claim/${claim.id}" style="color:#2563eb;font-size:12px;">View Claim &rarr;</a>
      </div>`;

      L.marker(pos, { icon: makeIcon(claim.damage_score) })
        .addTo(map)
        .bindPopup(popup);

      // Add storm event circles if weather data exists
      if (showStormEvents && stormLayer && wd?.events) {
        for (const event of wd.events) {
          if (!event.latitude || !event.longitude) continue;

          const isHail = event.event_type?.toLowerCase().includes("hail");
          const color = isHail
            ? hailColor(event.hail_size)
            : windColor(event.wind_speed);

          // Radius based on hail size or wind speed (visual scaling)
          const baseRadius = isHail
            ? Math.max((event.hail_size || 0.75) * 3000, 2000)
            : Math.max((event.wind_speed || 50) * 30, 1500);

          const circle = L.circle([event.latitude, event.longitude], {
            radius: baseRadius,
            color: isHail ? "#ef4444" : "#3b82f6",
            weight: 1,
            opacity: 0.6,
            fillColor: color,
            fillOpacity: 0.4,
          });

          const eventPopup = `<div style="font-family:system-ui;font-size:12px;">
            <p style="font-weight:700;margin:0 0 2px;">${event.event_type || "Storm Event"}</p>
            <p style="margin:1px 0;color:#6b7280;">${event.date || ""}</p>
            ${isHail && event.hail_size ? `<p style="margin:1px 0;"><b>Hail Size:</b> ${event.hail_size}"</p>` : ""}
            ${!isHail && event.wind_speed ? `<p style="margin:1px 0;"><b>Wind Speed:</b> ${event.wind_speed} mph</p>` : ""}
            <p style="margin:1px 0;"><b>Location:</b> ${event.location || "Unknown"}</p>
            ${event.distance_miles != null ? `<p style="margin:1px 0;"><b>Distance:</b> ${event.distance_miles.toFixed(1)} mi from property</p>` : ""}
            ${event.source ? `<p style="margin:1px 0;color:#9ca3af;font-size:10px;">Source: ${event.source}</p>` : ""}
          </div>`;

          circle.bindPopup(eventPopup);
          stormLayer.addLayer(circle);
        }
      }
    }

    if (bounds.length > 0) {
      map.fitBounds(L.latLngBounds(bounds), { padding: [30, 30], maxZoom: 12 });
    }
  }, [claims, showUserEmail, showStormEvents]);

  return (
    <div className="relative">
      <div ref={containerRef} className="rounded-xl overflow-hidden border border-[var(--border-glass)]" style={{ height }} />

      {/* Storm events toggle + legend */}
      {showStormEvents && (
        <div className="absolute top-3 right-3 z-[1000] flex flex-col gap-2">
          {/* Toggle */}
          <button
            onClick={() => setStormVisible(!stormVisible)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors shadow-lg ${
              stormVisible
                ? "bg-[rgb(15,18,35)] text-[var(--cyan)] border border-[var(--cyan)]/30"
                : "bg-[rgb(15,18,35)] text-[var(--gray-muted)] border border-white/10"
            }`}
          >
            {stormVisible ? "Hide Storm Events" : "Show Storm Events"}
          </button>

          {/* Legend */}
          {stormVisible && (
            <div className="bg-[rgb(15,18,35)] border border-white/10 rounded-lg p-2 shadow-lg text-[10px]">
              <p className="text-[var(--gray-muted)] font-semibold mb-1">Hail Size</p>
              <div className="space-y-0.5">
                <div className="flex items-center gap-1.5">
                  <div className="w-3 h-3 rounded-full" style={{ background: "rgba(34, 197, 94, 0.6)" }} />
                  <span className="text-[var(--gray)]">&lt; 1&quot;</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="w-3 h-3 rounded-full" style={{ background: "rgba(234, 179, 8, 0.6)" }} />
                  <span className="text-[var(--gray)]">1&quot; - 1.5&quot;</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="w-3 h-3 rounded-full" style={{ background: "rgba(249, 115, 22, 0.6)" }} />
                  <span className="text-[var(--gray)]">1.5&quot; - 2&quot;</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="w-3 h-3 rounded-full" style={{ background: "rgba(239, 68, 68, 0.6)" }} />
                  <span className="text-[var(--gray)]">2&quot;+</span>
                </div>
              </div>
              <p className="text-[var(--gray-muted)] font-semibold mt-1.5 mb-0.5">Wind</p>
              <div className="flex items-center gap-1.5">
                <div className="w-3 h-3 rounded-full" style={{ background: "rgba(96, 165, 250, 0.6)" }} />
                <span className="text-[var(--gray)]">Thunderstorm Wind</span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
