-- 案内数ヒアリング: ラウンジ / ガールズバー / コンカフェ / フィリピンパブ を追加

ALTER TABLE daily_guide_results
  ADD COLUMN IF NOT EXISTS lounge_guide_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS lounge_people_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS girls_bar_guide_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS girls_bar_people_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS concecafe_guide_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS concecafe_people_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS philippine_pub_guide_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS philippine_pub_people_count INTEGER NOT NULL DEFAULT 0;

ALTER TABLE daily_guide_results
  DROP CONSTRAINT IF EXISTS daily_guide_results_lounge_guide_count_nonnegative_chk;
ALTER TABLE daily_guide_results
  ADD CONSTRAINT daily_guide_results_lounge_guide_count_nonnegative_chk
  CHECK (lounge_guide_count >= 0);

ALTER TABLE daily_guide_results
  DROP CONSTRAINT IF EXISTS daily_guide_results_lounge_people_count_nonnegative_chk;
ALTER TABLE daily_guide_results
  ADD CONSTRAINT daily_guide_results_lounge_people_count_nonnegative_chk
  CHECK (lounge_people_count >= 0);

ALTER TABLE daily_guide_results
  DROP CONSTRAINT IF EXISTS daily_guide_results_girls_bar_guide_count_nonnegative_chk;
ALTER TABLE daily_guide_results
  ADD CONSTRAINT daily_guide_results_girls_bar_guide_count_nonnegative_chk
  CHECK (girls_bar_guide_count >= 0);

ALTER TABLE daily_guide_results
  DROP CONSTRAINT IF EXISTS daily_guide_results_girls_bar_people_count_nonnegative_chk;
ALTER TABLE daily_guide_results
  ADD CONSTRAINT daily_guide_results_girls_bar_people_count_nonnegative_chk
  CHECK (girls_bar_people_count >= 0);

ALTER TABLE daily_guide_results
  DROP CONSTRAINT IF EXISTS daily_guide_results_concecafe_guide_count_nonnegative_chk;
ALTER TABLE daily_guide_results
  ADD CONSTRAINT daily_guide_results_concecafe_guide_count_nonnegative_chk
  CHECK (concecafe_guide_count >= 0);

ALTER TABLE daily_guide_results
  DROP CONSTRAINT IF EXISTS daily_guide_results_concecafe_people_count_nonnegative_chk;
ALTER TABLE daily_guide_results
  ADD CONSTRAINT daily_guide_results_concecafe_people_count_nonnegative_chk
  CHECK (concecafe_people_count >= 0);

ALTER TABLE daily_guide_results
  DROP CONSTRAINT IF EXISTS daily_guide_results_philippine_pub_guide_count_nonnegative_chk;
ALTER TABLE daily_guide_results
  ADD CONSTRAINT daily_guide_results_philippine_pub_guide_count_nonnegative_chk
  CHECK (philippine_pub_guide_count >= 0);

ALTER TABLE daily_guide_results
  DROP CONSTRAINT IF EXISTS daily_guide_results_philippine_pub_people_count_nonnegative_chk;
ALTER TABLE daily_guide_results
  ADD CONSTRAINT daily_guide_results_philippine_pub_people_count_nonnegative_chk
  CHECK (philippine_pub_people_count >= 0);

COMMENT ON COLUMN daily_guide_results.lounge_guide_count IS '案内数ヒアリング: ラウンジの組数';
COMMENT ON COLUMN daily_guide_results.lounge_people_count IS '案内数ヒアリング: ラウンジの人数';
COMMENT ON COLUMN daily_guide_results.girls_bar_guide_count IS '案内数ヒアリング: ガールズバーの組数';
COMMENT ON COLUMN daily_guide_results.girls_bar_people_count IS '案内数ヒアリング: ガールズバーの人数';
COMMENT ON COLUMN daily_guide_results.concecafe_guide_count IS '案内数ヒアリング: コンカフェの組数';
COMMENT ON COLUMN daily_guide_results.concecafe_people_count IS '案内数ヒアリング: コンカフェの人数';
COMMENT ON COLUMN daily_guide_results.philippine_pub_guide_count IS '案内数ヒアリング: フィリピンパブの組数';
COMMENT ON COLUMN daily_guide_results.philippine_pub_people_count IS '案内数ヒアリング: フィリピンパブの人数';
