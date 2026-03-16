-- Drop existing function first (parameter name changed from user_id to user_id_param)
DROP FUNCTION IF EXISTS decrement_friends_count(text);

-- Decrement friends_count for a user, floored at 0 to prevent negative counts
CREATE OR REPLACE FUNCTION decrement_friends_count(user_id_param TEXT)
RETURNS void AS $$
BEGIN
  UPDATE users
  SET friends_count = GREATEST(friends_count - 1, 0)
  WHERE id = user_id_param;
END;
$$ LANGUAGE plpgsql;
