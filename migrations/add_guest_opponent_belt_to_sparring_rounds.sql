-- Add guest_opponent_belt to sparring_rounds
-- Stores a user-supplied belt rank for guest opponents (no linked Roll Mate
-- account), so belt-based UI treatment isn't limited to real accounts.

ALTER TABLE sparring_rounds
  ADD COLUMN IF NOT EXISTS guest_opponent_belt TEXT;
