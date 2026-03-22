"use client";

import { useEffect, useState } from "react";

interface PublicPhoto {
  id: string;
  url: string;
  alt: string;
  damage_type: string | null;
  material: string | null;
  severity: string | null;
  elevation: string | null;
  caption: string | null;
}

interface Props {
  damageType?: string;
  material?: string;
  limit?: number;
  heading?: string;
}

export function LearnPhotoGallery({ damageType, material, limit = 6, heading }: Props) {
  const [photos, setPhotos] = useState<PublicPhoto[]>([]);
  const [selected, setSelected] = useState<PublicPhoto | null>(null);

  useEffect(() => {
    const params = new URLSearchParams();
    if (damageType) params.set("damage_type", damageType);
    if (material) params.set("material", material);
    params.set("limit", String(limit));

    fetch(`/api/public-photos?${params}`)
      .then((r) => r.json())
      .then((d) => setPhotos(d.photos || []))
      .catch(() => {});
  }, [damageType, material, limit]);

  if (photos.length === 0) return null;

  return (
    <div className="my-10">
      {heading && (
        <h3 className="text-lg font-bold text-[var(--white)] mb-4">{heading}</h3>
      )}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {photos.map((photo) => (
          <button
            key={photo.id}
            onClick={() => setSelected(photo)}
            className="group relative aspect-[4/3] rounded-xl overflow-hidden border border-white/10 hover:border-white/30 transition-colors"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={photo.url}
              alt={photo.alt}
              title={photo.alt}
              loading="lazy"
              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
            />
            <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/80 to-transparent p-3">
              <p className="text-xs text-white/90 line-clamp-2">{photo.caption || photo.alt}</p>
              {photo.severity && (
                <span className={`inline-block mt-1 text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${
                  photo.severity === "severe" ? "bg-red-500/80 text-white" :
                  photo.severity === "moderate" ? "bg-amber-500/80 text-white" :
                  "bg-green-500/80 text-white"
                }`}>
                  {photo.severity}
                </span>
              )}
            </div>
          </button>
        ))}
      </div>
      <p className="text-xs text-[var(--gray-muted)] mt-3 italic">
        Real photos from claims processed by dumbroof.ai. All identifying information removed.
      </p>

      {/* Lightbox */}
      {selected && (
        <div
          className="fixed inset-0 z-[100] bg-black/90 flex items-center justify-center p-6"
          onClick={() => setSelected(null)}
        >
          <div className="relative max-w-4xl w-full" onClick={(e) => e.stopPropagation()}>
            <button
              onClick={() => setSelected(null)}
              className="absolute -top-10 right-0 text-white/70 hover:text-white text-2xl"
            >
              &times;
            </button>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={selected.url}
              alt={selected.alt}
              className="w-full rounded-xl"
            />
            <div className="mt-4 text-white">
              <p className="text-sm leading-relaxed">{selected.caption}</p>
              <div className="flex gap-3 mt-2 text-xs text-white/60">
                {selected.damage_type && <span>Damage: {selected.damage_type}</span>}
                {selected.material && <span>Material: {selected.material}</span>}
                {selected.severity && <span>Severity: {selected.severity}</span>}
                {selected.elevation && <span>Elevation: {selected.elevation}</span>}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
