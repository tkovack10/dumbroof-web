-- ============================================================
-- Claim Brain — Database Migration
-- Tables + columns for email sending, AOB signatures, and
-- Gmail OAuth integration.
-- Run: supabase db push   (or apply via Supabase Dashboard SQL editor)
-- ============================================================

-- 1. claim_emails — log of all emails sent via Claim Brain
CREATE TABLE IF NOT EXISTS claim_emails (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    claim_id uuid REFERENCES claims(id) ON DELETE CASCADE,
    user_id uuid REFERENCES auth.users(id),
    email_type text NOT NULL DEFAULT 'custom',  -- supplement, invoice, coc, aob, custom
    to_email text NOT NULL,
    cc_email text,
    subject text NOT NULL,
    body_html text,
    send_method text DEFAULT 'resend',  -- gmail, resend
    status text DEFAULT 'sent',  -- sent, failed, draft
    sent_at timestamptz DEFAULT now(),
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamptz DEFAULT now()
);

-- Index for looking up emails per claim
CREATE INDEX IF NOT EXISTS idx_claim_emails_claim_id ON claim_emails(claim_id);
CREATE INDEX IF NOT EXISTS idx_claim_emails_user_id ON claim_emails(user_id);

-- RLS: users can only see their own claim emails
ALTER TABLE claim_emails ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own claim emails"
    ON claim_emails FOR SELECT
    USING (user_id = auth.uid());
CREATE POLICY "Users can insert own claim emails"
    ON claim_emails FOR INSERT
    WITH CHECK (user_id = auth.uid());


-- 2. aob_signatures — tracks AOB documents sent for homeowner e-signature
CREATE TABLE IF NOT EXISTS aob_signatures (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    claim_id uuid REFERENCES claims(id) ON DELETE CASCADE,
    user_id uuid REFERENCES auth.users(id),
    homeowner_email text NOT NULL,
    homeowner_name text,
    unsigned_pdf_path text,  -- Supabase storage path
    signed_pdf_path text,    -- filled after signing
    status text DEFAULT 'pending',  -- pending, signed, expired, cancelled
    signed_at timestamptz,
    ip_address text,  -- signer's IP for audit trail
    created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_aob_signatures_claim_id ON aob_signatures(claim_id);

ALTER TABLE aob_signatures ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own AOB signatures"
    ON aob_signatures FOR SELECT
    USING (user_id = auth.uid());
CREATE POLICY "Users can insert own AOB signatures"
    ON aob_signatures FOR INSERT
    WITH CHECK (user_id = auth.uid());


-- 3. Add email integration columns to company_profiles
-- (gmail_refresh_token, sending_email, license_number)
DO $$
BEGIN
    -- Gmail OAuth refresh token
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'company_profiles' AND column_name = 'gmail_refresh_token'
    ) THEN
        ALTER TABLE company_profiles ADD COLUMN gmail_refresh_token text;
    END IF;

    -- Preferred sending email (auto-set from Gmail OAuth)
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'company_profiles' AND column_name = 'sending_email'
    ) THEN
        ALTER TABLE company_profiles ADD COLUMN sending_email text;
    END IF;

    -- License number (optional, for PDFs)
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'company_profiles' AND column_name = 'license_number'
    ) THEN
        ALTER TABLE company_profiles ADD COLUMN license_number text;
    END IF;

    -- SMTP config (JSON blob for advanced users)
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'company_profiles' AND column_name = 'smtp_config'
    ) THEN
        ALTER TABLE company_profiles ADD COLUMN smtp_config jsonb;
    END IF;
END $$;


-- 4. Grant backend service role access (for Railway backend)
-- The service role bypasses RLS, but explicit grants ensure no permission issues
GRANT ALL ON claim_emails TO service_role;
GRANT ALL ON aob_signatures TO service_role;
