import type { Metadata } from "next";
import { verifyUnsubToken } from "@/lib/unsubscribe";
import { UnsubscribeForm } from "./unsubscribe-client";

export const metadata: Metadata = {
  title: "Unsubscribe | DumbRoof",
  description: "Unsubscribe from DumbRoof reactivation and storm-alert emails.",
  robots: { index: false, follow: false },
};

// Next 15: searchParams is async.
export default async function UnsubscribePage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  // Decode (server-side) only to show the email; the actual opt-out happens on
  // the explicit POST from the confirm button. An invalid token falls back to
  // the email-entry form rather than erroring.
  const payload = token ? verifyUnsubToken(token) : null;
  const validToken = payload ? token : undefined;

  return (
    <div className="min-h-screen bg-white">
      <div className="mx-auto max-w-xl px-6 py-20">
        <h1 className="text-3xl font-bold text-gray-900">Unsubscribe</h1>
        <p className="mt-2 mb-10 text-sm text-gray-500">DumbRoof email preferences</p>
        <UnsubscribeForm token={validToken} email={payload?.e} />
      </div>
    </div>
  );
}
