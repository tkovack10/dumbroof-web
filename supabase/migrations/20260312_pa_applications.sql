-- PA/Appraiser applications for the iHate DumbRoof-ers Club marketplace
CREATE TABLE IF NOT EXISTS pa_applications (
  id serial PRIMARY KEY,
  user_id uuid REFERENCES auth.users(id),
  name text NOT NULL,
  email text NOT NULL,
  phone text,
  company_name text,
  license_number text,
  states_covered text[] DEFAULT '{}',
  experience text,
  specialties text[],
  notes text,
  status text DEFAULT 'pending',
  created_at timestamptz DEFAULT now()
);

-- Allow service role full access (RLS disabled for admin table)
ALTER TABLE pa_applications ENABLE ROW LEVEL SECURITY;

-- Admin can read all
CREATE POLICY "Service role full access" ON pa_applications
  FOR ALL USING (true) WITH CHECK (true);
