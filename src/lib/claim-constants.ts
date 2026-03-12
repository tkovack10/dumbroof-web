export type UploadCategory = "photos" | "measurements" | "scope" | "weather" | "other";

export const CATEGORY_CONFIG: Record<
  UploadCategory,
  { label: string; description: string; accept: string; multiple: boolean; dbField: string; folder: string }
> = {
  photos: {
    label: "Photos",
    description: "Inspection photos, construction photos, damage close-ups. ZIP/PDF also supported.",
    accept: ".jpg,.jpeg,.png,.heic,.heif,.webp,.tiff,.tif,.bmp,.pdf,.zip",
    multiple: true,
    dbField: "photo_files",
    folder: "photos",
  },
  measurements: {
    label: "Measurements",
    description: "EagleView report, roof measurements, or satellite measurement PDF",
    accept: ".pdf,.jpg,.jpeg,.png,.zip",
    multiple: true,
    dbField: "measurement_files",
    folder: "measurements",
  },
  scope: {
    label: "Carrier Scope",
    description: "Insurance company estimate, adjuster report, or revised scope",
    accept: ".pdf",
    multiple: true,
    dbField: "scope_files",
    folder: "scope",
  },
  weather: {
    label: "Weather Data",
    description: "HailTrace report, NOAA data, or storm documentation",
    accept: ".pdf,.jpg,.jpeg,.png,.heic,.heif,.webp,.tiff,.tif,.bmp,.zip",
    multiple: true,
    dbField: "weather_files",
    folder: "weather",
  },
  other: {
    label: "Other",
    description: "Email screenshots, adjuster correspondence, change orders, etc.",
    accept: ".pdf,.jpg,.jpeg,.png,.heic,.heif,.webp,.tiff,.tif,.bmp,.doc,.docx,.zip",
    multiple: true,
    dbField: "other_files",
    folder: "other",
  },
};

export const FILE_CATEGORIES = [
  { key: "measurement_files" as const, label: "Measurements", folder: "measurements", color: "bg-blue-50 text-blue-700 border-blue-200" },
  { key: "photo_files" as const, label: "Photos", folder: "photos", color: "bg-purple-50 text-purple-700 border-purple-200" },
  { key: "scope_files" as const, label: "Scope", folder: "scope", color: "bg-amber-50 text-amber-700 border-amber-200" },
  { key: "weather_files" as const, label: "Weather", folder: "weather", color: "bg-teal-50 text-teal-700 border-teal-200" },
  { key: "other_files" as const, label: "Other", folder: "other", color: "bg-gray-100 text-gray-600 border-gray-200" },
];

export const CLAIM_STATUS_CONFIG: Record<string, { color: string; label: string; bg: string }> = {
  uploaded: { color: "text-blue-700", label: "Uploaded", bg: "bg-blue-100" },
  processing: { color: "text-amber-700", label: "Processing", bg: "bg-amber-100" },
  ready: { color: "text-green-700", label: "Ready", bg: "bg-green-100" },
  needs_improvement: { color: "text-orange-700", label: "Needs Improvement", bg: "bg-orange-100" },
  error: { color: "text-red-700", label: "Error", bg: "bg-red-100" },
};

export const SEVERITY_COLORS: Record<string, string> = {
  minor: "bg-yellow-100 text-yellow-700",
  moderate: "bg-orange-100 text-orange-700",
  severe: "bg-red-100 text-red-800",
  catastrophic: "bg-red-200 text-red-900",
};

// Map folder name → DB field name
export const FOLDER_TO_DB_FIELD: Record<string, string> = {
  photos: "photo_files",
  measurements: "measurement_files",
  scope: "scope_files",
  weather: "weather_files",
  other: "other_files",
};

// ========== Repair Constants ==========

export const REPAIR_TYPE_LABELS: Record<string, string> = {
  // 22-code system
  "CHM-FRONT": "Chimney Apron",
  "CHM-SIDE": "Chimney Step/Counter Flash",
  "CHM-BACK": "Chimney Back Pan/Cricket",
  "CHM-MASONRY": "Chimney Masonry",
  "WALL-STEP": "Sidewall Step Flashing",
  "WALL-KICKOUT": "Kickout Diverter",
  "HEADWALL": "Headwall/Dormer Flashing",
  "STUCCO-ABOVE-ROOF": "Wall Drainage Failure",
  "VENT-BOOT": "Vent Boot/Collar",
  "VENT-METAL": "Metal Vent/Roof Jack",
  "SKYLIGHT-FLASH": "Skylight Flashing",
  "SKYLIGHT-UNIT": "Skylight Unit/Curb",
  "VALLEY-OPEN-METAL": "Open Metal Valley",
  "VALLEY-CLOSED-CUT": "Closed-Cut Valley",
  "VALLEY-DEBRIS-ICE": "Valley Debris/Ice",
  "EAVE-ICE-DAM": "Ice Dam",
  "EAVE-DRIP-EDGE": "Drip Edge/Edge Failure",
  "GUTTER-BACKUP": "Gutter Overflow",
  "FIELD-SHINGLE": "Field Shingle Damage",
  "NAIL-POP": "Fastener Failure",
  "CONDENSATION": "Attic Condensation",
  "LOW-CONFIDENCE-VERIFY": "Needs Verification",
  // Legacy codes (backward compat)
  pipe_boot: "Pipe Boot",
  step_flashing: "Step Flashing",
  chimney_flashing: "Chimney Flashing",
  exposed_nails: "Exposed Nails",
  missing_shingles: "Missing Shingles",
  valley_leak: "Valley Leak",
  vent_boot: "Vent Boot",
  skylight_flashing: "Skylight Flashing",
  ridge_cap: "Ridge Cap",
  ice_dam: "Ice Dam",
  temporary_tarp: "Temp Tarp",
};

export const REPAIR_SEVERITY_COLORS: Record<string, string> = {
  minor: "bg-green-100 text-green-700",
  moderate: "bg-amber-100 text-amber-700",
  major: "bg-orange-100 text-orange-700",
  critical: "bg-red-100 text-red-700",
  emergency: "bg-red-200 text-red-800",
};

export const REPAIR_STATUS_CONFIG: Record<string, { color: string; label: string }> = {
  uploaded: { color: "bg-blue-100 text-blue-700", label: "Queued" },
  processing: { color: "bg-amber-100 text-amber-700", label: "Diagnosing" },
  ready: { color: "bg-green-100 text-green-700", label: "Ready" },
  error: { color: "bg-red-100 text-red-700", label: "Error" },
};
