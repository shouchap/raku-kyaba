-- casts テーブルに is_admin を追加（管理者通知のマルチキャスト用）
ALTER TABLE casts
  ADD COLUMN is_admin BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX idx_casts_store_is_admin ON casts(store_id, is_admin) WHERE is_admin = true;

COMMENT ON COLUMN casts.is_admin IS '管理者権限。true のキャストには遅刻・欠勤・新人登録の通知が送信される';
