-- 出勤確認 Flex の「公休」「半休」ボタンを店舗（reminder_config 行）ごとに出し分け
ALTER TABLE system_settings
  ADD COLUMN IF NOT EXISTS enable_public_holiday BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS enable_half_holiday BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN system_settings.enable_public_holiday IS '公休ボタンを Flex に表示するか（reminder_config 行で使用）';
COMMENT ON COLUMN system_settings.enable_half_holiday IS '半休ボタンを Flex に表示するか（reminder_config 行で使用）';
