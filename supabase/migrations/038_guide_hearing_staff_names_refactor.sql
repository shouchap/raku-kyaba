-- stores: 案内スタッフ名を文字列配列で保持
ALTER TABLE stores
  ADD COLUMN IF NOT EXISTS guide_staff_names TEXT[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN stores.guide_staff_names IS '案内数ヒアリングの入力対象スタッフ名配列';

-- daily_guide_results: cast/staff ID 依存を廃止し staff_name で保存
ALTER TABLE daily_guide_results
  ADD COLUMN IF NOT EXISTS staff_name TEXT,
  ADD COLUMN IF NOT EXISTS target_date DATE;

UPDATE daily_guide_results
SET
  staff_name = COALESCE(staff_name, '未設定'),
  target_date = COALESCE(target_date, business_date);

ALTER TABLE daily_guide_results
  ALTER COLUMN staff_name SET NOT NULL,
  ALTER COLUMN target_date SET NOT NULL;

DROP INDEX IF EXISTS uq_daily_guide_results_store_staff_date;
CREATE UNIQUE INDEX IF NOT EXISTS uq_daily_guide_results_store_name_date
  ON daily_guide_results(store_id, staff_name, target_date);

ALTER TABLE daily_guide_results
  DROP COLUMN IF EXISTS staff_id,
  DROP COLUMN IF EXISTS business_date;
