-- 案内数ヒアリング・レポート機能のマスターON/OFF（店舗設定）
ALTER TABLE public.stores
  ADD COLUMN IF NOT EXISTS is_guide_enabled BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN public.stores.is_guide_enabled IS '案内数ヒアリング・案内数レポートを利用するか（キャバクラ向け）。false で自動ヒアリングcron対象外。';
