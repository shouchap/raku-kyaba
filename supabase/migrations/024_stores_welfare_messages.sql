-- B型事業所（welfare_b）向け: 定期配信 Flex の本文カスタマイズ（NULL 時はアプリ側デフォルト）
ALTER TABLE stores
  ADD COLUMN IF NOT EXISTS welfare_message_morning TEXT,
  ADD COLUMN IF NOT EXISTS welfare_message_midday TEXT,
  ADD COLUMN IF NOT EXISTS welfare_message_evening TEXT;

COMMENT ON COLUMN stores.welfare_message_morning IS 'B型: 朝の点呼・作業開始 Flex の本文（NULL でデフォルト）';
COMMENT ON COLUMN stores.welfare_message_midday IS 'B型: 昼の体調確認 Flex の本文（NULL でデフォルト）';
COMMENT ON COLUMN stores.welfare_message_evening IS 'B型: 夕方の終了報告 Flex の本文（NULL でデフォルト）';
