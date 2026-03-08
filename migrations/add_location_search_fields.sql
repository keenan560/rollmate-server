-- Add city and zip_code fields to users table for easier location search
ALTER TABLE users 
ADD COLUMN IF NOT EXISTS city TEXT,
ADD COLUMN IF NOT EXISTS zip_code TEXT;

-- Create index for faster city/zip searches
CREATE INDEX IF NOT EXISTS idx_users_city ON users(city);
CREATE INDEX IF NOT EXISTS idx_users_zip_code ON users(zip_code);

-- Drop existing functions if they exist
DROP FUNCTION IF EXISTS get_user_location(TEXT);
DROP FUNCTION IF EXISTS get_users_with_location(TEXT);

-- Function to get user location (extract lat/lng from PostGIS point)
CREATE FUNCTION get_user_location(user_id TEXT)
RETURNS TABLE (
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  primary_gym TEXT,
  city TEXT,
  zip_code TEXT
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    ST_Y(location::geometry) as latitude,
    ST_X(location::geometry) as longitude,
    users.primary_gym,
    users.city,
    users.zip_code
  FROM users
  WHERE users.id = user_id;
END;
$$ LANGUAGE plpgsql;

-- Function to get all users with location data
CREATE FUNCTION get_users_with_location(exclude_user_id TEXT)
RETURNS TABLE (
  id TEXT,
  first_name TEXT,
  last_name TEXT,
  avatar_url TEXT,
  belt TEXT,
  primary_gym TEXT,
  weight INTEGER,
  available_now BOOLEAN,
  is_online BOOLEAN,
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  city TEXT,
  zip_code TEXT
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    users.id,
    users.first_name,
    users.last_name,
    users.avatar_url,
    users.belt,
    users.primary_gym,
    users.weight,
    users.available_now,
    users.is_online,
    ST_Y(users.location::geometry) as latitude,
    ST_X(users.location::geometry) as longitude,
    users.city,
    users.zip_code
  FROM users
  WHERE users.id != exclude_user_id
    AND users.location IS NOT NULL;
END;
$$ LANGUAGE plpgsql;

-- Function to search locations (cities and zip codes)
CREATE OR REPLACE FUNCTION search_locations(search_query TEXT, result_limit INT DEFAULT 10)
RETURNS TABLE (
  location_name TEXT,
  location_type TEXT,
  user_count BIGINT
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    COALESCE(city, zip_code) as location_name,
    CASE 
      WHEN city IS NOT NULL THEN 'city'
      ELSE 'zip'
    END as location_type,
    COUNT(*) as user_count
  FROM users
  WHERE (city ILIKE search_query || '%' OR zip_code ILIKE search_query || '%')
    AND (city IS NOT NULL OR zip_code IS NOT NULL)
  GROUP BY COALESCE(city, zip_code), city, zip_code
  ORDER BY user_count DESC, location_name ASC
  LIMIT result_limit;
END;
$$ LANGUAGE plpgsql;
