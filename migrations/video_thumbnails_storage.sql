-- Create video-thumbnails storage bucket
INSERT INTO storage.buckets (id, name, public)
VALUES ('video-thumbnails', 'video-thumbnails', true)
ON CONFLICT (id) DO NOTHING;

-- Set up storage policies for video-thumbnails bucket

-- Public read access
CREATE POLICY "Public Access"
ON storage.objects FOR SELECT
USING (bucket_id = 'video-thumbnails');

-- Authenticated users can upload thumbnails
CREATE POLICY "Authenticated users can upload thumbnails"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'video-thumbnails' AND auth.role() = 'authenticated');

-- Users can update own thumbnails
CREATE POLICY "Users can update own thumbnails"
ON storage.objects FOR UPDATE
USING (bucket_id = 'video-thumbnails' AND auth.role() = 'authenticated');

-- Users can delete own thumbnails
CREATE POLICY "Users can delete own thumbnails"
ON storage.objects FOR DELETE
USING (bucket_id = 'video-thumbnails' AND auth.role() = 'authenticated');

-- Ensure posts table has video_thumbnail_url column
ALTER TABLE posts ADD COLUMN IF NOT EXISTS video_thumbnail_url TEXT;
