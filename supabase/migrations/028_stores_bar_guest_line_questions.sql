-- BAR（サイト表記: ELINE）向け LINE 来客ヒアリング設定
ALTER TABLE public.stores DROP CONSTRAINT IF EXISTS stores_business_type_check;
ALTER TABLE public.stores ADD CONSTRAINT stores_business_type_check
  CHECK (business_type IN ('cabaret', 'welfare_b', 'bar'));

ALTER TABLE public.stores
  ADD COLUMN IF NOT EXISTS ask_guest_name boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS ask_guest_time boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.stores.ask_guest_name IS 'BAR: 来客フローで組ごとのお客様名を聞く';
COMMENT ON COLUMN public.stores.ask_guest_time IS 'BAR: 来客フローで来店時間を聞く（false で時間ステップをスキップ）';
