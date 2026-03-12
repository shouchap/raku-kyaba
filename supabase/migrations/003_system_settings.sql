-- system_settings: システム設定（キー・値形式）
-- reminder_config 等のグローバル設定を保持
CREATE TABLE IF NOT EXISTS system_settings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  key TEXT NOT NULL UNIQUE,
  value JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_system_settings_key ON system_settings(key);

COMMENT ON TABLE system_settings IS 'システム設定。reminder_config 等を JSONB で保持';

-- reminder_config のデフォルト値を挿入
INSERT INTO system_settings (key, value)
VALUES (
  'reminder_config',
  '{"enabled": true, "sendTime": "12:00", "messageTemplate": "{name}さん、本日は {time} 出勤予定です。出勤確認をお願いいたします。"}'::jsonb
)
ON CONFLICT (key) DO NOTHING;

-- updated_at 自動更新
CREATE TRIGGER system_settings_updated_at
  BEFORE UPDATE ON system_settings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- RLS（サービスロールでアクセスするため最小限）
ALTER TABLE system_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all for authenticated" ON system_settings
  FOR ALL USING (true);
