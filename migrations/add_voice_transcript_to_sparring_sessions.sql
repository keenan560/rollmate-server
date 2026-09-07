-- Stores the raw (user-edited) speech-to-text transcript a sparring
-- session was logged from, so it can be shown back on the session detail
-- screen. Null for sessions logged manually.

ALTER TABLE public.sparring_sessions ADD COLUMN IF NOT EXISTS voice_transcript TEXT;
