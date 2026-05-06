-- 同伴・捌き入力UIのマスターON/OFF（店舗設定）
ALTER TABLE public.stores
  ADD COLUMN IF NOT EXISTS is_dohan_sabaki_enabled BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN public.stores.is_dohan_sabaki_enabled IS '同伴・捌きの管理機能を利用するか。false の場合は管理画面UIで同伴/捌きトグルを非表示。';
