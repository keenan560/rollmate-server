-- Enable Row Level Security on all unprotected public tables
-- The backend uses service_role key which bypasses RLS entirely
-- Real-time subscriptions (typing, presence) use Supabase channels (not table queries)
-- After this migration, the anon key cannot query any tables directly

ALTER TABLE public.custom_techniques ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.availability ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chats ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.post_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.matches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.achievements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.blocked_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hidden_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.achievement_verifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.training_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.roll_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_rsvps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.belt_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deleted_chats ENABLE ROW LEVEL SECURITY;

-- Also enable on tables that already have RLS but verify they're set
-- (these should already be enabled, this is idempotent)
ALTER TABLE public.posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.post_likes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.post_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.photo_likes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.belt_verifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.belt_endorsements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.belt_verification_endorsements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.achievement_endorsements ENABLE ROW LEVEL SECURITY;

-- Grant the service_role full access (it bypasses RLS by default, but explicit for clarity)
-- No policies needed for anon role since all queries now go through the backend
