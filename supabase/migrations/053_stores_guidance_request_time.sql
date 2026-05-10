-- 案内ヒアリング自動送信時刻（TIME）。アプリでは JST の整時として照合する。
ALTER TABLE public.stores
  ADD COLUMN IF NOT EXISTS guidance_request_time time NULL;

COMMENT ON COLUMN public.stores.guidance_request_time IS
  '案内ヒアリング（案内数入力起点）の自動送信時刻。既存 guide_hearing_time から移行可。';

-- 既存テキスト時刻から移行（正時 HH:00 のみ）
UPDATE public.stores s
SET guidance_request_time = s.guide_hearing_time::time
WHERE s.guidance_request_time IS NULL
  AND s.guide_hearing_time IS NOT NULL
  AND s.guide_hearing_time ~ '^([01][0-9]|2[0-3]):00$';
