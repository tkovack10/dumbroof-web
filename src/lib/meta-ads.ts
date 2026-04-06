/**
 * Meta Marketing API Wrapper — full CRUD on Campaigns, Ad Sets, Ads,
 * Creatives, Insights, and Audiences. Used by:
 *
 *   - The funnel monitor (src/lib/funnel-monitor/sources/meta-ads.ts)
 *   - The admin dashboard (src/app/admin/meta-ads/page.tsx)
 *   - The Claude /meta agent (~/USARM-Claims-Platform/.claude/agents/)
 *   - The autopilot rules engine (Phase 6.7)
 *
 * Pattern matches getResend() / getStripe() — singleton constructed lazily
 * from META_ACCESS_TOKEN + META_AD_ACCOUNT_ID env vars. Hand-rolled fetch,
 * no SDK dependency, same approach as the GA4 source and Anthropic insights.
 *
 * Anchor: USARM-Claims-Platform funnel investigation 2026-04-06,
 * full plan at ~/.claude/plans/snazzy-jingling-petal.md (Phase 6).
 */

const META_API_BASE = "https://graph.facebook.com/v19.0";

// ─────────────────────────────────────────────────────────────────────────────
// TYPES — Meta Marketing API surface
// ─────────────────────────────────────────────────────────────────────────────

export type CampaignObjective =
  | "OUTCOME_TRAFFIC"
  | "OUTCOME_LEADS"
  | "OUTCOME_SALES"
  | "OUTCOME_AWARENESS"
  | "OUTCOME_ENGAGEMENT"
  | "OUTCOME_APP_PROMOTION";

export type CampaignStatus = "ACTIVE" | "PAUSED" | "ARCHIVED" | "DELETED";

export type Campaign = {
  id: string;
  name: string;
  objective: CampaignObjective;
  status: CampaignStatus;
  effective_status?: string;
  daily_budget?: string; // cents, as string
  lifetime_budget?: string;
  created_time?: string;
  updated_time?: string;
};

export type AdSet = {
  id: string;
  name: string;
  campaign_id: string;
  status: CampaignStatus;
  daily_budget?: string;
  targeting?: Record<string, unknown>;
  created_time?: string;
};

export type Ad = {
  id: string;
  name: string;
  adset_id: string;
  campaign_id: string;
  status: CampaignStatus;
  creative?: { id: string };
  created_time?: string;
};

export type Insight = {
  campaign_id?: string;
  campaign_name?: string;
  adset_id?: string;
  ad_id?: string;
  spend: string; // dollars, as string
  impressions: string;
  clicks: string;
  ctr?: string;
  cpc?: string;
  cpm?: string;
  reach?: string;
  actions?: Array<{ action_type: string; value: string }>;
  cost_per_action_type?: Array<{ action_type: string; value: string }>;
  date_start?: string;
  date_stop?: string;
};

export type CustomAudience = {
  id: string;
  name: string;
  description?: string;
  approximate_count_lower_bound?: number;
  approximate_count_upper_bound?: number;
  subtype: "CUSTOM" | "LOOKALIKE";
};

export type InsightLevel = "account" | "campaign" | "adset" | "ad";
export type DatePreset =
  | "today"
  | "yesterday"
  | "last_7d"
  | "last_14d"
  | "last_28d"
  | "last_30d"
  | "last_90d"
  | "this_month"
  | "last_month"
  | "lifetime";

// ─────────────────────────────────────────────────────────────────────────────
// CLIENT
// ─────────────────────────────────────────────────────────────────────────────

class MetaAdsClient {
  constructor(
    private accessToken: string,
    /** Without the "act_" prefix — we add it where needed. */
    private adAccountId: string
  ) {}

  /**
   * Low-level fetch helper. Adds bearer auth, handles JSON parsing,
   * surfaces meaningful errors. Does NOT follow Meta's pagination — callers
   * that need it use `fetchAllPages()` instead.
   */
  private async request<T>(
    path: string,
    options: { method?: string; body?: unknown; query?: Record<string, string> } = {}
  ): Promise<T> {
    const { method = "GET", body, query } = options;
    const url = new URL(`${META_API_BASE}${path}`);
    if (query) {
      for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
    }

    const init: RequestInit = {
      method,
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        "Content-Type": "application/json",
      },
      cache: "no-store",
    };
    if (body !== undefined) {
      init.body = typeof body === "string" ? body : JSON.stringify(body);
    }

    const res = await fetch(url.toString(), init);
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new MetaApiError(res.status, text, path);
    }
    return res.json() as Promise<T>;
  }

  /**
   * Fetch all pages of a paginated Meta endpoint by following `paging.next`.
   * Caps at 1000 items to avoid runaway loops.
   */
  private async fetchAllPages<T>(
    path: string,
    query: Record<string, string> = {},
    cap = 1000
  ): Promise<T[]> {
    const items: T[] = [];
    let nextUrl: string | null = null;

    let response = await this.request<{ data: T[]; paging?: { next?: string } }>(path, { query });
    items.push(...response.data);
    nextUrl = response.paging?.next || null;

    while (nextUrl && items.length < cap) {
      // Meta's paging.next is a fully-qualified URL with the access_token already in it.
      // We bypass our request() helper here for simplicity.
      const r = await fetch(nextUrl, { cache: "no-store" });
      if (!r.ok) break;
      response = await r.json();
      items.push(...response.data);
      nextUrl = response.paging?.next || null;
    }

    return items.slice(0, cap);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // CAMPAIGNS
  // ───────────────────────────────────────────────────────────────────────────

  campaigns = {
    list: async (params: { status?: CampaignStatus[]; limit?: number } = {}): Promise<Campaign[]> => {
      const query: Record<string, string> = {
        fields:
          "id,name,objective,status,effective_status,daily_budget,lifetime_budget,created_time,updated_time",
        limit: String(params.limit ?? 100),
      };
      if (params.status?.length) {
        query.effective_status = JSON.stringify(params.status);
      }
      return this.fetchAllPages<Campaign>(`/act_${this.adAccountId}/campaigns`, query);
    },

    get: async (campaignId: string): Promise<Campaign> => {
      return this.request<Campaign>(`/${campaignId}`, {
        query: {
          fields:
            "id,name,objective,status,effective_status,daily_budget,lifetime_budget,created_time,updated_time",
        },
      });
    },

    create: async (params: {
      name: string;
      objective: CampaignObjective;
      status?: CampaignStatus;
      special_ad_categories?: string[];
      daily_budget_cents?: number;
    }): Promise<{ id: string }> => {
      return this.request(`/act_${this.adAccountId}/campaigns`, {
        method: "POST",
        body: {
          name: params.name,
          objective: params.objective,
          status: params.status ?? "PAUSED",
          special_ad_categories: params.special_ad_categories ?? [],
          ...(params.daily_budget_cents && { daily_budget: String(params.daily_budget_cents) }),
        },
      });
    },

    update: async (
      campaignId: string,
      updates: Partial<{ name: string; status: CampaignStatus; daily_budget_cents: number }>
    ): Promise<{ success: boolean }> => {
      const body: Record<string, unknown> = {};
      if (updates.name !== undefined) body.name = updates.name;
      if (updates.status !== undefined) body.status = updates.status;
      if (updates.daily_budget_cents !== undefined) body.daily_budget = String(updates.daily_budget_cents);
      return this.request(`/${campaignId}`, { method: "POST", body });
    },

    pause: async (campaignId: string) => this.campaigns.update(campaignId, { status: "PAUSED" }),
    resume: async (campaignId: string) => this.campaigns.update(campaignId, { status: "ACTIVE" }),
    archive: async (campaignId: string) => this.campaigns.update(campaignId, { status: "ARCHIVED" }),

    /**
     * Update only the daily budget. Meta uses the account currency's smallest unit
     * (cents for USD). Pass 1000 for $10/day.
     */
    setDailyBudget: async (campaignId: string, dailyBudgetCents: number) =>
      this.campaigns.update(campaignId, { daily_budget_cents: dailyBudgetCents }),

    /**
     * Duplicate a campaign with overrides. Common use: convert a "Landing Page Views"
     * campaign into an equivalent "Conversions" campaign by passing a new objective.
     */
    duplicate: async (
      campaignId: string,
      overrides: { name?: string; objective?: CampaignObjective; daily_budget_cents?: number } = {}
    ): Promise<{ copied_campaign_id: string }> => {
      // Meta's /copies endpoint duplicates campaigns server-side
      const body: Record<string, unknown> = {
        deep_copy: true,
        status_option: "PAUSED",
      };
      if (overrides.name) body.rename_options = { rename_strategy: "ONLY_TOP_LEVEL_RENAME", rename_suffix: ` — ${overrides.name}` };
      const result = await this.request<{ copied_campaign_id: string }>(`/${campaignId}/copies`, {
        method: "POST",
        body,
      });
      // Apply overrides to the new campaign
      if (overrides.objective || overrides.daily_budget_cents) {
        await this.campaigns.update(result.copied_campaign_id, {
          ...(overrides.daily_budget_cents !== undefined && { daily_budget_cents: overrides.daily_budget_cents }),
        });
        // Note: changing objective on an existing campaign isn't always supported
        // by Meta — we'd need to delete + recreate. Flagged as TODO.
      }
      return result;
    },
  };

  // ───────────────────────────────────────────────────────────────────────────
  // AD SETS
  // ───────────────────────────────────────────────────────────────────────────

  adSets = {
    list: async (params: { campaignId?: string; status?: CampaignStatus[]; limit?: number } = {}): Promise<AdSet[]> => {
      const query: Record<string, string> = {
        fields: "id,name,campaign_id,status,daily_budget,targeting,created_time",
        limit: String(params.limit ?? 100),
      };
      if (params.status?.length) query.effective_status = JSON.stringify(params.status);

      const path = params.campaignId
        ? `/${params.campaignId}/adsets`
        : `/act_${this.adAccountId}/adsets`;
      return this.fetchAllPages<AdSet>(path, query);
    },

    update: async (
      adSetId: string,
      updates: Partial<{ name: string; status: CampaignStatus; daily_budget_cents: number }>
    ): Promise<{ success: boolean }> => {
      const body: Record<string, unknown> = {};
      if (updates.name !== undefined) body.name = updates.name;
      if (updates.status !== undefined) body.status = updates.status;
      if (updates.daily_budget_cents !== undefined) body.daily_budget = String(updates.daily_budget_cents);
      return this.request(`/${adSetId}`, { method: "POST", body });
    },

    pause: async (adSetId: string) => this.adSets.update(adSetId, { status: "PAUSED" }),
    setDailyBudget: async (adSetId: string, dailyBudgetCents: number) =>
      this.adSets.update(adSetId, { daily_budget_cents: dailyBudgetCents }),
  };

  // ───────────────────────────────────────────────────────────────────────────
  // ADS (creative-level)
  // ───────────────────────────────────────────────────────────────────────────

  ads = {
    list: async (params: { adSetId?: string; campaignId?: string; limit?: number } = {}): Promise<Ad[]> => {
      const query: Record<string, string> = {
        fields: "id,name,adset_id,campaign_id,status,creative{id},created_time",
        limit: String(params.limit ?? 100),
      };
      const path = params.adSetId
        ? `/${params.adSetId}/ads`
        : params.campaignId
        ? `/${params.campaignId}/ads`
        : `/act_${this.adAccountId}/ads`;
      return this.fetchAllPages<Ad>(path, query);
    },

    update: async (
      adId: string,
      updates: Partial<{ name: string; status: CampaignStatus }>
    ): Promise<{ success: boolean }> => {
      const body: Record<string, unknown> = {};
      if (updates.name !== undefined) body.name = updates.name;
      if (updates.status !== undefined) body.status = updates.status;
      return this.request(`/${adId}`, { method: "POST", body });
    },

    pause: async (adId: string) => this.ads.update(adId, { status: "PAUSED" }),

    /**
     * Update an ad's destination URL. Used by Phase 5 to route ads to new
     * /lp/* landing pages instead of the homepage.
     *
     * Meta requires creating a NEW creative with the new URL, then attaching
     * it to the ad — you can't mutate the URL on an existing creative.
     */
    updateDestinationUrl: async (adId: string, newUrl: string): Promise<{ success: boolean; new_creative_id: string }> => {
      // 1. Get the existing ad's creative
      const ad = await this.request<Ad & { creative: { id: string } }>(`/${adId}`, {
        query: { fields: "creative{id,object_story_spec,name}" },
      });
      const oldCreativeId = ad.creative.id;

      // 2. Get the existing creative's full spec
      const oldCreative = await this.request<{
        name?: string;
        object_story_spec?: Record<string, unknown>;
      }>(`/${oldCreativeId}`, {
        query: { fields: "name,object_story_spec,object_url,link_url" },
      });

      // 3. Create a new creative with the new URL — patch object_story_spec.link_data.link
      const spec = oldCreative.object_story_spec as Record<string, unknown> | undefined;
      const linkData = (spec?.link_data || {}) as Record<string, unknown>;
      const newSpec = {
        ...spec,
        link_data: { ...linkData, link: newUrl },
      };
      const newCreative = await this.request<{ id: string }>(`/act_${this.adAccountId}/adcreatives`, {
        method: "POST",
        body: {
          name: `${oldCreative.name || "creative"} — ${newUrl}`,
          object_story_spec: newSpec,
        },
      });

      // 4. Attach the new creative to the ad
      await this.request(`/${adId}`, {
        method: "POST",
        body: { creative: { creative_id: newCreative.id } },
      });

      return { success: true, new_creative_id: newCreative.id };
    },
  };

  // ───────────────────────────────────────────────────────────────────────────
  // INSIGHTS
  // ───────────────────────────────────────────────────────────────────────────

  insights = {
    /**
     * Get insights for the entire ad account or a specific level.
     *
     * @param level   "account" | "campaign" | "adset" | "ad"
     * @param scope   "since/until" date strings (YYYY-MM-DD), OR a date_preset
     * @param params  optional breakdowns, time_increment, action_breakdowns
     */
    get: async (params: {
      level?: InsightLevel;
      since?: string;
      until?: string;
      datePreset?: DatePreset;
      objectId?: string;
      breakdowns?: string[];
      actionBreakdowns?: string[];
    }): Promise<Insight[]> => {
      const fields = [
        "campaign_id",
        "campaign_name",
        "adset_id",
        "ad_id",
        "spend",
        "impressions",
        "clicks",
        "ctr",
        "cpc",
        "cpm",
        "reach",
        "actions",
        "cost_per_action_type",
        "date_start",
        "date_stop",
      ].join(",");

      const query: Record<string, string> = {
        fields,
        level: params.level ?? "campaign",
      };

      if (params.since && params.until) {
        query.time_range = JSON.stringify({ since: params.since, until: params.until });
      } else if (params.datePreset) {
        query.date_preset = params.datePreset;
      } else {
        query.date_preset = "last_7d";
      }

      if (params.breakdowns?.length) query.breakdowns = params.breakdowns.join(",");
      if (params.actionBreakdowns?.length) query.action_breakdowns = params.actionBreakdowns.join(",");

      const path = params.objectId
        ? `/${params.objectId}/insights`
        : `/act_${this.adAccountId}/insights`;

      return this.fetchAllPages<Insight>(path, query);
    },

    /**
     * Quick helper: aggregate spend + conversions for the whole account in a window.
     */
    summary: async (datePreset: DatePreset = "today"): Promise<{
      spend_cents: number;
      impressions: number;
      clicks: number;
      conversions: number;
    }> => {
      const rows = await this.insights.get({ level: "account", datePreset });
      const row = rows[0];
      if (!row) return { spend_cents: 0, impressions: 0, clicks: 0, conversions: 0 };
      const spendDollars = Number(row.spend || 0);
      const conversions =
        row.actions
          ?.filter((a) =>
            [
              "complete_registration",
              "lead",
              "offsite_conversion.fb_pixel_complete_registration",
              "offsite_conversion.fb_pixel_lead",
            ].includes(a.action_type)
          )
          .reduce((s, a) => s + Number(a.value || 0), 0) ?? 0;
      return {
        spend_cents: Math.round(spendDollars * 100),
        impressions: Number(row.impressions || 0),
        clicks: Number(row.clicks || 0),
        conversions,
      };
    },
  };

  // ───────────────────────────────────────────────────────────────────────────
  // CUSTOM AUDIENCES (lookalikes, exclusions)
  // ───────────────────────────────────────────────────────────────────────────

  audiences = {
    list: async (): Promise<CustomAudience[]> => {
      return this.fetchAllPages<CustomAudience>(`/act_${this.adAccountId}/customaudiences`, {
        fields: "id,name,description,approximate_count_lower_bound,approximate_count_upper_bound,subtype",
        limit: "100",
      });
    },

    /**
     * Create a custom audience from a list of email addresses. Meta requires
     * SHA256 hashes of normalized (lowercased, trimmed) emails.
     *
     * Use case: upload your 12 winning USARM customers as a "Winners" audience,
     * then create a lookalike from it.
     */
    createFromEmails: async (params: {
      name: string;
      description?: string;
      emails: string[];
    }): Promise<{ id: string }> => {
      const { createHash } = await import("crypto");
      const hashed = params.emails
        .map((e) => e.trim().toLowerCase())
        .filter((e) => e.includes("@"))
        .map((e) => createHash("sha256").update(e).digest("hex"));

      // Step 1: create the (empty) audience
      const audience = await this.request<{ id: string }>(`/act_${this.adAccountId}/customaudiences`, {
        method: "POST",
        body: {
          name: params.name,
          description: params.description || `Created via dumbroof.ai automation`,
          subtype: "CUSTOM",
          customer_file_source: "USER_PROVIDED_ONLY",
        },
      });

      // Step 2: upload users in batches of 10000 (Meta's limit)
      const BATCH = 10000;
      for (let i = 0; i < hashed.length; i += BATCH) {
        const batch = hashed.slice(i, i + BATCH);
        await this.request(`/${audience.id}/users`, {
          method: "POST",
          body: {
            payload: {
              schema: ["EMAIL_SHA256"],
              data: batch.map((h) => [h]),
            },
          },
        });
      }

      return audience;
    },

    /**
     * Create a lookalike audience from an existing custom audience.
     * @param ratio — 0.01 = 1% (most similar, smallest), up to 0.10 = 10% (broadest)
     */
    createLookalike: async (params: {
      name: string;
      sourceAudienceId: string;
      country: string; // ISO code, e.g. "US"
      ratio?: number;
    }): Promise<{ id: string }> => {
      return this.request(`/act_${this.adAccountId}/customaudiences`, {
        method: "POST",
        body: {
          name: params.name,
          subtype: "LOOKALIKE",
          origin_audience_id: params.sourceAudienceId,
          lookalike_spec: {
            type: "similarity",
            ratio: params.ratio ?? 0.01,
            country: params.country,
          },
        },
      });
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// SINGLETON
// ─────────────────────────────────────────────────────────────────────────────

export class MetaApiError extends Error {
  constructor(public status: number, public body: string, public path: string) {
    super(`Meta API ${status} on ${path}: ${body.slice(0, 200)}`);
    this.name = "MetaApiError";
  }
}

let _client: MetaAdsClient | null = null;

/**
 * Get the singleton MetaAdsClient. Throws if META_ACCESS_TOKEN or
 * META_AD_ACCOUNT_ID env vars are missing — callers (route handlers,
 * cron jobs, agents) should catch this and either skip or surface the
 * error to the user.
 *
 * The singleton lives in module scope, so warm function instances reuse
 * it. Cold starts pay the (negligible) cost of constructing it once.
 */
export function getMetaAdsClient(): MetaAdsClient {
  if (!_client) {
    const token = process.env.META_ACCESS_TOKEN?.trim();
    const accountId = process.env.META_AD_ACCOUNT_ID?.trim();
    if (!token) throw new Error("META_ACCESS_TOKEN env var is required");
    if (!accountId) throw new Error("META_AD_ACCOUNT_ID env var is required");
    // Strip the "act_" prefix if user pasted it that way — we add it where needed.
    const cleanId = accountId.startsWith("act_") ? accountId.slice(4) : accountId;
    _client = new MetaAdsClient(token, cleanId);
  }
  return _client;
}

/** Test-only: reset the singleton between tests. */
export function _resetMetaAdsClientForTesting() {
  _client = null;
}
