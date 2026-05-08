-- 風俗運用向け拡張:
-- - attendance_schedules に退勤予定時刻を追加
-- - casts に役職(role)を追加（cast / nakai）

ALTER TABLE public.attendance_schedules
  ADD COLUMN IF NOT EXISTS scheduled_end_time time NULL;

COMMENT ON COLUMN public.attendance_schedules.scheduled_end_time
  IS '退勤予定時刻（NULL は未設定）';

ALTER TABLE public.casts
  ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'cast';

ALTER TABLE public.casts
  DROP CONSTRAINT IF EXISTS casts_role_check;

ALTER TABLE public.casts
  ADD CONSTRAINT casts_role_check
  CHECK (role IN ('cast', 'nakai'));

COMMENT ON COLUMN public.casts.role
  IS '役職: cast=キャスト, nakai=仲居';
