-- Content moderation audit log
-- Records every automated moderation decision (image + text) for review, appeals,
-- and threshold tuning. Nothing escapes auditing, even when we fail open.

CREATE TABLE IF NOT EXISTS moderation_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- Who produced the content (nullable: some surfaces like profile-pic upload are pre-auth)
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,

  content_type TEXT NOT NULL,           -- 'image' | 'text'
  surface TEXT NOT NULL,                -- 'profile_pic','post_image','post_text',
                                        -- 'post_video_thumbnail','chat_image','chat_text','profile_text'

  decision TEXT NOT NULL,               -- 'allow' | 'block' | 'review' | 'error' | 'skipped'
  vendor TEXT,                          -- 'google_vision_rest','google_vision_sdk','openai'

  scores JSONB,                         -- raw vendor scores/likelihoods for tuning + appeals
  matched_categories TEXT[],            -- categories that drove the decision
  reason TEXT,                          -- human-readable summary

  content_ref TEXT,                     -- storage path / post id / message id when known
  content_excerpt TEXT,                 -- truncated copy of text content for review

  -- Human-in-the-loop review queue
  needs_review BOOLEAN NOT NULL DEFAULT FALSE,
  reviewed BOOLEAN NOT NULL DEFAULT FALSE,
  reviewed_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMP WITH TIME ZONE,
  review_action TEXT,                   -- 'upheld' | 'overturned' | null

  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Review queue is read by "needs_review AND NOT reviewed"
CREATE INDEX IF NOT EXISTS idx_moderation_logs_review
  ON moderation_logs (needs_review, reviewed)
  WHERE needs_review = TRUE AND reviewed = FALSE;

CREATE INDEX IF NOT EXISTS idx_moderation_logs_user_id ON moderation_logs (user_id);
CREATE INDEX IF NOT EXISTS idx_moderation_logs_decision ON moderation_logs (decision);
CREATE INDEX IF NOT EXISTS idx_moderation_logs_created_at ON moderation_logs (created_at DESC);

COMMENT ON TABLE moderation_logs IS 'Automated content moderation decisions (image + text) with human review queue';
COMMENT ON COLUMN moderation_logs.decision IS 'allow=clean, block=rejected, review=gray-zone escalation, error=vendor failure (failed open), skipped=moderation disabled';
COMMENT ON COLUMN moderation_logs.needs_review IS 'TRUE for gray-zone (review) and error (fail-open) decisions that a human should check';
