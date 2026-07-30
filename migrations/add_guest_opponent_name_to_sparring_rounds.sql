-- Add guest_opponent_name to sparring_rounds
-- Stores a free-text opponent name for rounds where the user typed a name
-- that doesn't match an existing Roll Mate account (opponent_id stays NULL).

ALTER TABLE sparring_rounds
  ADD COLUMN IF NOT EXISTS guest_opponent_name TEXT;
