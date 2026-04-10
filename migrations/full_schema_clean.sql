--
-- PostgreSQL database dump
--

-- \restrict 9HfRTWVCWHwcWAH4KpFtCwoGBD0NTT98BLZh6KZmkFrhjzoNBMSlOg4hJx46HC5

-- Dumped from database version 15.8
-- Dumped by pg_dump version 18.3

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: pg_database_owner
--

-- CREATE SCHEMA public;


ALTER SCHEMA public OWNER TO pg_database_owner;

--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: pg_database_owner
--

COMMENT ON SCHEMA public IS 'standard public schema';


--
-- Name: belt_rank; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public.belt_rank AS ENUM (
    'white',
    'blue',
    'purple',
    'brown',
    'black'
);


ALTER TYPE public.belt_rank OWNER TO postgres;

--
-- Name: gender; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public.gender AS ENUM (
    'male',
    'female'
);


ALTER TYPE public.gender OWNER TO postgres;

--
-- Name: gender_type; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public.gender_type AS ENUM (
    'male',
    'female'
);


ALTER TYPE public.gender_type OWNER TO postgres;

--
-- Name: intensity_level; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public.intensity_level AS ENUM (
    'light',
    'medium',
    'hard'
);


ALTER TYPE public.intensity_level OWNER TO postgres;

--
-- Name: match_status; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public.match_status AS ENUM (
    'pending',
    'accepted',
    'declined',
    'completed'
);


ALTER TYPE public.match_status OWNER TO postgres;

--
-- Name: style_preference; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public.style_preference AS ENUM (
    'gi',
    'nogi',
    'both'
);


ALTER TYPE public.style_preference OWNER TO postgres;

--
-- Name: time_of_day; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public.time_of_day AS ENUM (
    'morning',
    'afternoon',
    'evening',
    'night'
);


ALTER TYPE public.time_of_day OWNER TO postgres;

--
-- Name: week_day; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public.week_day AS ENUM (
    'monday',
    'tuesday',
    'wednesday',
    'thursday',
    'friday',
    'saturday',
    'sunday'
);


ALTER TYPE public.week_day OWNER TO postgres;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: roll_requests; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.roll_requests (
    id integer NOT NULL,
    sender_id text,
    receiver_id text,
    status text DEFAULT 'pending'::text,
    created_at timestamp with time zone DEFAULT now(),
    responded_at timestamp with time zone,
    message text,
    proposed_date text,
    proposed_time text,
    updated_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.roll_requests OWNER TO postgres;

--
-- Name: create_roll_request(text, text); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.create_roll_request(p_sender_id text, p_receiver_id text) RETURNS SETOF public.roll_requests
    LANGUAGE plpgsql
    AS $$
BEGIN
  RETURN QUERY
  INSERT INTO roll_requests (sender_id, receiver_id, status, created_at)
  VALUES (p_sender_id, p_receiver_id, 'pending', NOW())
  RETURNING *;
END;
$$;


ALTER FUNCTION public.create_roll_request(p_sender_id text, p_receiver_id text) OWNER TO postgres;

--
-- Name: create_roll_request(character varying, character varying); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.create_roll_request(p_sender_id character varying, p_receiver_id character varying) RETURNS TABLE(roll_request_id uuid, sender_id character varying, receiver_id character varying, status character varying, style character varying, match_date timestamp without time zone, feedback text, confirmed boolean, created_at timestamp without time zone, responded_at timestamp without time zone, sender_details jsonb, receiver_details jsonb)
    LANGUAGE plpgsql
    AS $$
DECLARE
    v_sender_style VARCHAR(20);
    v_receiver_style VARCHAR(20);
    v_determined_style VARCHAR(20);
BEGIN
    -- Get both users' preferences with proper column qualification
    SELECT 
        u1.style_preference, 
        u2.style_preference
    INTO 
        v_sender_style, 
        v_receiver_style
    FROM users u1 
    CROSS JOIN users u2 
    WHERE u1.id = p_sender_id 
    AND u2.id = p_receiver_id;

    -- Smart style matching
    v_determined_style := 
        CASE 
            WHEN v_sender_style = v_receiver_style THEN v_sender_style
            WHEN v_sender_style = 'both' THEN v_receiver_style
            WHEN v_receiver_style = 'both' THEN v_sender_style
            ELSE CASE 
                WHEN v_sender_style = 'gi' AND v_receiver_style = 'nogi' THEN NULL
                WHEN v_sender_style = 'nogi' AND v_receiver_style = 'gi' THEN NULL
                ELSE 'both'
            END
        END;

    RETURN QUERY
    WITH new_request AS (
        INSERT INTO roll_requests (
            sender_id,
            receiver_id,
            status,
            style,
            confirmed,
            created_at
        )
        VALUES (
            p_sender_id,
            p_receiver_id,
            'pending',
            v_determined_style,
            false,
            NOW()
        )
        RETURNING *
    )
    SELECT 
        new_request.id as roll_request_id,
        new_request.sender_id,
        new_request.receiver_id,
        new_request.status,
        new_request.style,
        new_request.match_date,
        new_request.feedback,
        new_request.confirmed,
        new_request.created_at,
        new_request.responded_at,
        row_to_json(s.*)::jsonb as sender_details,
        row_to_json(r.*)::jsonb as receiver_details
    FROM new_request
    JOIN users s ON s.id = new_request.sender_id
    JOIN users r ON r.id = new_request.receiver_id;

END;
$$;


ALTER FUNCTION public.create_roll_request(p_sender_id character varying, p_receiver_id character varying) OWNER TO postgres;

--
-- Name: decrement_friends_count(text); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.decrement_friends_count(user_id_param text) RETURNS void
    LANGUAGE plpgsql
    AS $$
BEGIN
  UPDATE users
  SET friends_count = GREATEST(friends_count - 1, 0)
  WHERE id = user_id_param;
END;
$$;


ALTER FUNCTION public.decrement_friends_count(user_id_param text) OWNER TO postgres;

--
-- Name: users; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.users (
    id text NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    first_name text NOT NULL,
    last_name text NOT NULL,
    email text,
    avatar_url text,
    primary_gym text DEFAULT 'Not specified'::text,
    gender text,
    age integer DEFAULT 0,
    weight integer,
    belt text,
    stripes integer DEFAULT 0,
    style_preference text DEFAULT 'both'::text,
    years_experience integer DEFAULT 0,
    competition_experience boolean DEFAULT false,
    weight_range_min integer,
    weight_range_max integer,
    is_online boolean DEFAULT false,
    last_online timestamp with time zone,
    looking_for_roll boolean DEFAULT false,
    available_now boolean DEFAULT false,
    location public.geography(Point,4326),
    city text DEFAULT 'Unknown'::text,
    fcm_token text,
    height text,
    dob json,
    experience text,
    bjj_start_year integer,
    last_active_at timestamp with time zone DEFAULT now(),
    playing_style character varying(50),
    favorite_submissions text[],
    favorite_positions text[],
    training_goals text[],
    belt_verified boolean DEFAULT false,
    belt_verified_at timestamp with time zone,
    belt_verified_by text,
    is_instructor boolean DEFAULT false,
    friends_count integer DEFAULT 0,
    latitude numeric,
    longitude numeric,
    zip_code text,
    is_private boolean DEFAULT false,
    current_streak integer DEFAULT 0,
    CONSTRAINT check_bjj_start_year CHECK (((bjj_start_year IS NULL) OR ((bjj_start_year >= 1920) AND ((bjj_start_year)::numeric <= EXTRACT(year FROM CURRENT_DATE)))))
);


ALTER TABLE public.users OWNER TO postgres;

--
-- Name: COLUMN users.primary_gym; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.users.primary_gym IS 'ID or name of user primary training gym';


--
-- Name: COLUMN users.weight; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.users.weight IS 'User weight in pounds (for matching training partners)';


--
-- Name: COLUMN users.is_online; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.users.is_online IS 'Boolean flag indicating user is currently online in the app';


--
-- Name: COLUMN users.available_now; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.users.available_now IS 'Boolean flag indicating user is available to train right now';


--
-- Name: COLUMN users.belt_verified; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.users.belt_verified IS 'Whether the user''s belt has been verified by the community';


--
-- Name: COLUMN users.is_instructor; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.users.is_instructor IS 'Whether the user is a BJJ instructor (instructor endorsements have more weight)';


--
-- Name: COLUMN users.latitude; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.users.latitude IS 'User location latitude in decimal degrees (-90 to 90)';


--
-- Name: COLUMN users.longitude; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.users.longitude IS 'User location longitude in decimal degrees (-180 to 180)';


--
-- Name: find_nearby_users(double precision, double precision, integer); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.find_nearby_users(lat double precision, lng double precision, radius_meters integer) RETURNS SETOF public.users
    LANGUAGE plpgsql
    AS $$
BEGIN
  RETURN QUERY
  SELECT *
  FROM users
  WHERE ST_DWithin(
    location,
    ST_SetSRID(ST_MakePoint(lng, lat), 4326)::geography,
    radius_meters
  );
END;
$$;


ALTER FUNCTION public.find_nearby_users(lat double precision, lng double precision, radius_meters integer) OWNER TO postgres;

--
-- Name: find_nearby_users(numeric, numeric, integer); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.find_nearby_users(lat_input numeric, lng_input numeric, max_distance_miles integer DEFAULT 50) RETURNS TABLE(id uuid, distance_miles numeric, user_info json)
    LANGUAGE plpgsql
    AS $$
BEGIN
    RETURN QUERY
    SELECT 
        u.id,
        3959 * 2 * ASIN(SQRT(
            POWER(SIN((RADIANS(u.lat) - RADIANS(lat_input)) / 2), 2) +
            COS(RADIANS(lat_input)) * COS(RADIANS(u.lat)) *
            POWER(SIN((RADIANS(u.lng) - RADIANS(lng_input)) / 2), 2)
        )) AS distance_miles,
        row_to_json(u.*) AS user_info
    FROM users u
    WHERE u.looking_for_roll = true
    HAVING 
        3959 * 2 * ASIN(SQRT(
            POWER(SIN((RADIANS(u.lat) - RADIANS(lat_input)) / 2), 2) +
            COS(RADIANS(lat_input)) * COS(RADIANS(u.lat)) *
            POWER(SIN((RADIANS(u.lng) - RADIANS(lng_input)) / 2), 2)
        )) <= max_distance_miles
    ORDER BY distance_miles;
END;
$$;


ALTER FUNCTION public.find_nearby_users(lat_input numeric, lng_input numeric, max_distance_miles integer) OWNER TO postgres;

--
-- Name: find_potential_matches(text, double precision); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.find_potential_matches(p_requesting_user_id text, p_max_distance double precision) RETURNS TABLE(id text, first_name text, last_name text, avatar_url text, primary_gym text, gender text, age integer, weight integer, belt text, stripes integer, distance_meters double precision, city text)
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_user_location GEOGRAPHY;
  v_user_weight INT;
BEGIN
  -- Get the requesting user's location and weight
  SELECT location, weight
  INTO v_user_location, v_user_weight
  FROM users 
  WHERE id = p_requesting_user_id;
  
  -- Return potential matches
  RETURN QUERY
  SELECT 
    u.id,
    u.first_name,
    u.last_name,
    u.avatar_url,
    u.primary_gym,
    u.gender,
    u.age,
    u.weight,
    u.belt,
    u.stripes,
    ST_Distance(u.location, v_user_location)::FLOAT,
    u.city
  FROM users u
  WHERE 
    u.id != p_requesting_user_id
    AND u.looking_for_roll = TRUE
    AND ST_Distance(u.location, v_user_location) < p_max_distance
  ORDER BY ST_Distance(u.location, v_user_location);
END;
$$;


ALTER FUNCTION public.find_potential_matches(p_requesting_user_id text, p_max_distance double precision) OWNER TO postgres;

--
-- Name: find_potential_matches(uuid, double precision); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.find_potential_matches(p_requesting_user_id uuid, p_max_distance double precision) RETURNS TABLE(potential_match_bjj_start_year integer, potential_match_years_experience integer)
    LANGUAGE plpgsql
    AS $$
BEGIN
  RETURN QUERY
  SELECT 
    -- ... other fields ...
    u.bjj_start_year AS potential_match_bjj_start_year,
    (EXTRACT(YEAR FROM CURRENT_DATE) - u.bjj_start_year)::INTEGER AS potential_match_years_experience
  FROM users u
  WHERE u.id != p_requesting_user_id;
END;
$$;


ALTER FUNCTION public.find_potential_matches(p_requesting_user_id uuid, p_max_distance double precision) OWNER TO postgres;

--
-- Name: get_coordinates(public.geometry); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.get_coordinates(geom public.geometry) RETURNS json
    LANGUAGE sql IMMUTABLE
    AS $$
  SELECT json_build_object(
    'lat', ST_Y(geom),
    'lng', ST_X(geom)
  );
$$;


ALTER FUNCTION public.get_coordinates(geom public.geometry) OWNER TO postgres;

--
-- Name: get_photo_likes_for_post(uuid, text); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.get_photo_likes_for_post(p_post_id uuid, p_user_id text DEFAULT NULL::text) RETURNS TABLE(photo_index integer, likes_count bigint, is_liked_by_user boolean)
    LANGUAGE plpgsql
    AS $$
BEGIN
    RETURN QUERY
    SELECT 
        pl.photo_index,
        COUNT(*)::BIGINT AS likes_count,
        BOOL_OR(pl.user_id = p_user_id) AS is_liked_by_user
    FROM photo_likes pl
    WHERE pl.post_id = p_post_id
    GROUP BY pl.photo_index
    ORDER BY pl.photo_index;
END;
$$;


ALTER FUNCTION public.get_photo_likes_for_post(p_post_id uuid, p_user_id text) OWNER TO postgres;

--
-- Name: get_post_comments(uuid, integer, integer); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.get_post_comments(p_post_id uuid, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0) RETURNS TABLE(id uuid, post_id uuid, user_id text, content text, created_at timestamp with time zone, updated_at timestamp with time zone, is_deleted boolean, user_first_name text, user_last_name text, user_avatar_url text, user_belt text, user_belt_verified boolean)
    LANGUAGE plpgsql
    AS $$
BEGIN
    RETURN QUERY
    SELECT 
        pc.id,
        pc.post_id,
        pc.user_id,
        pc.content,
        pc.created_at,
        pc.updated_at,
        pc.is_deleted,
        u.first_name AS user_first_name,
        u.last_name AS user_last_name,
        u.avatar_url AS user_avatar_url,
        u.belt AS user_belt,
        u.belt_verified AS user_belt_verified
    FROM post_comments pc
    LEFT JOIN users u ON pc.user_id = u.id
    WHERE pc.post_id = p_post_id
    AND pc.is_deleted = false
    ORDER BY pc.created_at ASC
    LIMIT p_limit
    OFFSET p_offset;
END;
$$;


ALTER FUNCTION public.get_post_comments(p_post_id uuid, p_limit integer, p_offset integer) OWNER TO postgres;

--
-- Name: get_posts_with_details(integer, integer, text); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.get_posts_with_details(p_limit integer DEFAULT 30, p_offset integer DEFAULT 0, p_current_user_id text DEFAULT NULL::text) RETURNS TABLE(id uuid, user_id text, content text, media_type character varying, media_url text, media_urls text[], video_thumbnail_url text, created_at timestamp with time zone, updated_at timestamp with time zone, is_deleted boolean, likes_count bigint, comments_count bigint, user_has_liked boolean, user_first_name text, user_last_name text, user_avatar_url text, user_belt text, user_belt_verified boolean)
    LANGUAGE plpgsql
    AS $$
BEGIN
    RETURN QUERY
    SELECT 
        p.id,
        p.user_id,
        p.content,
        p.media_type,
        p.media_url,
        p.media_urls,
        p.video_thumbnail_url,
        p.created_at,
        p.updated_at,
        p.is_deleted,
        COALESCE(COUNT(DISTINCT pl.id), 0)::BIGINT AS likes_count,
        COALESCE(COUNT(DISTINCT pc.id), 0)::BIGINT AS comments_count,
        EXISTS(
            SELECT 1 FROM post_likes pl2
            WHERE pl2.post_id = p.id 
            AND pl2.user_id = p_current_user_id
        ) AS user_has_liked,
        u.first_name AS user_first_name,
        u.last_name AS user_last_name,
        u.avatar_url AS user_avatar_url,
        u.belt AS user_belt,
        u.belt_verified AS user_belt_verified
    FROM posts p
    LEFT JOIN users u ON p.user_id = u.id
    LEFT JOIN post_likes pl ON p.id = pl.post_id
    LEFT JOIN post_comments pc ON p.id = pc.post_id AND pc.is_deleted = false
    LEFT JOIN hidden_posts hp ON p.id = hp.post_id AND hp.user_id = p_current_user_id
    WHERE p.is_deleted = false
    AND hp.id IS NULL
    GROUP BY 
        p.id, 
        p.user_id, 
        p.content, 
        p.media_type, 
        p.media_url,
        p.media_urls,
        p.video_thumbnail_url,
        p.created_at, 
        p.updated_at, 
        p.is_deleted,
        u.first_name,
        u.last_name,
        u.avatar_url,
        u.belt,
        u.belt_verified
    ORDER BY p.created_at DESC
    LIMIT p_limit
    OFFSET p_offset;
END;
$$;


ALTER FUNCTION public.get_posts_with_details(p_limit integer, p_offset integer, p_current_user_id text) OWNER TO postgres;

--
-- Name: get_posts_with_details(integer, integer, text, timestamp with time zone); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.get_posts_with_details(p_limit integer, p_offset integer, p_current_user_id text, p_since timestamp with time zone DEFAULT (now() - '72:00:00'::interval)) RETURNS TABLE(id uuid, user_id text, content text, media_type text, media_url text, media_urls text[], video_thumbnail_url text, created_at timestamp with time zone, updated_at timestamp with time zone, is_deleted boolean, likes_count bigint, comments_count bigint, user_has_liked boolean, user_first_name text, user_last_name text, user_avatar_url text, user_belt text, user_belt_verified boolean)
    LANGUAGE plpgsql
    AS $$
BEGIN
    RETURN QUERY
    SELECT 
        p.id,
        p.user_id,
        p.content,
        p.media_type::TEXT,
        p.media_url,
        p.media_urls::TEXT[],
        p.video_thumbnail_url,
        p.created_at,
        p.updated_at,
        p.is_deleted,
        COALESCE(COUNT(DISTINCT pl.id), 0)::BIGINT AS likes_count,
        COALESCE(COUNT(DISTINCT pc.id), 0)::BIGINT AS comments_count,
        EXISTS(
            SELECT 1 FROM post_likes pl2
            WHERE pl2.post_id = p.id 
            AND pl2.user_id = p_current_user_id
        ) AS user_has_liked,
        u.first_name AS user_first_name,
        u.last_name AS user_last_name,
        u.avatar_url AS user_avatar_url,
        u.belt AS user_belt,
        u.belt_verified AS user_belt_verified
    FROM posts p
    LEFT JOIN users u ON p.user_id = u.id
    LEFT JOIN post_likes pl ON p.id = pl.post_id
    LEFT JOIN post_comments pc ON p.id = pc.post_id AND pc.is_deleted = false
    LEFT JOIN hidden_posts hp ON p.id = hp.post_id AND hp.user_id = p_current_user_id
    WHERE p.is_deleted = false
    AND hp.id IS NULL
    AND p.created_at >= p_since
    GROUP BY 
        p.id, 
        p.user_id, 
        p.content, 
        p.media_type, 
        p.media_url,
        p.media_urls,
        p.video_thumbnail_url,
        p.created_at, 
        p.updated_at, 
        p.is_deleted,
        u.first_name,
        u.last_name,
        u.avatar_url,
        u.belt,
        u.belt_verified
    ORDER BY p.created_at DESC
    LIMIT p_limit
    OFFSET p_offset;
END;
$$;


ALTER FUNCTION public.get_posts_with_details(p_limit integer, p_offset integer, p_current_user_id text, p_since timestamp with time zone) OWNER TO postgres;

--
-- Name: get_single_post_with_details(uuid, text); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.get_single_post_with_details(p_post_id uuid, p_current_user_id text DEFAULT NULL::text) RETURNS TABLE(id uuid, user_id text, content text, media_type character varying, media_url text, media_urls text[], video_thumbnail_url text, created_at timestamp with time zone, updated_at timestamp with time zone, is_deleted boolean, likes_count bigint, comments_count bigint, user_has_liked boolean, user_first_name text, user_last_name text, user_avatar_url text, user_belt text, user_belt_verified boolean)
    LANGUAGE plpgsql
    AS $$
BEGIN
    RETURN QUERY
    SELECT 
        p.id,
        p.user_id,
        p.content,
        p.media_type,
        p.media_url,
        p.media_urls,
        p.video_thumbnail_url,
        p.created_at,
        p.updated_at,
        p.is_deleted,
        COALESCE(COUNT(DISTINCT pl.id), 0)::BIGINT AS likes_count,
        COALESCE(COUNT(DISTINCT pc.id), 0)::BIGINT AS comments_count,
        EXISTS(
            SELECT 1 FROM post_likes pl2
            WHERE pl2.post_id = p.id 
            AND pl2.user_id = p_current_user_id
        ) AS user_has_liked,
        u.first_name AS user_first_name,
        u.last_name AS user_last_name,
        u.avatar_url AS user_avatar_url,
        u.belt AS user_belt,
        u.belt_verified AS user_belt_verified
    FROM posts p
    LEFT JOIN users u ON p.user_id = u.id
    LEFT JOIN post_likes pl ON p.id = pl.post_id
    LEFT JOIN post_comments pc ON p.id = pc.post_id AND pc.is_deleted = false
    WHERE p.id = p_post_id
    AND p.is_deleted = false
    GROUP BY 
        p.id, 
        p.user_id, 
        p.content, 
        p.media_type, 
        p.media_url,
        p.media_urls,
        p.video_thumbnail_url,
        p.created_at, 
        p.updated_at, 
        p.is_deleted,
        u.first_name,
        u.last_name,
        u.avatar_url,
        u.belt,
        u.belt_verified;
END;
$$;


ALTER FUNCTION public.get_single_post_with_details(p_post_id uuid, p_current_user_id text) OWNER TO postgres;

--
-- Name: get_user_location(text); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.get_user_location(user_id text) RETURNS TABLE(latitude double precision, longitude double precision, primary_gym text, city text, zip_code text)
    LANGUAGE plpgsql
    AS $$
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
$$;


ALTER FUNCTION public.get_user_location(user_id text) OWNER TO postgres;

--
-- Name: get_user_posts_with_details(text, text, integer, integer); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.get_user_posts_with_details(p_user_id text, p_current_user_id text DEFAULT NULL::text, p_limit integer DEFAULT 100, p_offset integer DEFAULT 0) RETURNS TABLE(id uuid, user_id text, content text, media_type character varying, media_url text, media_urls text[], video_thumbnail_url text, created_at timestamp with time zone, updated_at timestamp with time zone, is_deleted boolean, likes_count bigint, comments_count bigint, user_has_liked boolean, user_first_name text, user_last_name text, user_avatar_url text, user_belt text, user_belt_verified boolean)
    LANGUAGE plpgsql
    AS $$
BEGIN
    RETURN QUERY
    SELECT 
        p.id,
        p.user_id,
        p.content,
        p.media_type,
        p.media_url,
        p.media_urls,
        p.video_thumbnail_url,
        p.created_at,
        p.updated_at,
        p.is_deleted,
        COALESCE(COUNT(DISTINCT pl.id), 0)::BIGINT AS likes_count,
        COALESCE(COUNT(DISTINCT pc.id), 0)::BIGINT AS comments_count,
        EXISTS(
            SELECT 1 FROM post_likes pl2
            WHERE pl2.post_id = p.id 
            AND pl2.user_id = p_current_user_id
        ) AS user_has_liked,
        u.first_name AS user_first_name,
        u.last_name AS user_last_name,
        u.avatar_url AS user_avatar_url,
        u.belt AS user_belt,
        u.belt_verified AS user_belt_verified
    FROM posts p
    LEFT JOIN users u ON p.user_id = u.id
    LEFT JOIN post_likes pl ON p.id = pl.post_id
    LEFT JOIN post_comments pc ON p.id = pc.post_id AND pc.is_deleted = false
    LEFT JOIN hidden_posts hp ON p.id = hp.post_id AND hp.user_id = p_current_user_id
    WHERE p.user_id = p_user_id
    AND p.is_deleted = false
    AND hp.id IS NULL
    GROUP BY 
        p.id, 
        p.user_id, 
        p.content, 
        p.media_type, 
        p.media_url,
        p.media_urls,
        p.video_thumbnail_url,
        p.created_at, 
        p.updated_at, 
        p.is_deleted,
        u.first_name,
        u.last_name,
        u.avatar_url,
        u.belt,
        u.belt_verified
    ORDER BY p.created_at DESC
    LIMIT p_limit
    OFFSET p_offset;
END;
$$;


ALTER FUNCTION public.get_user_posts_with_details(p_user_id text, p_current_user_id text, p_limit integer, p_offset integer) OWNER TO postgres;

--
-- Name: get_users_with_coords(text, integer, integer, text, text, integer, integer, text); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.get_users_with_coords(p_current_user_id text, p_limit integer DEFAULT 30, p_offset integer DEFAULT 0, p_belt text DEFAULT NULL::text, p_gender text DEFAULT NULL::text, p_age integer DEFAULT NULL::integer, p_weight integer DEFAULT NULL::integer, p_name text DEFAULT NULL::text) RETURNS TABLE(id text, first_name text, last_name text, email text, avatar_url text, primary_gym text, gender text, age integer, weight integer, belt text, stripes integer, height text, style_preference text, competition_experience boolean, bjj_start_year integer, city text, dob json, is_instructor boolean, belt_verified boolean, friends_count integer, latitude double precision, longitude double precision)
    LANGUAGE plpgsql
    AS $$
BEGIN
  RETURN QUERY
  SELECT 
    u.id,
    u.first_name,
    u.last_name,
    u.email,
    u.avatar_url,
    u.primary_gym,
    u.gender,
    u.age,
    u.weight,
    u.belt,
    u.stripes,
    u.height,
    u.style_preference,
    u.competition_experience,
    u.bjj_start_year,
    u.city,
    u.dob,
    u.is_instructor,
    u.belt_verified,
    u.friends_count,
    ST_Y(u.location::geometry) as latitude,
    ST_X(u.location::geometry) as longitude
  FROM users u
  WHERE u.id != p_current_user_id
    AND (p_belt IS NULL OR u.belt = p_belt)
    AND (p_gender IS NULL OR u.gender = p_gender)
    AND (p_age IS NULL OR u.age = p_age)
    AND (p_weight IS NULL OR u.weight BETWEEN p_weight - 20 AND p_weight + 20)
    AND (p_name IS NULL OR 
         LOWER(u.first_name || ' ' || u.last_name) LIKE LOWER('%' || p_name || '%') OR
         LOWER(u.last_name || ' ' || u.first_name) LIKE LOWER('%' || p_name || '%'))
  ORDER BY u.created_at DESC
  LIMIT p_limit
  OFFSET p_offset;
END;
$$;


ALTER FUNCTION public.get_users_with_coords(p_current_user_id text, p_limit integer, p_offset integer, p_belt text, p_gender text, p_age integer, p_weight integer, p_name text) OWNER TO postgres;

--
-- Name: get_users_with_location(text); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.get_users_with_location(exclude_user_id text) RETURNS TABLE(id text, first_name text, last_name text, avatar_url text, belt text, primary_gym text, weight integer, available_now boolean, is_online boolean, latitude double precision, longitude double precision, city text, zip_code text)
    LANGUAGE plpgsql
    AS $$
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
$$;


ALTER FUNCTION public.get_users_with_location(exclude_user_id text) OWNER TO postgres;

--
-- Name: increment_friends_count(text); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.increment_friends_count(user_id text) RETURNS void
    LANGUAGE plpgsql
    AS $$
BEGIN
  UPDATE users 
  SET friends_count = COALESCE(friends_count, 0) + 1 
  WHERE id = user_id;
END;
$$;


ALTER FUNCTION public.increment_friends_count(user_id text) OWNER TO postgres;

--
-- Name: search_locations(text, integer); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.search_locations(search_query text, result_limit integer DEFAULT 10) RETURNS TABLE(location_name text, location_type text, user_count bigint)
    LANGUAGE plpgsql
    AS $$
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
$$;


ALTER FUNCTION public.search_locations(search_query text, result_limit integer) OWNER TO postgres;

--
-- Name: search_posts_with_details(text, text, integer); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.search_posts_with_details(p_search_term text, p_current_user_id text DEFAULT NULL::text, p_limit integer DEFAULT 30) RETURNS TABLE(id uuid, user_id text, content text, media_type character varying, media_url text, media_urls text[], video_thumbnail_url text, created_at timestamp with time zone, updated_at timestamp with time zone, is_deleted boolean, likes_count bigint, comments_count bigint, user_has_liked boolean, user_first_name text, user_last_name text, user_avatar_url text, user_belt text, user_belt_verified boolean)
    LANGUAGE plpgsql
    AS $$
BEGIN
    RETURN QUERY
    SELECT 
        p.id,
        p.user_id,
        p.content,
        p.media_type,
        p.media_url,
        p.media_urls,
        p.video_thumbnail_url,
        p.created_at,
        p.updated_at,
        p.is_deleted,
        COALESCE(COUNT(DISTINCT pl.id), 0)::BIGINT AS likes_count,
        COALESCE(COUNT(DISTINCT pc.id), 0)::BIGINT AS comments_count,
        EXISTS(
            SELECT 1 FROM post_likes pl2
            WHERE pl2.post_id = p.id 
            AND pl2.user_id = p_current_user_id
        ) AS user_has_liked,
        u.first_name AS user_first_name,
        u.last_name AS user_last_name,
        u.avatar_url AS user_avatar_url,
        u.belt AS user_belt,
        u.belt_verified AS user_belt_verified
    FROM posts p
    LEFT JOIN users u ON p.user_id = u.id
    LEFT JOIN post_likes pl ON p.id = pl.post_id
    LEFT JOIN post_comments pc ON p.id = pc.post_id AND pc.is_deleted = false
    LEFT JOIN hidden_posts hp ON p.id = hp.post_id AND hp.user_id = p_current_user_id
    WHERE (
        p.content ILIKE p_search_term
        OR u.first_name ILIKE p_search_term
        OR u.last_name ILIKE p_search_term
        OR (u.first_name || ' ' || u.last_name) ILIKE p_search_term
    )
    AND p.is_deleted = false
    AND hp.id IS NULL
    GROUP BY 
        p.id, 
        p.user_id, 
        p.content, 
        p.media_type, 
        p.media_url,
        p.media_urls,
        p.video_thumbnail_url,
        p.created_at, 
        p.updated_at, 
        p.is_deleted,
        u.first_name,
        u.last_name,
        u.avatar_url,
        u.belt,
        u.belt_verified
    ORDER BY p.created_at DESC
    LIMIT p_limit;
END;
$$;


ALTER FUNCTION public.search_posts_with_details(p_search_term text, p_current_user_id text, p_limit integer) OWNER TO postgres;

--
-- Name: update_achievement_endorsement_count(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.update_achievement_endorsement_count() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE achievements 
    SET endorsement_count = endorsement_count + 1,
        updated_at = NOW()
    WHERE id = NEW.achievement_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE achievements 
    SET endorsement_count = GREATEST(0, endorsement_count - 1),
        updated_at = NOW()
    WHERE id = OLD.achievement_id;
  END IF;
  RETURN NULL;
END;
$$;


ALTER FUNCTION public.update_achievement_endorsement_count() OWNER TO postgres;

--
-- Name: update_achievement_verification_count(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.update_achievement_verification_count() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE achievements 
    SET verification_count = verification_count + 1 
    WHERE id = NEW.achievement_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE achievements 
    SET verification_count = verification_count - 1 
    WHERE id = OLD.achievement_id;
  END IF;
  RETURN NULL;
END;
$$;


ALTER FUNCTION public.update_achievement_verification_count() OWNER TO postgres;

--
-- Name: update_belt_verification_updated_at(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.update_belt_verification_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;


ALTER FUNCTION public.update_belt_verification_updated_at() OWNER TO postgres;

--
-- Name: update_support_ticket_timestamp(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.update_support_ticket_timestamp() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at = NOW();
  
  -- Set resolved_at when status changes to resolved or closed
  IF NEW.status IN ('resolved', 'closed') AND OLD.status NOT IN ('resolved', 'closed') THEN
    NEW.resolved_at = NOW();
  END IF;
  
  RETURN NEW;
END;
$$;


ALTER FUNCTION public.update_support_ticket_timestamp() OWNER TO postgres;

--
-- Name: update_user_belt_verification(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.update_user_belt_verification() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NEW.is_verified = TRUE AND (OLD.is_verified IS NULL OR OLD.is_verified = FALSE) THEN
    UPDATE users
    SET belt_verified = TRUE,
        belt_verified_at = NEW.verified_at,
        belt_verified_by = NEW.verifier_user_id,
        belt = NEW.belt_level,
        stripes = COALESCE(NEW.stripes, 0)
    WHERE id = NEW.user_id;
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION public.update_user_belt_verification() OWNER TO postgres;

--
-- Name: achievement_endorsements; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.achievement_endorsements (
    id integer NOT NULL,
    achievement_id integer NOT NULL,
    endorser_user_id text NOT NULL,
    relationship_type character varying,
    comment text,
    endorsed_at timestamp with time zone DEFAULT now(),
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT achievement_endorsements_relationship_type_check CHECK (((relationship_type)::text = ANY ((ARRAY['training_partner'::character varying, 'competitor'::character varying, 'instructor'::character varying, 'witness'::character varying])::text[])))
);


ALTER TABLE public.achievement_endorsements OWNER TO postgres;

--
-- Name: TABLE achievement_endorsements; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE public.achievement_endorsements IS 'LinkedIn-style endorsements for achievements';


--
-- Name: achievement_endorsements_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.achievement_endorsements_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.achievement_endorsements_id_seq OWNER TO postgres;

--
-- Name: achievement_endorsements_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.achievement_endorsements_id_seq OWNED BY public.achievement_endorsements.id;


--
-- Name: achievement_verifications; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.achievement_verifications (
    id integer NOT NULL,
    achievement_id integer,
    verifier_user_id text,
    relationship_type character varying(50),
    comment text,
    verified_at timestamp without time zone DEFAULT now()
);


ALTER TABLE public.achievement_verifications OWNER TO postgres;

--
-- Name: achievement_verifications_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.achievement_verifications_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.achievement_verifications_id_seq OWNER TO postgres;

--
-- Name: achievement_verifications_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.achievement_verifications_id_seq OWNED BY public.achievement_verifications.id;


--
-- Name: achievements; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.achievements (
    id integer NOT NULL,
    user_id text,
    competition_name character varying(255) NOT NULL,
    competition_date date NOT NULL,
    medal_type character varying(20) NOT NULL,
    division character varying(100),
    weight_class character varying(50),
    belt_level character varying(20),
    gi_type character varying(20),
    organization character varying(255),
    location character varying(255),
    notes text,
    verification_count integer DEFAULT 0,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    endorsement_count integer DEFAULT 0
);


ALTER TABLE public.achievements OWNER TO postgres;

--
-- Name: COLUMN achievements.endorsement_count; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.achievements.endorsement_count IS 'Number of endorsements this achievement has received';


--
-- Name: achievements_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.achievements_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.achievements_id_seq OWNER TO postgres;

--
-- Name: achievements_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.achievements_id_seq OWNED BY public.achievements.id;


--
-- Name: availability; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.availability (
    id integer NOT NULL,
    user_id text,
    day text NOT NULL,
    morning boolean DEFAULT false,
    afternoon boolean DEFAULT false,
    evening boolean DEFAULT false,
    night boolean DEFAULT false
);


ALTER TABLE public.availability OWNER TO postgres;

--
-- Name: availability_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.availability_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.availability_id_seq OWNER TO postgres;

--
-- Name: availability_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.availability_id_seq OWNED BY public.availability.id;


--
-- Name: belt_endorsements; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.belt_endorsements (
    id integer NOT NULL,
    user_id text NOT NULL,
    endorser_user_id text NOT NULL,
    belt_level text NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.belt_endorsements OWNER TO postgres;

--
-- Name: TABLE belt_endorsements; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE public.belt_endorsements IS 'LinkedIn-style belt endorsements - users endorse each other''s current belt level';


--
-- Name: COLUMN belt_endorsements.user_id; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.belt_endorsements.user_id IS 'The user whose belt is being endorsed';


--
-- Name: COLUMN belt_endorsements.endorser_user_id; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.belt_endorsements.endorser_user_id IS 'The user giving the endorsement';


--
-- Name: COLUMN belt_endorsements.belt_level; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.belt_endorsements.belt_level IS 'The belt level being endorsed (must match user''s current belt)';


--
-- Name: belt_endorsements_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.belt_endorsements_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.belt_endorsements_id_seq OWNER TO postgres;

--
-- Name: belt_endorsements_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.belt_endorsements_id_seq OWNED BY public.belt_endorsements.id;


--
-- Name: belt_progress; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.belt_progress (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id text NOT NULL,
    belt text NOT NULL,
    technique_id text NOT NULL,
    checked_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.belt_progress OWNER TO postgres;

--
-- Name: belt_verification_endorsements; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.belt_verification_endorsements (
    id integer NOT NULL,
    verification_id integer NOT NULL,
    endorser_user_id text NOT NULL,
    is_instructor boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.belt_verification_endorsements OWNER TO postgres;

--
-- Name: TABLE belt_verification_endorsements; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE public.belt_verification_endorsements IS 'Stores endorsements for belt verifications';


--
-- Name: belt_verification_endorsements_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.belt_verification_endorsements_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.belt_verification_endorsements_id_seq OWNER TO postgres;

--
-- Name: belt_verification_endorsements_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.belt_verification_endorsements_id_seq OWNED BY public.belt_verification_endorsements.id;


--
-- Name: belt_verifications; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.belt_verifications (
    id integer NOT NULL,
    user_id text,
    belt_level character varying(20) NOT NULL,
    verifier_user_id text,
    verifier_role character varying(50),
    gym_name character varying(255),
    verified_at timestamp without time zone DEFAULT now(),
    is_verified boolean DEFAULT false,
    stripes integer DEFAULT 0,
    promotion_date timestamp with time zone DEFAULT now(),
    notes text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    status text DEFAULT 'pending'::text NOT NULL
);


ALTER TABLE public.belt_verifications OWNER TO postgres;

--
-- Name: TABLE belt_verifications; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE public.belt_verifications IS 'Stores belt promotion verification requests';


--
-- Name: COLUMN belt_verifications.is_verified; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.belt_verifications.is_verified IS 'Whether the belt promotion has been verified by an instructor';


--
-- Name: belt_verifications_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.belt_verifications_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.belt_verifications_id_seq OWNER TO postgres;

--
-- Name: belt_verifications_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.belt_verifications_id_seq OWNED BY public.belt_verifications.id;


--
-- Name: blocked_users; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.blocked_users (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    user_id text NOT NULL,
    blocked_user_id text NOT NULL,
    created_at timestamp without time zone DEFAULT now(),
    CONSTRAINT blocked_users_check CHECK ((user_id <> blocked_user_id))
);


ALTER TABLE public.blocked_users OWNER TO postgres;

--
-- Name: TABLE blocked_users; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE public.blocked_users IS 'Stores user blocking relationships';


--
-- Name: chat_messages; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.chat_messages (
    id integer NOT NULL,
    chat_id integer,
    sender_id text,
    message text NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    read_at timestamp with time zone,
    image_url text,
    image_urls text[],
    link_preview jsonb,
    reply_to_id integer,
    reaction text,
    deleted_for_sender boolean DEFAULT false,
    deleted_for_receiver boolean DEFAULT false,
    deleted_for_everyone boolean DEFAULT false
);


ALTER TABLE public.chat_messages OWNER TO postgres;

--
-- Name: COLUMN chat_messages.image_urls; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.chat_messages.image_urls IS 'Array of all image URLs when message has multiple images. image_url contains the primary/first image for backward compatibility.';


--
-- Name: COLUMN chat_messages.link_preview; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.chat_messages.link_preview IS 'JSONB object containing: url, title, description, image, siteName';


--
-- Name: chat_messages_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.chat_messages_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.chat_messages_id_seq OWNER TO postgres;

--
-- Name: chat_messages_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.chat_messages_id_seq OWNED BY public.chat_messages.id;


--
-- Name: chats; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.chats (
    id integer NOT NULL,
    roll_request_id integer,
    created_at timestamp with time zone DEFAULT now(),
    last_message_at timestamp with time zone
);


ALTER TABLE public.chats OWNER TO postgres;

--
-- Name: chats_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.chats_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.chats_id_seq OWNER TO postgres;

--
-- Name: chats_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.chats_id_seq OWNED BY public.chats.id;


--
-- Name: custom_techniques; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.custom_techniques (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id text NOT NULL,
    belt text NOT NULL,
    technique_id text NOT NULL,
    name text NOT NULL,
    category text NOT NULL,
    description text DEFAULT ''::text,
    created_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.custom_techniques OWNER TO postgres;

--
-- Name: deleted_chats; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.deleted_chats (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    chat_id integer NOT NULL,
    user_id text NOT NULL,
    deleted_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.deleted_chats OWNER TO postgres;

--
-- Name: event_rsvps; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.event_rsvps (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    event_id uuid NOT NULL,
    user_id text NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.event_rsvps OWNER TO postgres;

--
-- Name: events; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    creator_id text NOT NULL,
    title text NOT NULL,
    description text DEFAULT ''::text,
    event_type text NOT NULL,
    event_date timestamp with time zone NOT NULL,
    end_date timestamp with time zone,
    location_name text NOT NULL,
    location_address text,
    latitude double precision,
    longitude double precision,
    external_link text,
    is_deleted boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    cover_image_url text
);


ALTER TABLE public.events OWNER TO postgres;

--
-- Name: hidden_posts; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.hidden_posts (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    post_id uuid NOT NULL,
    user_id text NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.hidden_posts OWNER TO postgres;

--
-- Name: TABLE hidden_posts; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE public.hidden_posts IS 'Stores posts that users have hidden from their feed';


--
-- Name: COLUMN hidden_posts.post_id; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.hidden_posts.post_id IS 'ID of the hidden post';


--
-- Name: COLUMN hidden_posts.user_id; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.hidden_posts.user_id IS 'ID of the user who hid the post';


--
-- Name: matches; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.matches (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    user1_id text,
    user2_id text,
    match_date timestamp with time zone DEFAULT now(),
    feedback text,
    confirmed boolean DEFAULT false,
    style public.style_preference NOT NULL,
    status public.match_status DEFAULT 'pending'::public.match_status NOT NULL,
    CONSTRAINT different_users CHECK ((user1_id <> user2_id))
);


ALTER TABLE public.matches OWNER TO postgres;

--
-- Name: notifications; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.notifications (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id text NOT NULL,
    type text NOT NULL,
    title text NOT NULL,
    body text,
    actor_id text,
    actor_name text,
    actor_avatar text,
    reference_id text,
    is_read boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.notifications OWNER TO postgres;

--
-- Name: photo_likes; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.photo_likes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    post_id uuid NOT NULL,
    photo_index integer NOT NULL,
    user_id text NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.photo_likes OWNER TO postgres;

--
-- Name: TABLE photo_likes; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE public.photo_likes IS 'Stores likes for individual photos in multi-image posts';


--
-- Name: post_comments; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.post_comments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    post_id uuid NOT NULL,
    user_id text NOT NULL,
    content text NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    is_deleted boolean DEFAULT false
);


ALTER TABLE public.post_comments OWNER TO postgres;

--
-- Name: post_likes; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.post_likes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    post_id uuid NOT NULL,
    user_id text NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.post_likes OWNER TO postgres;

--
-- Name: post_reports; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.post_reports (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    post_id uuid NOT NULL,
    reported_by text NOT NULL,
    reason text NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.post_reports OWNER TO postgres;

--
-- Name: TABLE post_reports; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE public.post_reports IS 'Stores user reports for posts';


--
-- Name: COLUMN post_reports.post_id; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.post_reports.post_id IS 'ID of the reported post';


--
-- Name: COLUMN post_reports.reported_by; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.post_reports.reported_by IS 'ID of the user who reported the post';


--
-- Name: COLUMN post_reports.reason; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.post_reports.reason IS 'Reason for reporting the post';


--
-- Name: posts; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.posts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id text NOT NULL,
    content text NOT NULL,
    media_type character varying(20),
    media_url text,
    video_thumbnail_url text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    is_deleted boolean DEFAULT false,
    media_urls text[],
    media_captions text[],
    link_preview jsonb,
    CONSTRAINT posts_media_type_check CHECK (((media_type)::text = ANY ((ARRAY['none'::character varying, 'image'::character varying, 'video'::character varying])::text[])))
);


ALTER TABLE public.posts OWNER TO postgres;

--
-- Name: COLUMN posts.media_urls; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.posts.media_urls IS 'Array of all media URLs when post has multiple images. media_url contains the primary/first image.';


--
-- Name: COLUMN posts.link_preview; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.posts.link_preview IS 'JSONB object containing: url, title, description, image, siteName';


--
-- Name: roll_requests_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.roll_requests_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.roll_requests_id_seq OWNER TO postgres;

--
-- Name: roll_requests_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.roll_requests_id_seq OWNED BY public.roll_requests.id;


--
-- Name: support_tickets; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.support_tickets (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    user_id text NOT NULL,
    subject text NOT NULL,
    message text NOT NULL,
    status text DEFAULT 'open'::text NOT NULL,
    admin_response text,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    resolved_at timestamp without time zone,
    CONSTRAINT support_tickets_status_check CHECK ((status = ANY (ARRAY['open'::text, 'in_progress'::text, 'resolved'::text, 'closed'::text])))
);


ALTER TABLE public.support_tickets OWNER TO postgres;

--
-- Name: TABLE support_tickets; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE public.support_tickets IS 'Stores user support requests and tickets';


--
-- Name: COLUMN support_tickets.status; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.support_tickets.status IS 'Ticket status: open, in_progress, resolved, closed';


--
-- Name: COLUMN support_tickets.admin_response; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.support_tickets.admin_response IS 'Response from support team';


--
-- Name: training_logs; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.training_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id text NOT NULL,
    date timestamp with time zone NOT NULL,
    duration_minutes integer NOT NULL,
    training_type text NOT NULL,
    intensity text NOT NULL,
    techniques_practiced text[] DEFAULT '{}'::text[],
    sparring_rounds integer DEFAULT 0,
    notes text DEFAULT ''::text,
    partner_id text,
    gym_name text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.training_logs OWNER TO postgres;

--
-- Name: achievement_endorsements id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.achievement_endorsements ALTER COLUMN id SET DEFAULT nextval('public.achievement_endorsements_id_seq'::regclass);


--
-- Name: achievement_verifications id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.achievement_verifications ALTER COLUMN id SET DEFAULT nextval('public.achievement_verifications_id_seq'::regclass);


--
-- Name: achievements id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.achievements ALTER COLUMN id SET DEFAULT nextval('public.achievements_id_seq'::regclass);


--
-- Name: availability id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.availability ALTER COLUMN id SET DEFAULT nextval('public.availability_id_seq'::regclass);


--
-- Name: belt_endorsements id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.belt_endorsements ALTER COLUMN id SET DEFAULT nextval('public.belt_endorsements_id_seq'::regclass);


--
-- Name: belt_verification_endorsements id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.belt_verification_endorsements ALTER COLUMN id SET DEFAULT nextval('public.belt_verification_endorsements_id_seq'::regclass);


--
-- Name: belt_verifications id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.belt_verifications ALTER COLUMN id SET DEFAULT nextval('public.belt_verifications_id_seq'::regclass);


--
-- Name: chat_messages id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.chat_messages ALTER COLUMN id SET DEFAULT nextval('public.chat_messages_id_seq'::regclass);


--
-- Name: chats id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.chats ALTER COLUMN id SET DEFAULT nextval('public.chats_id_seq'::regclass);


--
-- Name: roll_requests id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.roll_requests ALTER COLUMN id SET DEFAULT nextval('public.roll_requests_id_seq'::regclass);


--
-- Name: achievement_endorsements achievement_endorsements_achievement_id_endorser_user_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.achievement_endorsements
    ADD CONSTRAINT achievement_endorsements_achievement_id_endorser_user_id_key UNIQUE (achievement_id, endorser_user_id);


--
-- Name: achievement_endorsements achievement_endorsements_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.achievement_endorsements
    ADD CONSTRAINT achievement_endorsements_pkey PRIMARY KEY (id);


--
-- Name: achievement_verifications achievement_verifications_achievement_id_verifier_user_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.achievement_verifications
    ADD CONSTRAINT achievement_verifications_achievement_id_verifier_user_id_key UNIQUE (achievement_id, verifier_user_id);


--
-- Name: achievement_verifications achievement_verifications_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.achievement_verifications
    ADD CONSTRAINT achievement_verifications_pkey PRIMARY KEY (id);


--
-- Name: achievements achievements_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.achievements
    ADD CONSTRAINT achievements_pkey PRIMARY KEY (id);


--
-- Name: availability availability_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.availability
    ADD CONSTRAINT availability_pkey PRIMARY KEY (id);


--
-- Name: belt_endorsements belt_endorsements_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.belt_endorsements
    ADD CONSTRAINT belt_endorsements_pkey PRIMARY KEY (id);


--
-- Name: belt_endorsements belt_endorsements_user_id_endorser_user_id_belt_level_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.belt_endorsements
    ADD CONSTRAINT belt_endorsements_user_id_endorser_user_id_belt_level_key UNIQUE (user_id, endorser_user_id, belt_level);


--
-- Name: belt_progress belt_progress_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.belt_progress
    ADD CONSTRAINT belt_progress_pkey PRIMARY KEY (id);


--
-- Name: belt_progress belt_progress_user_id_belt_technique_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.belt_progress
    ADD CONSTRAINT belt_progress_user_id_belt_technique_id_key UNIQUE (user_id, belt, technique_id);


--
-- Name: belt_verification_endorsements belt_verification_endorsement_verification_id_endorser_user_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.belt_verification_endorsements
    ADD CONSTRAINT belt_verification_endorsement_verification_id_endorser_user_key UNIQUE (verification_id, endorser_user_id);


--
-- Name: belt_verification_endorsements belt_verification_endorsements_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.belt_verification_endorsements
    ADD CONSTRAINT belt_verification_endorsements_pkey PRIMARY KEY (id);


--
-- Name: belt_verifications belt_verifications_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.belt_verifications
    ADD CONSTRAINT belt_verifications_pkey PRIMARY KEY (id);


--
-- Name: belt_verifications belt_verifications_user_id_verifier_user_id_belt_level_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.belt_verifications
    ADD CONSTRAINT belt_verifications_user_id_verifier_user_id_belt_level_key UNIQUE (user_id, verifier_user_id, belt_level);


--
-- Name: blocked_users blocked_users_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.blocked_users
    ADD CONSTRAINT blocked_users_pkey PRIMARY KEY (id);


--
-- Name: blocked_users blocked_users_user_id_blocked_user_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.blocked_users
    ADD CONSTRAINT blocked_users_user_id_blocked_user_id_key UNIQUE (user_id, blocked_user_id);


--
-- Name: chat_messages chat_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.chat_messages
    ADD CONSTRAINT chat_messages_pkey PRIMARY KEY (id);


--
-- Name: chats chats_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.chats
    ADD CONSTRAINT chats_pkey PRIMARY KEY (id);


--
-- Name: custom_techniques custom_techniques_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.custom_techniques
    ADD CONSTRAINT custom_techniques_pkey PRIMARY KEY (id);


--
-- Name: custom_techniques custom_techniques_user_id_belt_technique_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.custom_techniques
    ADD CONSTRAINT custom_techniques_user_id_belt_technique_id_key UNIQUE (user_id, belt, technique_id);


--
-- Name: deleted_chats deleted_chats_chat_id_user_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.deleted_chats
    ADD CONSTRAINT deleted_chats_chat_id_user_id_key UNIQUE (chat_id, user_id);


--
-- Name: deleted_chats deleted_chats_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.deleted_chats
    ADD CONSTRAINT deleted_chats_pkey PRIMARY KEY (id);


--
-- Name: event_rsvps event_rsvps_event_id_user_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.event_rsvps
    ADD CONSTRAINT event_rsvps_event_id_user_id_key UNIQUE (event_id, user_id);


--
-- Name: event_rsvps event_rsvps_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.event_rsvps
    ADD CONSTRAINT event_rsvps_pkey PRIMARY KEY (id);


--
-- Name: events events_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.events
    ADD CONSTRAINT events_pkey PRIMARY KEY (id);


--
-- Name: hidden_posts hidden_posts_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.hidden_posts
    ADD CONSTRAINT hidden_posts_pkey PRIMARY KEY (id);


--
-- Name: hidden_posts hidden_posts_post_id_user_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.hidden_posts
    ADD CONSTRAINT hidden_posts_post_id_user_id_key UNIQUE (post_id, user_id);


--
-- Name: matches matches_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.matches
    ADD CONSTRAINT matches_pkey PRIMARY KEY (id);


--
-- Name: notifications notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_pkey PRIMARY KEY (id);


--
-- Name: photo_likes photo_likes_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.photo_likes
    ADD CONSTRAINT photo_likes_pkey PRIMARY KEY (id);


--
-- Name: photo_likes photo_likes_post_id_photo_index_user_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.photo_likes
    ADD CONSTRAINT photo_likes_post_id_photo_index_user_id_key UNIQUE (post_id, photo_index, user_id);


--
-- Name: post_comments post_comments_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.post_comments
    ADD CONSTRAINT post_comments_pkey PRIMARY KEY (id);


--
-- Name: post_likes post_likes_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.post_likes
    ADD CONSTRAINT post_likes_pkey PRIMARY KEY (id);


--
-- Name: post_likes post_likes_post_id_user_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.post_likes
    ADD CONSTRAINT post_likes_post_id_user_id_key UNIQUE (post_id, user_id);


--
-- Name: post_reports post_reports_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.post_reports
    ADD CONSTRAINT post_reports_pkey PRIMARY KEY (id);


--
-- Name: post_reports post_reports_post_id_reported_by_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.post_reports
    ADD CONSTRAINT post_reports_post_id_reported_by_key UNIQUE (post_id, reported_by);


--
-- Name: posts posts_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.posts
    ADD CONSTRAINT posts_pkey PRIMARY KEY (id);


--
-- Name: roll_requests roll_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.roll_requests
    ADD CONSTRAINT roll_requests_pkey PRIMARY KEY (id);


--
-- Name: support_tickets support_tickets_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.support_tickets
    ADD CONSTRAINT support_tickets_pkey PRIMARY KEY (id);


--
-- Name: training_logs training_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.training_logs
    ADD CONSTRAINT training_logs_pkey PRIMARY KEY (id);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: idx_achievement_endorsements_achievement; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_achievement_endorsements_achievement ON public.achievement_endorsements USING btree (achievement_id);


--
-- Name: idx_achievement_endorsements_endorser; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_achievement_endorsements_endorser ON public.achievement_endorsements USING btree (endorser_user_id);


--
-- Name: idx_achievements_date; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_achievements_date ON public.achievements USING btree (competition_date DESC);


--
-- Name: idx_achievements_user; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_achievements_user ON public.achievements USING btree (user_id);


--
-- Name: idx_achievements_user_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_achievements_user_id ON public.achievements USING btree (user_id);


--
-- Name: idx_belt_endorsements_belt_level; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_belt_endorsements_belt_level ON public.belt_endorsements USING btree (belt_level);


--
-- Name: idx_belt_endorsements_endorser; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_belt_endorsements_endorser ON public.belt_endorsements USING btree (endorser_user_id);


--
-- Name: idx_belt_endorsements_endorser_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_belt_endorsements_endorser_id ON public.belt_verification_endorsements USING btree (endorser_user_id);


--
-- Name: idx_belt_endorsements_user_belt; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_belt_endorsements_user_belt ON public.belt_endorsements USING btree (user_id, belt_level);


--
-- Name: idx_belt_endorsements_user_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_belt_endorsements_user_id ON public.belt_endorsements USING btree (user_id);


--
-- Name: idx_belt_endorsements_verification_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_belt_endorsements_verification_id ON public.belt_verification_endorsements USING btree (verification_id);


--
-- Name: idx_belt_progress_user; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_belt_progress_user ON public.belt_progress USING btree (user_id, belt);


--
-- Name: idx_belt_verifications_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_belt_verifications_status ON public.belt_verifications USING btree (status);


--
-- Name: idx_belt_verifications_user; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_belt_verifications_user ON public.belt_verifications USING btree (user_id);


--
-- Name: idx_belt_verifications_user_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_belt_verifications_user_id ON public.belt_verifications USING btree (user_id);


--
-- Name: idx_belt_verifications_verified; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_belt_verifications_verified ON public.belt_verifications USING btree (is_verified);


--
-- Name: idx_belt_verifications_verifier; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_belt_verifications_verifier ON public.belt_verifications USING btree (verifier_user_id);


--
-- Name: idx_blocked_users_blocked_user_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_blocked_users_blocked_user_id ON public.blocked_users USING btree (blocked_user_id);


--
-- Name: idx_blocked_users_user_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_blocked_users_user_id ON public.blocked_users USING btree (user_id);


--
-- Name: idx_chat_messages_image_url; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_chat_messages_image_url ON public.chat_messages USING btree (image_url) WHERE (image_url IS NOT NULL);


--
-- Name: idx_chat_messages_image_urls; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_chat_messages_image_urls ON public.chat_messages USING gin (image_urls) WHERE (image_urls IS NOT NULL);


--
-- Name: idx_chat_messages_link_preview; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_chat_messages_link_preview ON public.chat_messages USING gin (link_preview);


--
-- Name: idx_chat_messages_read_at; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_chat_messages_read_at ON public.chat_messages USING btree (chat_id, read_at) WHERE (read_at IS NULL);


--
-- Name: idx_chat_messages_reply_to; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_chat_messages_reply_to ON public.chat_messages USING btree (reply_to_id);


--
-- Name: idx_chat_messages_sender_read; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_chat_messages_sender_read ON public.chat_messages USING btree (sender_id, read_at);


--
-- Name: idx_custom_techniques_user; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_custom_techniques_user ON public.custom_techniques USING btree (user_id, belt);


--
-- Name: idx_deleted_chats_user; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_deleted_chats_user ON public.deleted_chats USING btree (user_id);


--
-- Name: idx_event_rsvps_event; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_event_rsvps_event ON public.event_rsvps USING btree (event_id);


--
-- Name: idx_events_date; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_events_date ON public.events USING btree (event_date DESC) WHERE (is_deleted = false);


--
-- Name: idx_events_location; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_events_location ON public.events USING btree (latitude, longitude) WHERE (is_deleted = false);


--
-- Name: idx_hidden_posts_post_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_hidden_posts_post_id ON public.hidden_posts USING btree (post_id);


--
-- Name: idx_hidden_posts_user_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_hidden_posts_user_id ON public.hidden_posts USING btree (user_id);


--
-- Name: idx_matches_users; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_matches_users ON public.matches USING btree (user1_id, user2_id);


--
-- Name: idx_notifications_unread; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_notifications_unread ON public.notifications USING btree (user_id, is_read) WHERE (is_read = false);


--
-- Name: idx_notifications_user; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_notifications_user ON public.notifications USING btree (user_id, created_at DESC);


--
-- Name: idx_photo_likes_post_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_photo_likes_post_id ON public.photo_likes USING btree (post_id);


--
-- Name: idx_photo_likes_post_photo; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_photo_likes_post_photo ON public.photo_likes USING btree (post_id, photo_index);


--
-- Name: idx_photo_likes_user_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_photo_likes_user_id ON public.photo_likes USING btree (user_id);


--
-- Name: idx_post_comments_created_at; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_post_comments_created_at ON public.post_comments USING btree (created_at DESC);


--
-- Name: idx_post_comments_post_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_post_comments_post_id ON public.post_comments USING btree (post_id);


--
-- Name: idx_post_comments_user_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_post_comments_user_id ON public.post_comments USING btree (user_id);


--
-- Name: idx_post_likes_post_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_post_likes_post_id ON public.post_likes USING btree (post_id);


--
-- Name: idx_post_likes_user_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_post_likes_user_id ON public.post_likes USING btree (user_id);


--
-- Name: idx_post_reports_post_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_post_reports_post_id ON public.post_reports USING btree (post_id);


--
-- Name: idx_post_reports_reported_by; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_post_reports_reported_by ON public.post_reports USING btree (reported_by);


--
-- Name: idx_posts_created_at; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_posts_created_at ON public.posts USING btree (created_at DESC);


--
-- Name: idx_posts_is_deleted; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_posts_is_deleted ON public.posts USING btree (is_deleted) WHERE (is_deleted = false);


--
-- Name: idx_posts_link_preview; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_posts_link_preview ON public.posts USING gin (link_preview);


--
-- Name: idx_posts_user_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_posts_user_id ON public.posts USING btree (user_id);


--
-- Name: idx_support_tickets_created_at; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_support_tickets_created_at ON public.support_tickets USING btree (created_at DESC);


--
-- Name: idx_support_tickets_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_support_tickets_status ON public.support_tickets USING btree (status);


--
-- Name: idx_support_tickets_user_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_support_tickets_user_id ON public.support_tickets USING btree (user_id);


--
-- Name: idx_training_logs_user_date; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_training_logs_user_date ON public.training_logs USING btree (user_id, date DESC);


--
-- Name: idx_users_available_now; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_users_available_now ON public.users USING btree (available_now) WHERE (available_now = true);


--
-- Name: idx_users_city; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_users_city ON public.users USING btree (city);


--
-- Name: idx_users_is_instructor; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_users_is_instructor ON public.users USING btree (is_instructor) WHERE (is_instructor = true);


--
-- Name: idx_users_last_active_at; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_users_last_active_at ON public.users USING btree (last_active_at);


--
-- Name: idx_users_location; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_users_location ON public.users USING btree (latitude, longitude) WHERE ((latitude IS NOT NULL) AND (longitude IS NOT NULL));


--
-- Name: idx_users_primary_gym; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_users_primary_gym ON public.users USING btree (primary_gym) WHERE (primary_gym IS NOT NULL);


--
-- Name: idx_users_zip_code; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_users_zip_code ON public.users USING btree (zip_code);


--
-- Name: idx_verifications_achievement; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_verifications_achievement ON public.achievement_verifications USING btree (achievement_id);


--
-- Name: idx_verifications_verifier; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_verifications_verifier ON public.achievement_verifications USING btree (verifier_user_id);


--
-- Name: users_location_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX users_location_idx ON public.users USING gist (location);


--
-- Name: achievement_endorsements achievement_endorsement_count_trigger; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER achievement_endorsement_count_trigger AFTER INSERT OR DELETE ON public.achievement_endorsements FOR EACH ROW EXECUTE FUNCTION public.update_achievement_endorsement_count();


--
-- Name: achievement_verifications achievement_verification_count_trigger; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER achievement_verification_count_trigger AFTER INSERT OR DELETE ON public.achievement_verifications FOR EACH ROW EXECUTE FUNCTION public.update_achievement_verification_count();


--
-- Name: belt_verifications belt_verification_trigger; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER belt_verification_trigger AFTER UPDATE ON public.belt_verifications FOR EACH ROW EXECUTE FUNCTION public.update_user_belt_verification();


--
-- Name: belt_verifications belt_verification_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER belt_verification_updated_at BEFORE UPDATE ON public.belt_verifications FOR EACH ROW EXECUTE FUNCTION public.update_belt_verification_updated_at();


--
-- Name: support_tickets support_ticket_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER support_ticket_updated_at BEFORE UPDATE ON public.support_tickets FOR EACH ROW EXECUTE FUNCTION public.update_support_ticket_timestamp();


--
-- Name: achievement_endorsements achievement_endorsements_achievement_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.achievement_endorsements
    ADD CONSTRAINT achievement_endorsements_achievement_id_fkey FOREIGN KEY (achievement_id) REFERENCES public.achievements(id) ON DELETE CASCADE;


--
-- Name: achievement_endorsements achievement_endorsements_endorser_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.achievement_endorsements
    ADD CONSTRAINT achievement_endorsements_endorser_user_id_fkey FOREIGN KEY (endorser_user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: achievement_verifications achievement_verifications_achievement_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.achievement_verifications
    ADD CONSTRAINT achievement_verifications_achievement_id_fkey FOREIGN KEY (achievement_id) REFERENCES public.achievements(id) ON DELETE CASCADE;


--
-- Name: achievement_verifications achievement_verifications_verifier_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.achievement_verifications
    ADD CONSTRAINT achievement_verifications_verifier_user_id_fkey FOREIGN KEY (verifier_user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: achievements achievements_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.achievements
    ADD CONSTRAINT achievements_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: availability availability_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.availability
    ADD CONSTRAINT availability_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: belt_endorsements belt_endorsements_endorser_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.belt_endorsements
    ADD CONSTRAINT belt_endorsements_endorser_user_id_fkey FOREIGN KEY (endorser_user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: belt_endorsements belt_endorsements_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.belt_endorsements
    ADD CONSTRAINT belt_endorsements_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: belt_progress belt_progress_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.belt_progress
    ADD CONSTRAINT belt_progress_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: belt_verification_endorsements belt_verification_endorsements_endorser_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.belt_verification_endorsements
    ADD CONSTRAINT belt_verification_endorsements_endorser_user_id_fkey FOREIGN KEY (endorser_user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: belt_verification_endorsements belt_verification_endorsements_verification_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.belt_verification_endorsements
    ADD CONSTRAINT belt_verification_endorsements_verification_id_fkey FOREIGN KEY (verification_id) REFERENCES public.belt_verifications(id) ON DELETE CASCADE;


--
-- Name: belt_verifications belt_verifications_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.belt_verifications
    ADD CONSTRAINT belt_verifications_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: belt_verifications belt_verifications_verifier_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.belt_verifications
    ADD CONSTRAINT belt_verifications_verifier_user_id_fkey FOREIGN KEY (verifier_user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: blocked_users blocked_users_blocked_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.blocked_users
    ADD CONSTRAINT blocked_users_blocked_user_id_fkey FOREIGN KEY (blocked_user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: blocked_users blocked_users_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.blocked_users
    ADD CONSTRAINT blocked_users_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: chat_messages chat_messages_chat_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.chat_messages
    ADD CONSTRAINT chat_messages_chat_id_fkey FOREIGN KEY (chat_id) REFERENCES public.chats(id) ON DELETE CASCADE;


--
-- Name: chat_messages chat_messages_reply_to_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.chat_messages
    ADD CONSTRAINT chat_messages_reply_to_id_fkey FOREIGN KEY (reply_to_id) REFERENCES public.chat_messages(id);


--
-- Name: chat_messages chat_messages_sender_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.chat_messages
    ADD CONSTRAINT chat_messages_sender_id_fkey FOREIGN KEY (sender_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: chats chats_roll_request_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.chats
    ADD CONSTRAINT chats_roll_request_id_fkey FOREIGN KEY (roll_request_id) REFERENCES public.roll_requests(id) ON DELETE CASCADE;


--
-- Name: custom_techniques custom_techniques_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.custom_techniques
    ADD CONSTRAINT custom_techniques_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: deleted_chats deleted_chats_chat_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.deleted_chats
    ADD CONSTRAINT deleted_chats_chat_id_fkey FOREIGN KEY (chat_id) REFERENCES public.chats(id) ON DELETE CASCADE;


--
-- Name: deleted_chats deleted_chats_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.deleted_chats
    ADD CONSTRAINT deleted_chats_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: event_rsvps event_rsvps_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.event_rsvps
    ADD CONSTRAINT event_rsvps_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.events(id) ON DELETE CASCADE;


--
-- Name: event_rsvps event_rsvps_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.event_rsvps
    ADD CONSTRAINT event_rsvps_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: events events_creator_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.events
    ADD CONSTRAINT events_creator_id_fkey FOREIGN KEY (creator_id) REFERENCES public.users(id);


--
-- Name: hidden_posts hidden_posts_post_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.hidden_posts
    ADD CONSTRAINT hidden_posts_post_id_fkey FOREIGN KEY (post_id) REFERENCES public.posts(id) ON DELETE CASCADE;


--
-- Name: hidden_posts hidden_posts_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.hidden_posts
    ADD CONSTRAINT hidden_posts_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: notifications notifications_actor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES public.users(id);


--
-- Name: notifications notifications_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: photo_likes photo_likes_post_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.photo_likes
    ADD CONSTRAINT photo_likes_post_id_fkey FOREIGN KEY (post_id) REFERENCES public.posts(id) ON DELETE CASCADE;


--
-- Name: photo_likes photo_likes_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.photo_likes
    ADD CONSTRAINT photo_likes_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: post_comments post_comments_post_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.post_comments
    ADD CONSTRAINT post_comments_post_id_fkey FOREIGN KEY (post_id) REFERENCES public.posts(id) ON DELETE CASCADE;


--
-- Name: post_comments post_comments_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.post_comments
    ADD CONSTRAINT post_comments_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: post_likes post_likes_post_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.post_likes
    ADD CONSTRAINT post_likes_post_id_fkey FOREIGN KEY (post_id) REFERENCES public.posts(id) ON DELETE CASCADE;


--
-- Name: post_likes post_likes_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.post_likes
    ADD CONSTRAINT post_likes_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: post_reports post_reports_post_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.post_reports
    ADD CONSTRAINT post_reports_post_id_fkey FOREIGN KEY (post_id) REFERENCES public.posts(id) ON DELETE CASCADE;


--
-- Name: post_reports post_reports_reported_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.post_reports
    ADD CONSTRAINT post_reports_reported_by_fkey FOREIGN KEY (reported_by) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: posts posts_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.posts
    ADD CONSTRAINT posts_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: roll_requests roll_requests_receiver_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.roll_requests
    ADD CONSTRAINT roll_requests_receiver_id_fkey FOREIGN KEY (receiver_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: roll_requests roll_requests_sender_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.roll_requests
    ADD CONSTRAINT roll_requests_sender_id_fkey FOREIGN KEY (sender_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: support_tickets support_tickets_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.support_tickets
    ADD CONSTRAINT support_tickets_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: training_logs training_logs_partner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.training_logs
    ADD CONSTRAINT training_logs_partner_id_fkey FOREIGN KEY (partner_id) REFERENCES public.users(id);


--
-- Name: training_logs training_logs_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.training_logs
    ADD CONSTRAINT training_logs_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: post_comments Anyone can view comments; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Anyone can view comments" ON public.post_comments FOR SELECT USING ((is_deleted = false));


--
-- Name: post_likes Anyone can view likes; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Anyone can view likes" ON public.post_likes FOR SELECT USING (true);


--
-- Name: posts Anyone can view posts; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Anyone can view posts" ON public.posts FOR SELECT USING ((is_deleted = false));


--
-- Name: belt_verifications Belt verifications are viewable by everyone; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Belt verifications are viewable by everyone" ON public.belt_verifications FOR SELECT USING (true);


--
-- Name: achievement_endorsements Endorsements are viewable by everyone; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Endorsements are viewable by everyone" ON public.achievement_endorsements FOR SELECT USING (true);


--
-- Name: belt_verifications Instructors can verify belt promotions; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Instructors can verify belt promotions" ON public.belt_verifications FOR UPDATE USING (((auth.uid())::text = verifier_user_id));


--
-- Name: belt_endorsements Users can create belt endorsements; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users can create belt endorsements" ON public.belt_endorsements FOR INSERT TO authenticated WITH CHECK ((((auth.uid())::text = endorser_user_id) AND ((auth.uid())::text <> user_id)));


--
-- Name: post_comments Users can create comments; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users can create comments" ON public.post_comments FOR INSERT WITH CHECK (((auth.uid())::text = user_id));


--
-- Name: belt_verification_endorsements Users can create endorsements; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users can create endorsements" ON public.belt_verification_endorsements FOR INSERT TO authenticated WITH CHECK (((auth.uid())::text = endorser_user_id));


--
-- Name: belt_verifications Users can create their own belt verification requests; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users can create their own belt verification requests" ON public.belt_verifications FOR INSERT WITH CHECK (((auth.uid())::text = user_id));


--
-- Name: belt_verifications Users can create their own belt verifications; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users can create their own belt verifications" ON public.belt_verifications FOR INSERT TO authenticated WITH CHECK (((auth.uid())::text = user_id));


--
-- Name: posts Users can create their own posts; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users can create their own posts" ON public.posts FOR INSERT WITH CHECK (((auth.uid())::text = user_id));


--
-- Name: post_comments Users can delete their own comments; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users can delete their own comments" ON public.post_comments FOR DELETE USING (((auth.uid())::text = user_id));


--
-- Name: belt_endorsements Users can delete their own endorsements; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users can delete their own endorsements" ON public.belt_endorsements FOR DELETE TO authenticated USING (((auth.uid())::text = endorser_user_id));


--
-- Name: belt_verification_endorsements Users can delete their own endorsements; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users can delete their own endorsements" ON public.belt_verification_endorsements FOR DELETE TO authenticated USING (((auth.uid())::text = endorser_user_id));


--
-- Name: posts Users can delete their own posts; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users can delete their own posts" ON public.posts FOR DELETE USING (((auth.uid())::text = user_id));


--
-- Name: belt_verifications Users can delete their own unverified belt requests; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users can delete their own unverified belt requests" ON public.belt_verifications FOR DELETE USING ((((auth.uid())::text = user_id) AND ((is_verified IS NULL) OR (is_verified = false))));


--
-- Name: achievement_endorsements Users can endorse achievements; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users can endorse achievements" ON public.achievement_endorsements FOR INSERT WITH CHECK (((auth.uid())::text = endorser_user_id));


--
-- Name: photo_likes Users can like photos; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users can like photos" ON public.photo_likes FOR INSERT TO authenticated WITH CHECK (((auth.uid())::text = user_id));


--
-- Name: post_likes Users can like posts; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users can like posts" ON public.post_likes FOR INSERT WITH CHECK (((auth.uid())::text = user_id));


--
-- Name: achievement_endorsements Users can remove their own endorsements; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users can remove their own endorsements" ON public.achievement_endorsements FOR DELETE USING (((auth.uid())::text = endorser_user_id));


--
-- Name: post_likes Users can unlike posts; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users can unlike posts" ON public.post_likes FOR DELETE USING (((auth.uid())::text = user_id));


--
-- Name: photo_likes Users can unlike their own photo likes; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users can unlike their own photo likes" ON public.photo_likes FOR DELETE TO authenticated USING (((auth.uid())::text = user_id));


--
-- Name: belt_verifications Users can update their own belt verifications; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users can update their own belt verifications" ON public.belt_verifications FOR UPDATE TO authenticated USING (((auth.uid())::text = user_id));


--
-- Name: post_comments Users can update their own comments; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users can update their own comments" ON public.post_comments FOR UPDATE USING (((auth.uid())::text = user_id));


--
-- Name: posts Users can update their own posts; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users can update their own posts" ON public.posts FOR UPDATE USING (((auth.uid())::text = user_id));


--
-- Name: belt_verifications Users can update their own unverified belt requests; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users can update their own unverified belt requests" ON public.belt_verifications FOR UPDATE USING ((((auth.uid())::text = user_id) AND ((is_verified IS NULL) OR (is_verified = false))));


--
-- Name: belt_endorsements Users can view all belt endorsements; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users can view all belt endorsements" ON public.belt_endorsements FOR SELECT TO authenticated USING (true);


--
-- Name: belt_verifications Users can view all belt verifications; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users can view all belt verifications" ON public.belt_verifications FOR SELECT TO authenticated USING (true);


--
-- Name: belt_verification_endorsements Users can view all endorsements; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users can view all endorsements" ON public.belt_verification_endorsements FOR SELECT TO authenticated USING (true);


--
-- Name: photo_likes Users can view all photo likes; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users can view all photo likes" ON public.photo_likes FOR SELECT TO authenticated USING (true);


--
-- Name: achievement_endorsements; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.achievement_endorsements ENABLE ROW LEVEL SECURITY;

--
-- Name: belt_endorsements; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.belt_endorsements ENABLE ROW LEVEL SECURITY;

--
-- Name: belt_verification_endorsements; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.belt_verification_endorsements ENABLE ROW LEVEL SECURITY;

--
-- Name: belt_verifications; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.belt_verifications ENABLE ROW LEVEL SECURITY;

--
-- Name: photo_likes; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.photo_likes ENABLE ROW LEVEL SECURITY;

--
-- Name: post_comments; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.post_comments ENABLE ROW LEVEL SECURITY;

--
-- Name: post_likes; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.post_likes ENABLE ROW LEVEL SECURITY;

--
-- Name: posts; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.posts ENABLE ROW LEVEL SECURITY;

--
-- Name: SCHEMA public; Type: ACL; Schema: -; Owner: pg_database_owner
--

GRANT USAGE ON SCHEMA public TO postgres;
GRANT USAGE ON SCHEMA public TO anon;
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT USAGE ON SCHEMA public TO service_role;


--
-- Name: TABLE roll_requests; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.roll_requests TO anon;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.roll_requests TO authenticated;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.roll_requests TO service_role;


--
-- Name: FUNCTION create_roll_request(p_sender_id text, p_receiver_id text); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.create_roll_request(p_sender_id text, p_receiver_id text) TO anon;
GRANT ALL ON FUNCTION public.create_roll_request(p_sender_id text, p_receiver_id text) TO authenticated;
GRANT ALL ON FUNCTION public.create_roll_request(p_sender_id text, p_receiver_id text) TO service_role;


--
-- Name: FUNCTION create_roll_request(p_sender_id character varying, p_receiver_id character varying); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.create_roll_request(p_sender_id character varying, p_receiver_id character varying) TO anon;
GRANT ALL ON FUNCTION public.create_roll_request(p_sender_id character varying, p_receiver_id character varying) TO authenticated;
GRANT ALL ON FUNCTION public.create_roll_request(p_sender_id character varying, p_receiver_id character varying) TO service_role;


--
-- Name: FUNCTION decrement_friends_count(user_id_param text); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.decrement_friends_count(user_id_param text) TO anon;
GRANT ALL ON FUNCTION public.decrement_friends_count(user_id_param text) TO authenticated;
GRANT ALL ON FUNCTION public.decrement_friends_count(user_id_param text) TO service_role;


--
-- Name: TABLE users; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.users TO anon;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.users TO authenticated;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.users TO service_role;


--
-- Name: FUNCTION find_nearby_users(lat double precision, lng double precision, radius_meters integer); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.find_nearby_users(lat double precision, lng double precision, radius_meters integer) TO anon;
GRANT ALL ON FUNCTION public.find_nearby_users(lat double precision, lng double precision, radius_meters integer) TO authenticated;
GRANT ALL ON FUNCTION public.find_nearby_users(lat double precision, lng double precision, radius_meters integer) TO service_role;


--
-- Name: FUNCTION find_nearby_users(lat_input numeric, lng_input numeric, max_distance_miles integer); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.find_nearby_users(lat_input numeric, lng_input numeric, max_distance_miles integer) TO anon;
GRANT ALL ON FUNCTION public.find_nearby_users(lat_input numeric, lng_input numeric, max_distance_miles integer) TO authenticated;
GRANT ALL ON FUNCTION public.find_nearby_users(lat_input numeric, lng_input numeric, max_distance_miles integer) TO service_role;


--
-- Name: FUNCTION find_potential_matches(p_requesting_user_id text, p_max_distance double precision); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.find_potential_matches(p_requesting_user_id text, p_max_distance double precision) TO anon;
GRANT ALL ON FUNCTION public.find_potential_matches(p_requesting_user_id text, p_max_distance double precision) TO authenticated;
GRANT ALL ON FUNCTION public.find_potential_matches(p_requesting_user_id text, p_max_distance double precision) TO service_role;


--
-- Name: FUNCTION find_potential_matches(p_requesting_user_id uuid, p_max_distance double precision); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.find_potential_matches(p_requesting_user_id uuid, p_max_distance double precision) TO anon;
GRANT ALL ON FUNCTION public.find_potential_matches(p_requesting_user_id uuid, p_max_distance double precision) TO authenticated;
GRANT ALL ON FUNCTION public.find_potential_matches(p_requesting_user_id uuid, p_max_distance double precision) TO service_role;


--
-- Name: FUNCTION get_coordinates(geom public.geometry); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.get_coordinates(geom public.geometry) TO anon;
GRANT ALL ON FUNCTION public.get_coordinates(geom public.geometry) TO authenticated;
GRANT ALL ON FUNCTION public.get_coordinates(geom public.geometry) TO service_role;


--
-- Name: FUNCTION get_photo_likes_for_post(p_post_id uuid, p_user_id text); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.get_photo_likes_for_post(p_post_id uuid, p_user_id text) TO anon;
GRANT ALL ON FUNCTION public.get_photo_likes_for_post(p_post_id uuid, p_user_id text) TO authenticated;
GRANT ALL ON FUNCTION public.get_photo_likes_for_post(p_post_id uuid, p_user_id text) TO service_role;


--
-- Name: FUNCTION get_post_comments(p_post_id uuid, p_limit integer, p_offset integer); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.get_post_comments(p_post_id uuid, p_limit integer, p_offset integer) TO anon;
GRANT ALL ON FUNCTION public.get_post_comments(p_post_id uuid, p_limit integer, p_offset integer) TO authenticated;
GRANT ALL ON FUNCTION public.get_post_comments(p_post_id uuid, p_limit integer, p_offset integer) TO service_role;


--
-- Name: FUNCTION get_posts_with_details(p_limit integer, p_offset integer, p_current_user_id text); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.get_posts_with_details(p_limit integer, p_offset integer, p_current_user_id text) TO anon;
GRANT ALL ON FUNCTION public.get_posts_with_details(p_limit integer, p_offset integer, p_current_user_id text) TO authenticated;
GRANT ALL ON FUNCTION public.get_posts_with_details(p_limit integer, p_offset integer, p_current_user_id text) TO service_role;


--
-- Name: FUNCTION get_posts_with_details(p_limit integer, p_offset integer, p_current_user_id text, p_since timestamp with time zone); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.get_posts_with_details(p_limit integer, p_offset integer, p_current_user_id text, p_since timestamp with time zone) TO anon;
GRANT ALL ON FUNCTION public.get_posts_with_details(p_limit integer, p_offset integer, p_current_user_id text, p_since timestamp with time zone) TO authenticated;
GRANT ALL ON FUNCTION public.get_posts_with_details(p_limit integer, p_offset integer, p_current_user_id text, p_since timestamp with time zone) TO service_role;


--
-- Name: FUNCTION get_single_post_with_details(p_post_id uuid, p_current_user_id text); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.get_single_post_with_details(p_post_id uuid, p_current_user_id text) TO anon;
GRANT ALL ON FUNCTION public.get_single_post_with_details(p_post_id uuid, p_current_user_id text) TO authenticated;
GRANT ALL ON FUNCTION public.get_single_post_with_details(p_post_id uuid, p_current_user_id text) TO service_role;


--
-- Name: FUNCTION get_user_location(user_id text); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.get_user_location(user_id text) TO anon;
GRANT ALL ON FUNCTION public.get_user_location(user_id text) TO authenticated;
GRANT ALL ON FUNCTION public.get_user_location(user_id text) TO service_role;


--
-- Name: FUNCTION get_user_posts_with_details(p_user_id text, p_current_user_id text, p_limit integer, p_offset integer); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.get_user_posts_with_details(p_user_id text, p_current_user_id text, p_limit integer, p_offset integer) TO anon;
GRANT ALL ON FUNCTION public.get_user_posts_with_details(p_user_id text, p_current_user_id text, p_limit integer, p_offset integer) TO authenticated;
GRANT ALL ON FUNCTION public.get_user_posts_with_details(p_user_id text, p_current_user_id text, p_limit integer, p_offset integer) TO service_role;


--
-- Name: FUNCTION get_users_with_coords(p_current_user_id text, p_limit integer, p_offset integer, p_belt text, p_gender text, p_age integer, p_weight integer, p_name text); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.get_users_with_coords(p_current_user_id text, p_limit integer, p_offset integer, p_belt text, p_gender text, p_age integer, p_weight integer, p_name text) TO anon;
GRANT ALL ON FUNCTION public.get_users_with_coords(p_current_user_id text, p_limit integer, p_offset integer, p_belt text, p_gender text, p_age integer, p_weight integer, p_name text) TO authenticated;
GRANT ALL ON FUNCTION public.get_users_with_coords(p_current_user_id text, p_limit integer, p_offset integer, p_belt text, p_gender text, p_age integer, p_weight integer, p_name text) TO service_role;


--
-- Name: FUNCTION get_users_with_location(exclude_user_id text); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.get_users_with_location(exclude_user_id text) TO anon;
GRANT ALL ON FUNCTION public.get_users_with_location(exclude_user_id text) TO authenticated;
GRANT ALL ON FUNCTION public.get_users_with_location(exclude_user_id text) TO service_role;


--
-- Name: FUNCTION increment_friends_count(user_id text); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.increment_friends_count(user_id text) TO anon;
GRANT ALL ON FUNCTION public.increment_friends_count(user_id text) TO authenticated;
GRANT ALL ON FUNCTION public.increment_friends_count(user_id text) TO service_role;


--
-- Name: FUNCTION search_locations(search_query text, result_limit integer); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.search_locations(search_query text, result_limit integer) TO anon;
GRANT ALL ON FUNCTION public.search_locations(search_query text, result_limit integer) TO authenticated;
GRANT ALL ON FUNCTION public.search_locations(search_query text, result_limit integer) TO service_role;


--
-- Name: FUNCTION search_posts_with_details(p_search_term text, p_current_user_id text, p_limit integer); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.search_posts_with_details(p_search_term text, p_current_user_id text, p_limit integer) TO anon;
GRANT ALL ON FUNCTION public.search_posts_with_details(p_search_term text, p_current_user_id text, p_limit integer) TO authenticated;
GRANT ALL ON FUNCTION public.search_posts_with_details(p_search_term text, p_current_user_id text, p_limit integer) TO service_role;


--
-- Name: FUNCTION update_achievement_endorsement_count(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.update_achievement_endorsement_count() TO anon;
GRANT ALL ON FUNCTION public.update_achievement_endorsement_count() TO authenticated;
GRANT ALL ON FUNCTION public.update_achievement_endorsement_count() TO service_role;


--
-- Name: FUNCTION update_achievement_verification_count(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.update_achievement_verification_count() TO anon;
GRANT ALL ON FUNCTION public.update_achievement_verification_count() TO authenticated;
GRANT ALL ON FUNCTION public.update_achievement_verification_count() TO service_role;


--
-- Name: FUNCTION update_belt_verification_updated_at(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.update_belt_verification_updated_at() TO anon;
GRANT ALL ON FUNCTION public.update_belt_verification_updated_at() TO authenticated;
GRANT ALL ON FUNCTION public.update_belt_verification_updated_at() TO service_role;


--
-- Name: FUNCTION update_support_ticket_timestamp(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.update_support_ticket_timestamp() TO anon;
GRANT ALL ON FUNCTION public.update_support_ticket_timestamp() TO authenticated;
GRANT ALL ON FUNCTION public.update_support_ticket_timestamp() TO service_role;


--
-- Name: FUNCTION update_user_belt_verification(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.update_user_belt_verification() TO anon;
GRANT ALL ON FUNCTION public.update_user_belt_verification() TO authenticated;
GRANT ALL ON FUNCTION public.update_user_belt_verification() TO service_role;


--
-- Name: TABLE achievement_endorsements; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.achievement_endorsements TO anon;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.achievement_endorsements TO authenticated;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.achievement_endorsements TO service_role;


--
-- Name: SEQUENCE achievement_endorsements_id_seq; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON SEQUENCE public.achievement_endorsements_id_seq TO anon;
GRANT ALL ON SEQUENCE public.achievement_endorsements_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.achievement_endorsements_id_seq TO service_role;


--
-- Name: TABLE achievement_verifications; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.achievement_verifications TO anon;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.achievement_verifications TO authenticated;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.achievement_verifications TO service_role;


--
-- Name: SEQUENCE achievement_verifications_id_seq; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON SEQUENCE public.achievement_verifications_id_seq TO anon;
GRANT ALL ON SEQUENCE public.achievement_verifications_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.achievement_verifications_id_seq TO service_role;


--
-- Name: TABLE achievements; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.achievements TO anon;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.achievements TO authenticated;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.achievements TO service_role;


--
-- Name: SEQUENCE achievements_id_seq; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON SEQUENCE public.achievements_id_seq TO anon;
GRANT ALL ON SEQUENCE public.achievements_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.achievements_id_seq TO service_role;


--
-- Name: TABLE availability; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.availability TO anon;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.availability TO authenticated;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.availability TO service_role;


--
-- Name: SEQUENCE availability_id_seq; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON SEQUENCE public.availability_id_seq TO anon;
GRANT ALL ON SEQUENCE public.availability_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.availability_id_seq TO service_role;


--
-- Name: TABLE belt_endorsements; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.belt_endorsements TO anon;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.belt_endorsements TO authenticated;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.belt_endorsements TO service_role;


--
-- Name: SEQUENCE belt_endorsements_id_seq; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON SEQUENCE public.belt_endorsements_id_seq TO anon;
GRANT ALL ON SEQUENCE public.belt_endorsements_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.belt_endorsements_id_seq TO service_role;


--
-- Name: TABLE belt_progress; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.belt_progress TO anon;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.belt_progress TO authenticated;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.belt_progress TO service_role;


--
-- Name: TABLE belt_verification_endorsements; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.belt_verification_endorsements TO anon;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.belt_verification_endorsements TO authenticated;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.belt_verification_endorsements TO service_role;


--
-- Name: SEQUENCE belt_verification_endorsements_id_seq; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON SEQUENCE public.belt_verification_endorsements_id_seq TO anon;
GRANT ALL ON SEQUENCE public.belt_verification_endorsements_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.belt_verification_endorsements_id_seq TO service_role;


--
-- Name: TABLE belt_verifications; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.belt_verifications TO anon;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.belt_verifications TO authenticated;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.belt_verifications TO service_role;


--
-- Name: SEQUENCE belt_verifications_id_seq; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON SEQUENCE public.belt_verifications_id_seq TO anon;
GRANT ALL ON SEQUENCE public.belt_verifications_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.belt_verifications_id_seq TO service_role;


--
-- Name: TABLE blocked_users; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.blocked_users TO anon;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.blocked_users TO authenticated;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.blocked_users TO service_role;


--
-- Name: TABLE chat_messages; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.chat_messages TO anon;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.chat_messages TO authenticated;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.chat_messages TO service_role;


--
-- Name: SEQUENCE chat_messages_id_seq; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON SEQUENCE public.chat_messages_id_seq TO anon;
GRANT ALL ON SEQUENCE public.chat_messages_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.chat_messages_id_seq TO service_role;


--
-- Name: TABLE chats; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.chats TO anon;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.chats TO authenticated;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.chats TO service_role;


--
-- Name: SEQUENCE chats_id_seq; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON SEQUENCE public.chats_id_seq TO anon;
GRANT ALL ON SEQUENCE public.chats_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.chats_id_seq TO service_role;


--
-- Name: TABLE custom_techniques; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.custom_techniques TO anon;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.custom_techniques TO authenticated;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.custom_techniques TO service_role;


--
-- Name: TABLE deleted_chats; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.deleted_chats TO anon;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.deleted_chats TO authenticated;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.deleted_chats TO service_role;


--
-- Name: TABLE event_rsvps; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.event_rsvps TO anon;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.event_rsvps TO authenticated;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.event_rsvps TO service_role;


--
-- Name: TABLE events; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.events TO anon;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.events TO authenticated;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.events TO service_role;


--
-- Name: TABLE hidden_posts; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.hidden_posts TO anon;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.hidden_posts TO authenticated;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.hidden_posts TO service_role;


--
-- Name: TABLE matches; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.matches TO anon;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.matches TO authenticated;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.matches TO service_role;


--
-- Name: TABLE notifications; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.notifications TO anon;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.notifications TO authenticated;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.notifications TO service_role;


--
-- Name: TABLE photo_likes; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.photo_likes TO anon;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.photo_likes TO authenticated;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.photo_likes TO service_role;


--
-- Name: TABLE post_comments; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.post_comments TO anon;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.post_comments TO authenticated;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.post_comments TO service_role;


--
-- Name: TABLE post_likes; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.post_likes TO anon;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.post_likes TO authenticated;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.post_likes TO service_role;


--
-- Name: TABLE post_reports; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.post_reports TO anon;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.post_reports TO authenticated;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.post_reports TO service_role;


--
-- Name: TABLE posts; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.posts TO anon;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.posts TO authenticated;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.posts TO service_role;


--
-- Name: SEQUENCE roll_requests_id_seq; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON SEQUENCE public.roll_requests_id_seq TO anon;
GRANT ALL ON SEQUENCE public.roll_requests_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.roll_requests_id_seq TO service_role;


--
-- Name: TABLE support_tickets; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.support_tickets TO anon;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.support_tickets TO authenticated;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.support_tickets TO service_role;


--
-- Name: TABLE training_logs; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.training_logs TO anon;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.training_logs TO authenticated;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.training_logs TO service_role;
