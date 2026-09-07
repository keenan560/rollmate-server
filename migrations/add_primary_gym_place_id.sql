-- Add primary_gym_place_id to users
-- Google Place ID for the user's primary gym, captured via Places
-- Autocomplete so "Gracie Barra Murfreesboro" and "GB Murfreesboro" resolve
-- to the same physical location instead of relying on free-text matching.
-- Nullable: existing users keep their free-text primary_gym until they
-- re-select their gym through the new picker.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS primary_gym_place_id TEXT;

CREATE INDEX IF NOT EXISTS idx_users_primary_gym_place_id
  ON users (primary_gym_place_id)
  WHERE primary_gym_place_id IS NOT NULL;
