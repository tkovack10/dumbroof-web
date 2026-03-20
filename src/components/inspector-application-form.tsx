"use client";

import { useState } from "react";

interface InspectorApplicationFormProps {
  className?: string;
}

export function InspectorApplicationForm({ className }: InspectorApplicationFormProps) {
  const [form, setForm] = useState({
    name: "",
    email: "",
    phone: "",
    city: "",
    state: "",
    experience: "",
    haagCertified: "",
    willingToTravel: "",
    notes: "",
  });
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError("");

    try {
      const res = await fetch("/api/inspector-apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          email: form.email,
          phone: form.phone,
          city: form.city,
          state: form.state,
          experience: form.experience,
          haag_certified: form.haagCertified,
          willing_to_travel: form.willingToTravel,
          notes: form.notes || null,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Submission failed");
      window.fbq?.("track", "SubmitApplication");
      setSubmitted(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Submission failed. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const update = (field: string, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  if (submitted) {
    return (
      <div className={`bg-white/[0.03] rounded-2xl p-8 border border-white/[0.04] text-center ${className || ""}`}>
        <div className="w-16 h-16 rounded-full bg-green-500/10 flex items-center justify-center mx-auto mb-6">
          <svg className="w-8 h-8 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <h3 className="text-xl font-bold text-[var(--navy)] mb-2">Application Received</h3>
        <p className="text-[var(--gray-muted)] mb-1">
          We&apos;ll review your application and reach out within 48 hours.
        </p>
        <p className="text-sm text-[var(--gray-dim)]">
          Welcome to the network, {form.name.split(" ")[0] || "Inspector"}.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className={`bg-white/[0.03] rounded-2xl p-8 border border-white/[0.04] space-y-5 ${className || ""}`}>
      <h3 className="text-lg font-bold text-[var(--navy)]">Apply to Join</h3>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-semibold text-[var(--gray-muted)] uppercase tracking-wider mb-1.5">Full Name</label>
          <input type="text" required value={form.name} onChange={(e) => update("name", e.target.value)}
            className="w-full px-4 py-3 rounded-lg border border-[var(--border-glass)] focus:border-[var(--navy)] focus:ring-1 focus:ring-[var(--navy)] outline-none text-sm" />
        </div>
        <div>
          <label className="block text-xs font-semibold text-[var(--gray-muted)] uppercase tracking-wider mb-1.5">Phone</label>
          <input type="tel" required value={form.phone} onChange={(e) => update("phone", e.target.value)}
            className="w-full px-4 py-3 rounded-lg border border-[var(--border-glass)] focus:border-[var(--navy)] focus:ring-1 focus:ring-[var(--navy)] outline-none text-sm" />
        </div>
      </div>

      <div>
        <label className="block text-xs font-semibold text-[var(--gray-muted)] uppercase tracking-wider mb-1.5">Email</label>
        <input type="email" required value={form.email} onChange={(e) => update("email", e.target.value)}
          placeholder="you@example.com"
          className="w-full px-4 py-3 rounded-lg border border-[var(--border-glass)] focus:border-[var(--navy)] focus:ring-1 focus:ring-[var(--navy)] outline-none text-sm" />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-semibold text-[var(--gray-muted)] uppercase tracking-wider mb-1.5">City</label>
          <input type="text" required value={form.city} onChange={(e) => update("city", e.target.value)}
            className="w-full px-4 py-3 rounded-lg border border-[var(--border-glass)] focus:border-[var(--navy)] focus:ring-1 focus:ring-[var(--navy)] outline-none text-sm" />
        </div>
        <div>
          <label className="block text-xs font-semibold text-[var(--gray-muted)] uppercase tracking-wider mb-1.5">State</label>
          <input type="text" required value={form.state} onChange={(e) => update("state", e.target.value)}
            placeholder="e.g. TX, FL, NY"
            className="w-full px-4 py-3 rounded-lg border border-[var(--border-glass)] focus:border-[var(--navy)] focus:ring-1 focus:ring-[var(--navy)] outline-none text-sm" />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-semibold text-[var(--gray-muted)] uppercase tracking-wider mb-1.5">Years of Experience</label>
          <select required value={form.experience} onChange={(e) => update("experience", e.target.value)}
            className="w-full px-4 py-3 rounded-lg border border-[var(--border-glass)] focus:border-[var(--navy)] focus:ring-1 focus:ring-[var(--navy)] outline-none text-sm bg-white">
            <option value="">Select</option>
            <option value="1-3">1 - 3 years</option>
            <option value="3-5">3 - 5 years</option>
            <option value="5-10">5 - 10 years</option>
            <option value="10+">10+ years</option>
          </select>
        </div>
        <div>
          <label className="block text-xs font-semibold text-[var(--gray-muted)] uppercase tracking-wider mb-1.5">HAAG Certified?</label>
          <select required value={form.haagCertified} onChange={(e) => update("haagCertified", e.target.value)}
            className="w-full px-4 py-3 rounded-lg border border-[var(--border-glass)] focus:border-[var(--navy)] focus:ring-1 focus:ring-[var(--navy)] outline-none text-sm bg-white">
            <option value="">Select</option>
            <option value="yes">Yes &mdash; HAAG Certified</option>
            <option value="in-progress">In Progress</option>
            <option value="no">No &mdash; Field Experience Only</option>
          </select>
        </div>
      </div>

      <div>
        <label className="block text-xs font-semibold text-[var(--gray-muted)] uppercase tracking-wider mb-1.5">
          Willing to Travel?
          <span className="ml-1 text-[var(--red)]">*</span>
        </label>
        <select required value={form.willingToTravel} onChange={(e) => update("willingToTravel", e.target.value)}
          className="w-full px-4 py-3 rounded-lg border border-[var(--border-glass)] focus:border-[var(--navy)] focus:ring-1 focus:ring-[var(--navy)] outline-none text-sm bg-white">
          <option value="">Select travel radius</option>
          <option value="local">Local only (within 50 miles)</option>
          <option value="regional">Regional (within 150 miles)</option>
          <option value="state">Anywhere in my state</option>
          <option value="multi-state">Multi-state / neighboring states</option>
          <option value="nationwide">Nationwide &mdash; will travel anywhere</option>
        </select>
      </div>

      <div>
        <label className="block text-xs font-semibold text-[var(--gray-muted)] uppercase tracking-wider mb-1.5">
          Anything else we should know?
        </label>
        <textarea value={form.notes} onChange={(e) => update("notes", e.target.value)}
          rows={3} placeholder="Certifications, specialties (tile, slate, metal, commercial), current employer, etc."
          className="w-full px-4 py-3 rounded-lg border border-[var(--border-glass)] focus:border-[var(--navy)] focus:ring-1 focus:ring-[var(--navy)] outline-none text-sm resize-none" />
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/20 text-red-400 text-sm rounded-lg px-4 py-3">
          {error}
        </div>
      )}

      <button type="submit" disabled={submitting}
        className="w-full bg-[var(--navy)] hover:bg-[var(--navy-light)] disabled:opacity-50 disabled:cursor-not-allowed text-white py-4 rounded-xl font-semibold transition-colors">
        {submitting ? (
          <span className="flex items-center justify-center gap-2">
            <svg className="animate-spin w-5 h-5" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
            Submitting...
          </span>
        ) : "Submit Application"}
      </button>

      <p className="text-xs text-[var(--gray-dim)] text-center leading-relaxed">
        We review every application within 48 hours.
        All inspectors must carry valid 1099 insurance to be activated on the network.
      </p>
    </form>
  );
}
