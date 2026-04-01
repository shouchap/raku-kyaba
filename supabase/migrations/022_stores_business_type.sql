-- 業態フラグ（マルチテナントでキャバクラ / B型事業所などを分岐）
-- 既存店舗はすべて cabaret として扱う

ALTER TABLE public.stores
  ADD COLUMN IF NOT EXISTS business_type text NOT NULL DEFAULT 'cabaret';

ALTER TABLE public.stores
  DROP CONSTRAINT IF EXISTS stores_business_type_check;

ALTER TABLE public.stores
  ADD CONSTRAINT stores_business_type_check
  CHECK (business_type IN ('cabaret', 'welfare_b'));

COMMENT ON COLUMN public.stores.business_type IS '業態: cabaret=キャバクラ系, welfare_b=就労継続支援B型事業所';
