CREATE TABLE IF NOT EXISTS analyses (
  id                SERIAL PRIMARY KEY,
  user_id           INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  resume_id         INTEGER REFERENCES resumes(id) ON DELETE SET NULL,
  job_title         TEXT,
  company           TEXT,
  overall_fit_score NUMERIC(5,1),
  parsed_resume     JSONB,
  gap_analysis      JSONB,
  optimized_resume  JSONB,
  change_log        JSONB,
  flags             JSONB,
  prompt_version    VARCHAR(20) NOT NULL DEFAULT 'v1.0',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_analyses_user_id ON analyses(user_id);
CREATE INDEX IF NOT EXISTS idx_analyses_created_at ON analyses(created_at);

-- Resume versioning
ALTER TABLE resumes ADD COLUMN IF NOT EXISTS parent_resume_id INTEGER REFERENCES resumes(id) ON DELETE SET NULL;
ALTER TABLE resumes ADD COLUMN IF NOT EXISTS version_label TEXT;
