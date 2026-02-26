-- Create post_reports table
CREATE TABLE IF NOT EXISTS post_reports (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  post_id UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  reported_by TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(post_id, reported_by)
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_post_reports_post_id ON post_reports(post_id);
CREATE INDEX IF NOT EXISTS idx_post_reports_reported_by ON post_reports(reported_by);

-- Add comment to table
COMMENT ON TABLE post_reports IS 'Stores user reports for posts';
COMMENT ON COLUMN post_reports.post_id IS 'ID of the reported post';
COMMENT ON COLUMN post_reports.reported_by IS 'ID of the user who reported the post';
COMMENT ON COLUMN post_reports.reason IS 'Reason for reporting the post';
