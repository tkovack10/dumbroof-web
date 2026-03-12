/**
 * Get the backend URL for Railway-deployed processor.
 * Client-side: reads NEXT_PUBLIC_BACKEND_URL env var.
 * Falls back to production Railway URL.
 */
export function getBackendUrl(): string {
  return (
    process.env.NEXT_PUBLIC_BACKEND_URL ||
    "https://dumbroof-backend-production.up.railway.app"
  );
}
