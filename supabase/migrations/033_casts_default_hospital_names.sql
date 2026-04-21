-- 福祉: かかりつけ病院を複数登録可能にする（text[]）
ALTER TABLE public.casts
  ADD COLUMN IF NOT EXISTS default_hospital_names text[] NOT NULL DEFAULT '{}';

UPDATE public.casts
SET default_hospital_names = ARRAY[trim(both from default_hospital_name)]::text[]
WHERE default_hospital_name IS NOT NULL
  AND trim(both from default_hospital_name) <> '';

COMMENT ON COLUMN public.casts.default_hospital_names IS '福祉: かかりつけ病院名の配列（通院報告Q1のクイックリプライ）';

ALTER TABLE public.casts DROP COLUMN IF EXISTS default_hospital_name;
