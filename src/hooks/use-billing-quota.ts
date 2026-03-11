"use client";

import { useState, useEffect } from "react";
import type { BillingQuota } from "@/types/billing";

export function useBillingQuota() {
  const [billing, setBilling] = useState<BillingQuota | null>(null);

  useEffect(() => {
    fetch("/api/billing/check-quota")
      .then((r) => r.json())
      .then((data) => setBilling(data))
      .catch((err) => console.error("Failed to load billing:", err));
  }, []);

  return billing;
}
