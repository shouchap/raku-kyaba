-- 風俗業態運用対応:
-- 1) stores.business_type に fuzoku を追加
-- 2) stores.line_group_id を追加（将来のグループ通知送信先）
-- 3) casts を手動登録しやすくする（line_user_id nullable / display_name 追加）

ALTER TABLE public.stores
  DROP CONSTRAINT IF EXISTS stores_business_type_check;

ALTER TABLE public.stores
  ADD CONSTRAINT stores_business_type_check
  CHECK (business_type IN ('cabaret', 'welfare_b', 'bar', 'fuzoku'));

COMMENT ON CONSTRAINT stores_business_type_check ON public.stores
  IS '業態: cabaret / welfare_b / bar / fuzoku';

ALTER TABLE public.stores
  ADD COLUMN IF NOT EXISTS line_group_id text NULL;

COMMENT ON COLUMN public.stores.line_group_id
  IS '本日のシフト等の通知先となるLINEグループID（将来拡張用）';

ALTER TABLE public.casts
  ALTER COLUMN line_user_id DROP NOT NULL;

ALTER TABLE public.casts
  ADD COLUMN IF NOT EXISTS display_name text NULL;

COMMENT ON COLUMN public.casts.display_name
  IS '表示名（源氏名など）。NULL の場合は name を表示';
