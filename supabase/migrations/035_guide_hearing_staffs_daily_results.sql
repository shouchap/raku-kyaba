-- 案内数ヒアリング設定（店舗）
ALTER TABLE stores
  ADD COLUMN IF NOT EXISTS guide_hearing_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS guide_hearing_time TEXT,
  ADD COLUMN IF NOT EXISTS last_guide_hearing_sent_date DATE;

COMMENT ON COLUMN stores.guide_hearing_enabled IS '営業終了時の案内数ヒアリング送信を有効化するか';
COMMENT ON COLUMN stores.guide_hearing_time IS '案内数ヒアリング送信時刻（HH:00, JST）';
COMMENT ON COLUMN stores.last_guide_hearing_sent_date IS '最終ヒアリング送信営業日（JST）';

ALTER TABLE stores
  DROP CONSTRAINT IF EXISTS stores_guide_hearing_time_format_chk;

ALTER TABLE stores
  ADD CONSTRAINT stores_guide_hearing_time_format_chk
  CHECK (
    guide_hearing_time IS NULL
    OR guide_hearing_time ~ '^([01][0-9]|2[0-3]):00$'
  );

-- 従業員マスタ（キャストとは別）
CREATE TABLE IF NOT EXISTS staffs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  line_user_id TEXT,
  is_guide_target BOOLEAN NOT NULL DEFAULT false,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_staffs_store_id ON staffs(store_id);
CREATE INDEX IF NOT EXISTS idx_staffs_store_guide_target ON staffs(store_id, is_guide_target);
CREATE INDEX IF NOT EXISTS idx_staffs_line_user_id ON staffs(line_user_id);

-- 同一店舗で同じ line_user_id の重複登録を防止（NULLは許容）
CREATE UNIQUE INDEX IF NOT EXISTS uq_staffs_store_line_user_id
ON staffs(store_id, line_user_id)
WHERE line_user_id IS NOT NULL;

-- 日報_案内実績
CREATE TABLE IF NOT EXISTS daily_guide_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  staff_id UUID NOT NULL REFERENCES staffs(id) ON DELETE CASCADE,
  business_date DATE NOT NULL,
  guide_count INTEGER NOT NULL CHECK (guide_count >= 0),
  responded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_daily_guide_results_store_staff_date
ON daily_guide_results(store_id, staff_id, business_date);

CREATE INDEX IF NOT EXISTS idx_daily_guide_results_store_date
ON daily_guide_results(store_id, business_date);
