-- キャスト管理に「従業員」区分と案内数ヒアリング対象フラグを追加
ALTER TABLE casts
  ADD COLUMN IF NOT EXISTS is_guide_target BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN casts.is_guide_target IS '案内数ヒアリング対象（営業終了時LINE送信）';

ALTER TABLE casts
  DROP CONSTRAINT IF EXISTS casts_employment_type_chk;

ALTER TABLE casts
  ADD CONSTRAINT casts_employment_type_chk
  CHECK (employment_type IS NULL OR employment_type IN ('admin', 'regular', 'part_time', 'employee'));

COMMENT ON COLUMN casts.employment_type IS '勤務形態: admin=管理者, regular=レギュラー, part_time=バイト, employee=従業員';

CREATE INDEX IF NOT EXISTS idx_casts_store_guide_target
  ON casts(store_id, is_guide_target)
  WHERE is_guide_target = true;
