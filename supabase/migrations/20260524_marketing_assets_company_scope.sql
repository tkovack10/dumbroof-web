-- Scope marketing_assets per-company. NULL company_id = shared global
-- (manufacturer-seeded shingle sample books, color guides). Set company_id =
-- company-private (USA Roof Masters "About Us" PDF, before/after galleries).
--
-- Why: f7ee75c opened the templates/assets pages to all reps. Before this
-- migration the marketing_assets table had no company_id and was
-- table-wide-readable via "Everyone can view active marketing assets" RLS,
-- which meant any company's private uploads would leak to every other
-- company on the platform. This migration fixes that.
--
-- Applied via Supabase MCP on 2026-05-24. Captured here for repo history +
-- replay against branches.

ALTER TABLE marketing_assets
    ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES companies(id) ON DELETE CASCADE;

-- Existing 16 manufacturer-seeded rows keep company_id IS NULL → remain
-- globally visible to every contractor.

-- Replace table-wide UNIQUE(slug) with composite-scoped uniqueness via two
-- partial indexes (Postgres treats NULLs as distinct in btree, so a plain
-- UNIQUE(slug, company_id) wouldn't enforce uniqueness among globals).
ALTER TABLE marketing_assets DROP CONSTRAINT IF EXISTS marketing_assets_slug_key;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_marketing_assets_slug_global
    ON marketing_assets(slug) WHERE company_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_marketing_assets_slug_company
    ON marketing_assets(slug, company_id) WHERE company_id IS NOT NULL;

DROP POLICY IF EXISTS "Everyone can view active marketing assets" ON marketing_assets;

CREATE POLICY "Members see globals + own company assets"
    ON marketing_assets FOR SELECT
    USING (
        active = true AND (
            company_id IS NULL OR
            company_id IN (
                SELECT company_id FROM company_profiles WHERE user_id = auth.uid()
            )
        )
    );

CREATE POLICY "Admins manage own company assets"
    ON marketing_assets FOR ALL
    USING (
        company_id IS NOT NULL AND
        company_id IN (
            SELECT company_id FROM company_profiles
            WHERE user_id = auth.uid() AND is_admin = true
        )
    )
    WITH CHECK (
        company_id IS NOT NULL AND
        company_id IN (
            SELECT company_id FROM company_profiles
            WHERE user_id = auth.uid() AND is_admin = true
        )
    );

CREATE INDEX IF NOT EXISTS idx_marketing_assets_company
    ON marketing_assets(company_id) WHERE company_id IS NOT NULL;
