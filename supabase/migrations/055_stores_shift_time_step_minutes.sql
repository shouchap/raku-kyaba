-- 週間シフト・単日登録・シフト提出などの時刻プルダウン刻み（15 分 or 60 分）
ALTER TABLE public.stores
  ADD COLUMN IF NOT EXISTS shift_time_step_minutes smallint NOT NULL DEFAULT 15;

COMMENT ON COLUMN public.stores.shift_time_step_minutes IS 'シフト時刻の選択刻み（分）。15 または 60。';

ALTER TABLE public.stores DROP CONSTRAINT IF EXISTS stores_shift_time_step_minutes_chk;
ALTER TABLE public.stores
  ADD CONSTRAINT stores_shift_time_step_minutes_chk
  CHECK (shift_time_step_minutes IN (15, 60));
