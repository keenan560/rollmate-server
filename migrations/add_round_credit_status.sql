-- Add cross-credit tracking to sparring_rounds
-- Lets a logged round against a known Rollmate opponent offer to "adopt"
-- into that opponent's own sparring log, crediting their stats without
-- risking double-counting.
--
-- credit_status (on the ORIGINAL round you logged):
--   'none'      - no real Rollmate opponent tagged, nothing to offer
--   'pending'   - opponent has been notified, awaiting their response
--   'adopted'   - opponent added a mirrored copy to their own log
--   'dismissed' - opponent declined
--
-- adopted_from_round_id (on the MIRRORED round created via adoption):
--   points back to the original round it was copied from.

ALTER TABLE sparring_rounds
  ADD COLUMN IF NOT EXISTS credit_status TEXT NOT NULL DEFAULT 'none'
    CHECK (credit_status IN ('none', 'pending', 'adopted', 'dismissed')),
  ADD COLUMN IF NOT EXISTS adopted_from_round_id UUID
    REFERENCES sparring_rounds(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_sparring_rounds_credit_pending
  ON sparring_rounds(opponent_id)
  WHERE credit_status = 'pending';
