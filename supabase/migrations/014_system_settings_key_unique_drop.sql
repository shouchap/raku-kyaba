-- 011 未適用環境で key 単独 UNIQUE が残っていると、店舗別 reminder_config 行を INSERT できない。
-- (store_id, key) の一意は 011 の system_settings_store_id_key_unique で担保する。
ALTER TABLE system_settings DROP CONSTRAINT IF EXISTS system_settings_key_key;
