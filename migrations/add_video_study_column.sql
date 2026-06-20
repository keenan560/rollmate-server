-- Add video_study JSONB column for video study sessions
ALTER TABLE training_logs
ADD COLUMN IF NOT EXISTS video_study JSONB DEFAULT NULL;
