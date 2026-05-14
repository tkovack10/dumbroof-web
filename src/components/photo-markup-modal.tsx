"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface Props {
  claimId: string;
  annotationKey: string;
  imageUrl: string;
  onClose: () => void;
  onSaved?: (annotatedPath: string) => void;
}

type Tool = "pen" | "arrow" | "circle";
type Stroke =
  | { type: "pen"; color: string; width: number; points: Array<[number, number]> }
  | { type: "arrow"; color: string; width: number; from: [number, number]; to: [number, number] }
  | { type: "circle"; color: string; width: number; center: [number, number]; radius: number };

const COLORS = ["#ff3030", "#ffd60a", "#22d8ff", "#00f27d"] as const;

/**
 * Modal canvas for marking up a single photo.
 *
 * Strategy: load the photo into an Image, render it as the canvas base layer,
 * then accept user strokes/arrows/circles on top. On save, export the flat
 * canvas as a PNG data-URL and POST to /api/photos/annotate. Original photo
 * is never modified; the annotated copy lives next to it in storage.
 *
 * Tooling MVP:
 *   - pen (free-draw)
 *   - arrow (click-drag, terminus arrowhead pointing at the release point)
 *   - circle (click-drag, ring outline — useful for hail dents)
 *   - 4 colors (vivid red / yellow / cyan / green)
 *   - undo (pops the last stroke)
 *   - clear (drops every stroke)
 *   - save (POSTs PNG)
 */
export function PhotoMarkupModal({
  claimId,
  annotationKey,
  imageUrl,
  onClose,
  onSaved,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [imgLoaded, setImgLoaded] = useState(false);
  const [tool, setTool] = useState<Tool>("pen");
  const [color, setColor] = useState<string>(COLORS[0]);
  const [width, setWidth] = useState<number>(6);
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [drawing, setDrawing] = useState<Stroke | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load the source photo into an off-DOM Image, then size the canvas to
  // match its natural dimensions so strokes are crisp and the export size
  // matches what the user sees.
  useEffect(() => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      imgRef.current = img;
      setImgLoaded(true);
    };
    img.onerror = () => setError("Could not load photo for markup.");
    img.src = imageUrl;
  }, [imageUrl]);

  // Redraw whenever strokes / in-progress shape change.
  useEffect(() => {
    const canvas = canvasRef.current;
    const img = imgRef.current;
    if (!canvas || !img || !imgLoaded) return;
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(img, 0, 0);
    const all: Stroke[] = drawing ? [...strokes, drawing] : strokes;
    for (const s of all) drawStroke(ctx, s);
  }, [strokes, drawing, imgLoaded]);

  const getCanvasPoint = useCallback((e: React.PointerEvent<HTMLCanvasElement>): [number, number] => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return [(e.clientX - rect.left) * scaleX, (e.clientY - rect.top) * scaleY];
  }, []);

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!imgLoaded) return;
    e.preventDefault();
    (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId);
    const p = getCanvasPoint(e);
    if (tool === "pen") {
      setDrawing({ type: "pen", color, width, points: [p] });
    } else if (tool === "arrow") {
      setDrawing({ type: "arrow", color, width, from: p, to: p });
    } else {
      setDrawing({ type: "circle", color, width, center: p, radius: 0 });
    }
  }, [color, width, tool, imgLoaded, getCanvasPoint]);

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing) return;
    const p = getCanvasPoint(e);
    if (drawing.type === "pen") {
      setDrawing({ ...drawing, points: [...drawing.points, p] });
    } else if (drawing.type === "arrow") {
      setDrawing({ ...drawing, to: p });
    } else {
      const dx = p[0] - drawing.center[0];
      const dy = p[1] - drawing.center[1];
      setDrawing({ ...drawing, radius: Math.sqrt(dx * dx + dy * dy) });
    }
  }, [drawing, getCanvasPoint]);

  const onPointerUp = useCallback(() => {
    if (!drawing) return;
    setStrokes((s) => [...s, drawing]);
    setDrawing(null);
  }, [drawing]);

  const undo = useCallback(() => {
    setStrokes((s) => s.slice(0, -1));
  }, []);
  const clear = useCallback(() => setStrokes([]), []);

  const save = useCallback(async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    setSaving(true);
    setError(null);
    try {
      const dataUrl = canvas.toDataURL("image/png");
      const res = await fetch("/api/photos/annotate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          claim_id: claimId,
          annotation_key: annotationKey,
          image_base64: dataUrl,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `Save failed (${res.status})`);
      }
      const j = await res.json();
      onSaved?.(j.annotated_path);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }, [claimId, annotationKey, onSaved, onClose]);

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="glass-card w-full max-w-5xl max-h-[95vh] flex flex-col overflow-hidden">
        <div className="px-5 py-3 border-b border-[var(--border-glass)] flex items-center justify-between">
          <div>
            <h3 className="text-sm font-bold text-white">Mark up photo</h3>
            <p className="text-xs text-[var(--gray-muted)] mt-0.5">
              Circle hail dents, arrow to damage, free-draw to highlight. Saved copy replaces the version shown in your reports.
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-[var(--gray-dim)] hover:text-white p-1 rounded-lg"
            aria-label="Close"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Toolbar */}
        <div className="px-5 py-3 border-b border-[var(--border-glass)] flex flex-wrap items-center gap-3">
          <div className="flex gap-1 bg-white/[0.04] rounded-lg p-1">
            <ToolBtn active={tool === "pen"} onClick={() => setTool("pen")} label="Pen" />
            <ToolBtn active={tool === "arrow"} onClick={() => setTool("arrow")} label="Arrow" />
            <ToolBtn active={tool === "circle"} onClick={() => setTool("circle")} label="Circle" />
          </div>
          <div className="flex gap-1.5">
            {COLORS.map((c) => (
              <button
                key={c}
                onClick={() => setColor(c)}
                className={`w-7 h-7 rounded-full border-2 transition-transform ${
                  color === c ? "border-white scale-110" : "border-transparent"
                }`}
                style={{ backgroundColor: c }}
                aria-label={`Color ${c}`}
              />
            ))}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-[var(--gray-muted)]">Size</span>
            <input
              type="range"
              min={2}
              max={32}
              value={width}
              onChange={(e) => setWidth(parseInt(e.target.value, 10))}
              className="accent-[var(--cyan)]"
            />
            <span className="text-xs text-[var(--gray-muted)] w-6 text-right">{width}</span>
          </div>
          <div className="ml-auto flex gap-2">
            <button
              onClick={undo}
              disabled={!strokes.length}
              className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] text-[var(--gray)] disabled:opacity-40"
            >
              Undo
            </button>
            <button
              onClick={clear}
              disabled={!strokes.length}
              className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] text-[var(--gray)] disabled:opacity-40"
            >
              Clear
            </button>
          </div>
        </div>

        {/* Canvas */}
        <div className="flex-1 overflow-auto bg-black/40 flex items-center justify-center p-4">
          {!imgLoaded && !error && (
            <p className="text-sm text-[var(--gray-muted)]">Loading photo…</p>
          )}
          {error && (
            <p className="text-sm text-red-300">{error}</p>
          )}
          {imgLoaded && (
            <canvas
              ref={canvasRef}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              className="max-w-full max-h-full touch-none cursor-crosshair rounded-lg shadow-lg"
              style={{ background: "#000" }}
            />
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-[var(--border-glass)] flex items-center justify-end gap-3">
          {error && <span className="text-xs text-red-300 mr-auto">{error}</span>}
          <button
            onClick={onClose}
            className="text-sm font-semibold px-4 py-2 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] text-[var(--gray)]"
          >
            Cancel
          </button>
          <button
            onClick={save}
            disabled={!imgLoaded || saving || !strokes.length}
            className="text-sm font-semibold px-5 py-2 rounded-xl bg-gradient-to-r from-[var(--pink)] via-[var(--purple)] to-[var(--blue)] hover:shadow-[var(--shadow-glow-pink)] text-white disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save markup"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ToolBtn({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      className={`text-xs font-semibold px-3 py-1.5 rounded-md transition-colors ${
        active
          ? "bg-[var(--cyan)]/20 text-[var(--cyan)]"
          : "text-[var(--gray-muted)] hover:text-white"
      }`}
    >
      {label}
    </button>
  );
}

function drawStroke(ctx: CanvasRenderingContext2D, s: Stroke) {
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = s.color;
  ctx.lineWidth = s.width;
  if (s.type === "pen") {
    if (s.points.length < 2) return;
    ctx.beginPath();
    ctx.moveTo(s.points[0][0], s.points[0][1]);
    for (let i = 1; i < s.points.length; i++) ctx.lineTo(s.points[i][0], s.points[i][1]);
    ctx.stroke();
    return;
  }
  if (s.type === "circle") {
    ctx.beginPath();
    ctx.arc(s.center[0], s.center[1], s.radius, 0, Math.PI * 2);
    ctx.stroke();
    return;
  }
  // arrow
  const [x1, y1] = s.from;
  const [x2, y2] = s.to;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
  const angle = Math.atan2(y2 - y1, x2 - x1);
  const head = Math.max(12, s.width * 3);
  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(x2 - head * Math.cos(angle - Math.PI / 6), y2 - head * Math.sin(angle - Math.PI / 6));
  ctx.lineTo(x2 - head * Math.cos(angle + Math.PI / 6), y2 - head * Math.sin(angle + Math.PI / 6));
  ctx.closePath();
  ctx.fillStyle = s.color;
  ctx.fill();
}
