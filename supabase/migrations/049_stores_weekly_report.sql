-- 週間レポート自動送信（LINEテキスト・フェーズ1）
ALTER TABLE public.stores
  ADD COLUMN IF NOT EXISTS weekly_report_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS weekly_report_day smallint NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS weekly_report_time text NOT NULL DEFAULT '09:00',
  ADD COLUMN IF NOT EXISTS last_weekly_report_sent_date date NULL;

COMMENT ON COLUMN public.stores.weekly_report_enabled IS '週間レポート自動送信を有効にするか';
COMMENT ON COLUMN public.stores.weekly_report_day IS '送信曜日（JST）0=日曜〜6=土曜';
COMMENT ON COLUMN public.stores.weekly_report_time IS '送信時刻（JST HH:mm、通常は整時）';
COMMENT ON COLUMN public.stores.last_weekly_report_sent_date IS '最後に週間レポート自動送信を実行したJST暦日（冪等性用）';

ALTER TABLE public.stores
  DROP CONSTRAINT IF EXISTS stores_weekly_report_day_chk;

ALTER TABLE public.stores
  ADD CONSTRAINT stores_weekly_report_day_chk CHECK (weekly_report_day >= 0 AND weekly_report_day <= 6);
