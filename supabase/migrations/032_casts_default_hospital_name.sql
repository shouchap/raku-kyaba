-- 福祉・通院報告: かかりつけ病院（LINE クイックリプライ用）
ALTER TABLE public.casts
  ADD COLUMN IF NOT EXISTS default_hospital_name text;

COMMENT ON COLUMN public.casts.default_hospital_name IS '福祉: かかりつけ病院名（通院報告Q1のクイックリプライ）';
