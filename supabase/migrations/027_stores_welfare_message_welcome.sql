-- B型: LINE 友だち追加（follow）時のウェルカム文（NULL・空で reminder_config / 既定へフォールバック）
ALTER TABLE public.stores
  ADD COLUMN IF NOT EXISTS welfare_message_welcome TEXT;

COMMENT ON COLUMN public.stores.welfare_message_welcome IS 'B型: follow 返信の本文（NULL または空でキャバクラ系既定・reminder_config へフォールバック）';
