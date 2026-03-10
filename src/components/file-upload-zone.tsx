"use client";

import { useCallback, useState } from "react";

interface FileUploadZoneProps {
  label: string;
  description: string;
  accept: string;
  multiple?: boolean;
  required?: boolean;
  files: File[];
  onFilesChange: (files: File[]) => void;
}

export function FileUploadZone({
  label,
  description,
  accept,
  multiple = false,
  required = false,
  files,
  onFilesChange,
}: FileUploadZoneProps) {
  const [isDragging, setIsDragging] = useState(false);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      const dropped = Array.from(e.dataTransfer.files);
      if (multiple) {
        onFilesChange([...files, ...dropped]);
      } else {
        onFilesChange(dropped.slice(0, 1));
      }
    },
    [files, multiple, onFilesChange]
  );

  const handleSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files) return;
    const selected = Array.from(e.target.files);
    if (multiple) {
      onFilesChange([...files, ...selected]);
    } else {
      onFilesChange(selected.slice(0, 1));
    }
  };

  const removeFile = (index: number) => {
    onFilesChange(files.filter((_, i) => i !== index));
  };

  const FILE_SIZE_WARNING_MB = 45;
  const largeFiles = files.filter((f) => f.size > FILE_SIZE_WARNING_MB * 1024 * 1024);

  return (
    <div className="space-y-2">
      <div className="flex items-baseline gap-2">
        <label className="block text-sm font-semibold text-[var(--navy)]">
          {label}
        </label>
        {required ? (
          <span className="text-xs text-[var(--red)] font-medium">Required</span>
        ) : (
          <span className="text-xs text-gray-400 font-medium">Optional</span>
        )}
      </div>
      <p className="text-xs text-gray-500 mb-2">{description}</p>

      {largeFiles.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          <p className="text-xs text-amber-700 font-medium">
            {largeFiles.length === 1
              ? `"${largeFiles[0].name}" is ${(largeFiles[0].size / 1024 / 1024).toFixed(0)}MB.`
              : `${largeFiles.length} files exceed ${FILE_SIZE_WARNING_MB}MB.`}{" "}
            ZIP files will be automatically extracted — individual photos upload faster and more reliably.
          </p>
        </div>
      )}

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        className={`relative border-2 border-dashed rounded-xl p-6 text-center transition-colors cursor-pointer ${
          isDragging
            ? "border-[var(--red)] bg-red-50/50"
            : files.length > 0
              ? "border-green-300 bg-green-50/30"
              : "border-gray-200 hover:border-gray-300 bg-white"
        }`}
      >
        <input
          type="file"
          accept={accept}
          multiple={multiple}
          onChange={handleSelect}
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
        />

        {files.length === 0 ? (
          <div>
            <svg
              className="w-8 h-8 text-gray-300 mx-auto mb-2"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.5}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5"
              />
            </svg>
            <p className="text-sm text-gray-500">
              Drag & drop or <span className="text-[var(--red)] font-medium">browse</span>
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {files.map((file, i) => (
              <div
                key={`${file.name}-${i}`}
                className="flex items-center justify-between bg-white border border-gray-100 rounded-lg px-3 py-2 text-left"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <svg
                    className="w-4 h-4 text-green-500 shrink-0"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M9 12l2 2 4-4"
                    />
                  </svg>
                  <span className="text-sm text-gray-700 truncate">
                    {file.name}
                  </span>
                  <span className="text-xs text-gray-400 shrink-0">
                    {(file.size / 1024 / 1024).toFixed(1)} MB
                  </span>
                </div>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    removeFile(i);
                  }}
                  className="text-gray-400 hover:text-red-500 ml-2 shrink-0"
                >
                  <svg
                    className="w-4 h-4"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M6 18L18 6M6 6l12 12"
                    />
                  </svg>
                </button>
              </div>
            ))}
            <p className="text-xs text-gray-400 pt-1">
              {multiple ? "Drop more files or click to add" : "Click to replace"}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
