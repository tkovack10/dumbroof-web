"use client";

import { useState, useEffect, useMemo, useCallback, type ReactNode } from "react";
import { createClient } from "@/lib/supabase/client";

interface Props {
  filePath: string;
  measurementFiles?: string[] | null;
  scopeFiles?: string[] | null;
  weatherFiles?: string[] | null;
  otherFiles?: string[] | null;
  cocFiles?: string[] | null;
  aobFiles?: string[] | null;
}

interface DocCategory {
  key: string;
  label: string;
  folder: string;
  files: string[];
  icon: ReactNode;
  color: string;
}

export function UploadedDocuments({ filePath, measurementFiles, scopeFiles, weatherFiles, otherFiles, cocFiles, aobFiles }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [signedUrls, setSignedUrls] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const supabase = useMemo(() => createClient(), []);

  const categories: DocCategory[] = useMemo(() => {
    const cats: DocCategory[] = [];

    if (measurementFiles && measurementFiles.length > 0) {
      cats.push({
        key: "measurements",
        label: "Measurements",
        folder: "measurements",
        files: measurementFiles,
        color: "text-blue-400",
        icon: (
          <svg className="w-4 h-4 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3v11.25A2.25 2.25 0 006 16.5h2.25M3.75 3h-1.5m1.5 0h16.5m0 0h1.5m-1.5 0v11.25A2.25 2.25 0 0118 16.5h-2.25m-7.5 0h7.5m-7.5 0l-1 3m8.5-3l1 3m0 0l.5 1.5m-.5-1.5h-9.5m0 0l-.5 1.5" />
          </svg>
        ),
      });
    }

    if (scopeFiles && scopeFiles.length > 0) {
      cats.push({
        key: "scope",
        label: "Carrier Scope",
        folder: "scope",
        files: scopeFiles,
        color: "text-amber-400",
        icon: (
          <svg className="w-4 h-4 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
          </svg>
        ),
      });
    }

    if (weatherFiles && weatherFiles.length > 0) {
      cats.push({
        key: "weather",
        label: "Weather Reports",
        folder: "weather",
        files: weatherFiles,
        color: "text-cyan-400",
        icon: (
          <svg className="w-4 h-4 text-cyan-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15a4.5 4.5 0 004.5 4.5H18a3.75 3.75 0 001.332-7.257 3 3 0 00-3.758-3.848 5.25 5.25 0 00-10.233 2.33A4.502 4.502 0 002.25 15z" />
          </svg>
        ),
      });
    }

    if (otherFiles && otherFiles.length > 0) {
      cats.push({
        key: "other",
        label: "Other Documents",
        folder: "other",
        files: otherFiles,
        color: "text-[var(--gray)]",
        icon: (
          <svg className="w-4 h-4 text-[var(--gray)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
          </svg>
        ),
      });
    }

    if (aobFiles && aobFiles.length > 0) {
      cats.push({
        key: "aob",
        label: "AOB / Contingency",
        folder: "aob",
        files: aobFiles,
        color: "text-amber-400",
        icon: (
          <svg className="w-4 h-4 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />
          </svg>
        ),
      });
    }

    if (cocFiles && cocFiles.length > 0) {
      cats.push({
        key: "coc",
        label: "Certificate of Completion",
        folder: "coc",
        files: cocFiles,
        color: "text-purple-400",
        icon: (
          <svg className="w-4 h-4 text-purple-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12c0 1.268-.63 2.39-1.593 3.068a3.745 3.745 0 01-1.043 3.296 3.745 3.745 0 01-3.296 1.043A3.745 3.745 0 0112 21c-1.268 0-2.39-.63-3.068-1.593a3.746 3.746 0 01-3.296-1.043 3.745 3.745 0 01-1.043-3.296A3.745 3.745 0 013 12c0-1.268.63-2.39 1.593-3.068a3.745 3.745 0 011.043-3.296 3.746 3.746 0 013.296-1.043A3.746 3.746 0 0112 3c1.268 0 2.39.63 3.068 1.593a3.746 3.746 0 013.296 1.043 3.746 3.746 0 011.043 3.296A3.745 3.745 0 0121 12z" />
          </svg>
        ),
      });
    }

    return cats;
  }, [measurementFiles, scopeFiles, weatherFiles, otherFiles, cocFiles, aobFiles]);

  const totalFiles = categories.reduce((sum, c) => sum + c.files.length, 0);

  const fetchSignedUrls = useCallback(async () => {
    if (totalFiles === 0) return;
    setLoading(true);
    const allPaths = categories.flatMap(cat =>
      cat.files.map(f => ({ key: `${cat.folder}/${f}`, path: `${filePath}/${cat.folder}/${f}` }))
    );
    const urls: Record<string, string> = {};
    try {
      const { data } = await supabase.storage
        .from("claim-documents")
        .createSignedUrls(allPaths.map(p => p.path), 3600);
      if (data) {
        data.forEach((item, i) => {
          if (item.signedUrl) urls[allPaths[i].key] = item.signedUrl;
        });
      }
    } catch { /* ignore */ }
    setSignedUrls(urls);
    setLoading(false);
  }, [categories, filePath, supabase, totalFiles]);

  useEffect(() => {
    if (expanded && Object.keys(signedUrls).length === 0) {
      fetchSignedUrls();
    }
  }, [expanded, signedUrls, fetchSignedUrls]);

  if (totalFiles === 0) return null;

  return (
    <div className="glass-card overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between p-6 hover:bg-white/[0.02] transition-colors"
      >
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-white/5 flex items-center justify-center">
            <svg className="w-5 h-5 text-[var(--gray)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" />
            </svg>
          </div>
          <div className="text-left">
            <h3 className="text-sm font-semibold text-[var(--white)]">Source Documents</h3>
            <p className="text-xs text-[var(--gray-muted)]">
              {totalFiles} uploaded document{totalFiles !== 1 ? "s" : ""} — EagleView, carrier scope, weather reports
            </p>
          </div>
        </div>
        <svg className={`w-5 h-5 text-[var(--gray-muted)] transition-transform ${expanded ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {expanded && (
        <div className="px-4 sm:px-6 pb-6 border-t border-white/[0.06]">
          {loading ? (
            <div className="py-4 text-center">
              <div className="w-6 h-6 border-2 border-[var(--cyan)] border-t-transparent rounded-full animate-spin mx-auto mb-2" />
              <p className="text-xs text-[var(--gray-muted)]">Loading documents...</p>
            </div>
          ) : (
            <div className="space-y-4 mt-4">
              {categories.map((cat) => (
                <div key={cat.key}>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--gray-muted)] mb-2 flex items-center gap-1.5">
                    {cat.icon}
                    {cat.label} ({cat.files.length})
                  </p>
                  <div className="space-y-1">
                    {cat.files.map((file) => {
                      const url = signedUrls[`${cat.folder}/${file}`];
                      return (
                        <div
                          key={file}
                          className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg bg-white/[0.03] hover:bg-white/[0.06] transition-colors"
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <svg className="w-4 h-4 text-[var(--gray-dim)] shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                            </svg>
                            <span className="text-sm text-[var(--gray)] truncate">{file}</span>
                          </div>
                          {url ? (
                            <a
                              href={url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-xs text-[var(--cyan)] hover:text-white font-semibold shrink-0 transition-colors"
                            >
                              View
                            </a>
                          ) : (
                            <span className="text-xs text-[var(--gray-dim)]">...</span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
