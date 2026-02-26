-- Diagnostic queries to help fix the get_posts_with_details function
-- Run these in your Supabase SQL Editor to understand your schema

-- 1. Check the current function definition
SELECT pg_get_functiondef(oid) 
FROM pg_proc 
WHERE proname = 'get_posts_with_details';

-- 2. Check posts table column types
SELECT column_name, data_type, udt_name
FROM information_schema.columns 
WHERE table_name = 'posts'
ORDER BY ordinal_position;

-- 3. Check users table column types
SELECT column_name, data_type, udt_name
FROM information_schema.columns 
WHERE table_name = 'users'
ORDER BY ordinal_position;

-- 4. Test query to see what the function currently returns
-- (This will fail but show you the error)
SELECT * FROM get_posts_with_details(30, 0, NULL) LIMIT 1;
