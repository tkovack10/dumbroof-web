-- Document Templates: companies upload their own legal documents (AOBs, contingencies, COCs)
-- and the platform turns them into fillable, signable digital documents.

CREATE TABLE IF NOT EXISTS document_templates (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id uuid REFERENCES auth.users(id),
    name text NOT NULL,
    document_type text NOT NULL DEFAULT 'aob',
    description text,
    pdf_storage_path text NOT NULL,
    page_count integer NOT NULL DEFAULT 1,
    fields jsonb NOT NULL DEFAULT '[]'::jsonb,
    is_system boolean DEFAULT false,
    is_active boolean DEFAULT true,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_document_templates_user_id ON document_templates(user_id);
CREATE INDEX IF NOT EXISTS idx_document_templates_type ON document_templates(document_type);

ALTER TABLE document_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own templates and system templates"
    ON document_templates FOR SELECT
    USING (user_id = auth.uid() OR is_system = true);

CREATE POLICY "Users can insert own templates"
    ON document_templates FOR INSERT
    WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update own templates"
    ON document_templates FOR UPDATE
    USING (user_id = auth.uid());

GRANT ALL ON document_templates TO service_role;

-- Extend aob_signatures for template-based signing
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'aob_signatures' AND column_name = 'template_id'
    ) THEN
        ALTER TABLE aob_signatures ADD COLUMN template_id uuid REFERENCES document_templates(id);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'aob_signatures' AND column_name = 'fields_data'
    ) THEN
        ALTER TABLE aob_signatures ADD COLUMN fields_data jsonb DEFAULT '{}'::jsonb;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'aob_signatures' AND column_name = 'trades'
    ) THEN
        ALTER TABLE aob_signatures ADD COLUMN trades text[];
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_aob_signatures_template_id ON aob_signatures(template_id);
CREATE INDEX IF NOT EXISTS idx_aob_signatures_user_id ON aob_signatures(user_id);
