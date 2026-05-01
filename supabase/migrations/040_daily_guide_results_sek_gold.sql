-- 案内数ヒアリング: セク / GOLD を別カラムで保持（合計は既存 guide_count / people_count と整合）

ALTER TABLE daily_guide_results
  ADD COLUMN IF NOT EXISTS sek_guide_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sek_people_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS gold_guide_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS gold_people_count INTEGER NOT NULL DEFAULT 0;

UPDATE daily_guide_results
SET
  sek_guide_count = guide_count,
  sek_people_count = people_count,
  gold_guide_count = 0,
  gold_people_count = 0;

ALTER TABLE daily_guide_results
  DROP CONSTRAINT IF EXISTS daily_guide_results_sek_guide_count_nonnegative_chk;

ALTER TABLE daily_guide_results
  ADD CONSTRAINT daily_guide_results_sek_guide_count_nonnegative_chk
  CHECK (sek_guide_count >= 0);

ALTER TABLE daily_guide_results
  DROP CONSTRAINT IF EXISTS daily_guide_results_sek_people_count_nonnegative_chk;

ALTER TABLE daily_guide_results
  ADD CONSTRAINT daily_guide_results_sek_people_count_nonnegative_chk
  CHECK (sek_people_count >= 0);

ALTER TABLE daily_guide_results
  DROP CONSTRAINT IF EXISTS daily_guide_results_gold_guide_count_nonnegative_chk;

ALTER TABLE daily_guide_results
  ADD CONSTRAINT daily_guide_results_gold_guide_count_nonnegative_chk
  CHECK (gold_guide_count >= 0);

ALTER TABLE daily_guide_results
  DROP CONSTRAINT IF EXISTS daily_guide_results_gold_people_count_nonnegative_chk;

ALTER TABLE daily_guide_results
  ADD CONSTRAINT daily_guide_results_gold_people_count_nonnegative_chk
  CHECK (gold_people_count >= 0);

COMMENT ON COLUMN daily_guide_results.sek_guide_count IS '案内数ヒアリング: セクの組数';
COMMENT ON COLUMN daily_guide_results.sek_people_count IS '案内数ヒアリング: セクの人数';
COMMENT ON COLUMN daily_guide_results.gold_guide_count IS '案内数ヒアリング: GOLD の組数';
COMMENT ON COLUMN daily_guide_results.gold_people_count IS '案内数ヒアリング: GOLD の人数';
