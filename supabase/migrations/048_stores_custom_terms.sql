ALTER TABLE public.stores
  ADD COLUMN IF NOT EXISTS custom_terms jsonb NOT NULL DEFAULT '{"term_attendance":"出勤","term_cast":"キャスト"}'::jsonb;

COMMENT ON COLUMN public.stores.custom_terms IS
  '画面表示の用語カスタム（term_attendance, term_cast）';
