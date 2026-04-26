"use client";

import { useState } from "react";
import { AdminBrainChat } from "@/components/admin-brain-chat";
import { RichardIcon } from "@/components/richard-icon";

type RichardScope = "user" | "company";

interface RichardLauncherProps {
  userId: string;
  scope?: RichardScope;
  initiallyOpen?: boolean;
}

export function RichardLauncher({ userId, scope = "user", initiallyOpen = false }: RichardLauncherProps) {
  const [open, setOpen] = useState(initiallyOpen);

  const label = scope === "company" ? "Richard — Company" : "Richard";

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-5 right-5 z-50 flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white pl-2 pr-4 py-2 rounded-full shadow-lg shadow-indigo-500/30 transition-colors"
        aria-label={`Open ${label}`}
      >
        <RichardIcon size={28} />
        <span className="text-sm font-medium">{label}</span>
      </button>
    );
  }

  // AdminBrainChat owns its own header (title + Reset). To avoid a duplicate
  // header bar, the launcher renders a small floating × overlay instead.
  return (
    <div className="fixed bottom-5 right-5 z-50 w-[380px] max-w-[calc(100vw-2.5rem)] shadow-2xl shadow-black/50">
      <button
        onClick={() => setOpen(false)}
        className="absolute -top-2 -right-2 z-10 w-7 h-7 rounded-full bg-[rgb(15,18,35)] border border-white/15 text-white/60 hover:text-white hover:border-white/40 text-sm flex items-center justify-center shadow-md transition-colors"
        aria-label={`Close ${label}`}
      >
        ×
      </button>
      <AdminBrainChat userId={userId} scope={scope} />
    </div>
  );
}
