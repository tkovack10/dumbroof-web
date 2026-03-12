-- ============================================================
-- Photo Review: Atomic RPC functions (fix race condition)
-- ============================================================

CREATE OR REPLACE FUNCTION append_excluded_photo(claim_id_param uuid, photo_key text)
RETURNS void AS $$
BEGIN
  UPDATE claims
  SET excluded_photos = CASE
    WHEN excluded_photos IS NULL THEN ARRAY[photo_key]
    WHEN photo_key = ANY(excluded_photos) THEN excluded_photos
    ELSE array_append(excluded_photos, photo_key)
  END
  WHERE id = claim_id_param;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION remove_excluded_photo(claim_id_param uuid, photo_key text)
RETURNS void AS $$
BEGIN
  UPDATE claims SET excluded_photos = array_remove(excluded_photos, photo_key)
  WHERE id = claim_id_param;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ============================================================
-- Scope Review: New table + column + RPCs
-- ============================================================

-- New column on claims for excluded line items
ALTER TABLE claims ADD COLUMN IF NOT EXISTS excluded_line_items uuid[] DEFAULT '{}';

-- Feedback table for line item corrections (training data)
CREATE TABLE IF NOT EXISTS line_item_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  line_item_id uuid NOT NULL REFERENCES line_items(id) ON DELETE CASCADE,
  claim_id uuid NOT NULL REFERENCES claims(id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('approved', 'corrected', 'removed')),
  original_description text,
  original_qty numeric,
  original_unit_price numeric,
  original_unit text,
  corrected_description text,
  corrected_qty numeric,
  corrected_unit_price numeric,
  corrected_unit text,
  notes text,
  created_at timestamptz DEFAULT now(),
  UNIQUE(line_item_id)
);

ALTER TABLE line_item_feedback ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own feedback" ON line_item_feedback FOR SELECT
  USING (claim_id IN (SELECT id FROM claims WHERE user_id = auth.uid()));

CREATE POLICY "Service role full access" ON line_item_feedback FOR ALL
  USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_line_item_feedback_claim ON line_item_feedback(claim_id);

-- Atomic append/remove for excluded line items
CREATE OR REPLACE FUNCTION append_excluded_line_item(claim_id_param uuid, item_id uuid)
RETURNS void AS $$
BEGIN
  UPDATE claims
  SET excluded_line_items = CASE
    WHEN excluded_line_items IS NULL THEN ARRAY[item_id]
    WHEN item_id = ANY(excluded_line_items) THEN excluded_line_items
    ELSE array_append(excluded_line_items, item_id)
  END
  WHERE id = claim_id_param;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION remove_excluded_line_item(claim_id_param uuid, item_id uuid)
RETURNS void AS $$
BEGIN
  UPDATE claims SET excluded_line_items = array_remove(excluded_line_items, item_id)
  WHERE id = claim_id_param;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Recalculate contractor_rcv from non-excluded USARM/user_added line items
CREATE OR REPLACE FUNCTION recalculate_contractor_rcv(claim_id_param uuid)
RETURNS numeric AS $$
DECLARE new_total numeric;
BEGIN
  SELECT COALESCE(SUM(qty * unit_price), 0) INTO new_total
  FROM line_items
  WHERE claim_id = claim_id_param
    AND source IN ('usarm', 'user_added')
    AND id NOT IN (SELECT unnest(excluded_line_items) FROM claims WHERE id = claim_id_param);
  UPDATE claims SET contractor_rcv = ROUND(new_total, 2) WHERE id = claim_id_param;
  RETURN ROUND(new_total, 2);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
