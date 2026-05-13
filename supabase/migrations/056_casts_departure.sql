-- キャバクラ / BAR / 風俗: 退店日・退店理由（月間レポート等で利用）
ALTER TABLE casts
  ADD COLUMN IF NOT EXISTS departed_at date,
  ADD COLUMN IF NOT EXISTS departure_reason text;

COMMENT ON COLUMN casts.departed_at IS '退店日（JST 暦日）。管理画面の退店処理で設定';
COMMENT ON COLUMN casts.departure_reason IS '退店理由（管理画面入力）';

CREATE INDEX IF NOT EXISTS idx_casts_store_departed_at ON casts (store_id, departed_at)
  WHERE departed_at IS NOT NULL;
