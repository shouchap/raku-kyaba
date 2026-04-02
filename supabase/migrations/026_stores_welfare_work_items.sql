-- B型: 管理画面からカンマ区切りで作業項目を設定（LINE 終了時の Flex ボタンに使用）
ALTER TABLE public.stores
  ADD COLUMN IF NOT EXISTS welfare_work_items TEXT;

COMMENT ON COLUMN public.stores.welfare_work_items IS 'B型: 作業項目をカンマ区切りで保存（例: 清掃,パッキング）。NULL 時はアプリ既定の項目を使用';

-- 昼の体調「担当者に連絡」を保存するため health_status に contact を追加
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT c.conname AS cn
    FROM pg_constraint c
    JOIN pg_class t ON c.conrelid = t.oid
    WHERE t.relname = 'welfare_daily_logs'
      AND c.contype = 'c'
      AND pg_get_constraintdef(c.oid) LIKE '%health_status%'
  LOOP
    EXECUTE format('ALTER TABLE public.welfare_daily_logs DROP CONSTRAINT %I', r.cn);
  END LOOP;
END $$;

ALTER TABLE public.welfare_daily_logs
  ADD CONSTRAINT welfare_daily_logs_health_status_check
  CHECK (
    health_status IS NULL
    OR health_status IN ('good', 'soso', 'bad', 'contact')
  );
