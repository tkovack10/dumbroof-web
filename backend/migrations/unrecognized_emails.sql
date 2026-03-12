-- Migration: Create unrecognized_emails table
-- Referenced by gmail_poller.py but never created in Supabase

CREATE TABLE IF NOT EXISTS unrecognized_emails (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    from_email text NOT NULL,
    subject text,
    received_at timestamptz DEFAULT now(),
    raw_snippet text,
    created_at timestamptz DEFAULT now()
);

ALTER TABLE unrecognized_emails ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role can manage unrecognized_emails"
    ON unrecognized_emails
    FOR ALL
    USING (auth.role() = 'service_role');
