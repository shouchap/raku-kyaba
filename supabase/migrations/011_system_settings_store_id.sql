-- system_settings をテナント単位に分離（store_id 必須・(store_id, key) で一意）
-- 既に手動適用済みの環境では IF NOT EXISTS / DO NOTHING で冪等に近づける

ALTER TABLE system_settings
  ADD COLUMN IF NOT EXISTS store_id UUID REFERENCES stores(id) ON DELETE CASCADE;

-- 既存のグローバル行を最初の店舗に紐付け（未設定の行のみ）
UPDATE system_settings
SET store_id = (SELECT id FROM stores ORDER BY created_at ASC LIMIT 1)
WHERE store_id IS NULL;

-- key 単独 UNIQUE をやめ、(store_id, key) に変更（存在する場合のみ）
ALTER TABLE system_settings DROP CONSTRAINT IF EXISTS system_settings_key_key;

CREATE UNIQUE INDEX IF NOT EXISTS system_settings_store_id_key_unique
  ON system_settings (store_id, key);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM system_settings WHERE store_id IS NULL) THEN
    ALTER TABLE system_settings ALTER COLUMN store_id SET NOT NULL;
  END IF;
END $$;

COMMENT ON COLUMN system_settings.store_id IS 'テナント（店舗）。reminder_config 等は店舗ごと';
