ALTER TABLE daily_guide_results
  ADD COLUMN IF NOT EXISTS people_count INTEGER;

UPDATE daily_guide_results
SET people_count = COALESCE(people_count, guide_count)
WHERE people_count IS NULL;

ALTER TABLE daily_guide_results
  ALTER COLUMN people_count SET DEFAULT 0,
  ALTER COLUMN people_count SET NOT NULL;

ALTER TABLE daily_guide_results
  DROP CONSTRAINT IF EXISTS daily_guide_results_people_count_nonnegative_chk;

ALTER TABLE daily_guide_results
  ADD CONSTRAINT daily_guide_results_people_count_nonnegative_chk
  CHECK (people_count >= 0);

COMMENT ON COLUMN daily_guide_results.people_count IS '案内時の合計人数';
