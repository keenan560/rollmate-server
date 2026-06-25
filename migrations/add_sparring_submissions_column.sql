-- Add submissions JSONB column to sparring_rounds
-- This stores the full submissions array as the source of truth.
-- Each entry: {"by": "me"|"them", "type": "armbar"}
-- The result and submission_type columns remain for backward compatibility.

ALTER TABLE sparring_rounds
  ADD COLUMN IF NOT EXISTS submissions JSONB DEFAULT '[]'::jsonb;

-- Backfill existing rows that have a submission_type
UPDATE sparring_rounds
SET submissions = CASE
  WHEN result = 'i_subbed' AND submission_type IS NOT NULL
    THEN jsonb_build_array(jsonb_build_object('by', 'me', 'type', submission_type))
  WHEN result = 'they_subbed' AND submission_type IS NOT NULL
    THEN jsonb_build_array(jsonb_build_object('by', 'them', 'type', submission_type))
  ELSE '[]'::jsonb
END
WHERE submissions = '[]'::jsonb
  AND submission_type IS NOT NULL;
