"use client";

import { useState } from "react";

type Status = "idle" | "loading" | "done" | "error";

const BTN =
  "inline-flex items-center justify-center rounded-lg bg-[#0d2137] px-6 py-3 text-sm font-semibold text-white transition hover:bg-[#0a1a2c] disabled:opacity-60";

/**
 * Token path: a single confirm button (no auto-opt-out on load, so email
 * link-scanners can't unsubscribe people by prefetch). Email path: an address
 * entry form. Both POST /api/unsubscribe.
 */
export function UnsubscribeForm({ token, email }: { token?: string; email?: string }) {
  const [status, setStatus] = useState<Status>("idle");
  const [typedEmail, setTypedEmail] = useState("");

  async function submit(body: Record<string, string>) {
    setStatus("loading");
    try {
      const res = await fetch("/api/unsubscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await res.json()) as { ok?: boolean };
      setStatus(json.ok ? "done" : "error");
    } catch {
      setStatus("error");
    }
  }

  if (status === "done") {
    return (
      <div className="rounded-xl border border-green-200 bg-green-50 p-6">
        <p className="text-base font-semibold text-green-900">You&rsquo;re unsubscribed.</p>
        <p className="mt-2 text-sm text-green-800">
          {token
            ? "You won't get any more reactivation or storm-alert emails from DumbRoof."
            : "If that address was on our list, it's been removed. You won't get any more reactivation or storm-alert emails."}
        </p>
        <p className="mt-4 text-sm text-gray-600">
          Changed your mind?{" "}
          <a href="mailto:tom@dumbroof.ai?subject=Resubscribe" className="font-medium text-[#0d2137] underline">
            Email us
          </a>{" "}
          and we&rsquo;ll turn them back on. Your account and claims are untouched either way.
        </p>
      </div>
    );
  }

  // Token present → confirm button.
  if (token) {
    return (
      <div>
        <p className="text-gray-700 leading-relaxed">
          {email ? (
            <>
              Unsubscribe <span className="font-medium text-gray-900">{email}</span> from DumbRoof
              reactivation and storm-alert emails?
            </>
          ) : (
            <>Unsubscribe from DumbRoof reactivation and storm-alert emails?</>
          )}
        </p>
        <div className="mt-6">
          <button
            type="button"
            disabled={status === "loading"}
            onClick={() => submit({ token })}
            className={BTN}
          >
            {status === "loading" ? "Unsubscribing…" : "Confirm unsubscribe"}
          </button>
        </div>
        {status === "error" && (
          <p className="mt-4 text-sm text-red-600">
            Something went wrong. Please email{" "}
            <a href="mailto:tom@dumbroof.ai" className="underline">
              tom@dumbroof.ai
            </a>{" "}
            and we&rsquo;ll remove you.
          </p>
        )}
        <p className="mt-6 text-sm text-gray-500">
          This only stops marketing emails. Claim notifications and your account are unaffected.
        </p>
      </div>
    );
  }

  // No token → email entry form.
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (typedEmail.includes("@")) submit({ email: typedEmail });
      }}
    >
      <p className="text-gray-700 leading-relaxed">
        Enter the email address you&rsquo;d like to unsubscribe from DumbRoof reactivation and
        storm-alert emails.
      </p>
      <div className="mt-6 flex flex-col gap-3 sm:flex-row">
        <input
          type="email"
          required
          value={typedEmail}
          onChange={(e) => setTypedEmail(e.target.value)}
          placeholder="you@company.com"
          className="w-full rounded-lg border border-gray-300 px-4 py-3 text-sm text-gray-900 outline-none focus:border-[#0d2137] focus:ring-1 focus:ring-[#0d2137]"
        />
        <button type="submit" disabled={status === "loading"} className={BTN}>
          {status === "loading" ? "Unsubscribing…" : "Unsubscribe"}
        </button>
      </div>
      {status === "error" && (
        <p className="mt-4 text-sm text-red-600">
          Something went wrong. Please email{" "}
          <a href="mailto:tom@dumbroof.ai" className="underline">
            tom@dumbroof.ai
          </a>{" "}
          and we&rsquo;ll remove you.
        </p>
      )}
      <p className="mt-6 text-sm text-gray-500">
        This only stops marketing emails. Claim notifications and your account are unaffected.
      </p>
    </form>
  );
}
