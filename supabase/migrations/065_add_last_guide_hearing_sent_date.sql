-- 035 は schema_migrations 上「適用済み」だが本番に列が存在しないため、
-- CLI が 035 を再実行しない。列だけを明示的に追加し直す。
ALTER TABLE public.stores
  ADD COLUMN IF NOT EXISTS last_guide_hearing_sent_date DATE;

COMMENT ON COLUMN public.stores.last_guide_hearing_sent_date IS
  '最終ヒアリング送信営業日（JST）。/api/cron/send-guide-hearing の二重送信防止に使用。';
