-- 退勤が翌日未明（00:15〜05:45 等）のとき、単純な scheduled_time < scheduled_end_time では矛盾する。
-- 既存の該当 CHECK があれば除去し、日跨ぎパターンを明示的に許容する。
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT c.conname
    FROM pg_constraint c
    INNER JOIN pg_class t ON c.conrelid = t.oid
    INNER JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname = 'attendance_schedules'
      AND c.contype = 'c'
      AND pg_get_constraintdef(c.oid) LIKE '%scheduled_time%'
      AND pg_get_constraintdef(c.oid) LIKE '%scheduled_end_time%'
  LOOP
    EXECUTE format('ALTER TABLE public.attendance_schedules DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;

ALTER TABLE public.attendance_schedules
  DROP CONSTRAINT IF EXISTS attendance_schedules_shift_time_window_chk;

ALTER TABLE public.attendance_schedules
  ADD CONSTRAINT attendance_schedules_shift_time_window_chk
  CHECK (
    scheduled_end_time IS NULL
    OR scheduled_time IS NULL
    OR scheduled_time < scheduled_end_time
    OR (
      scheduled_end_time <= time '05:45'
      AND scheduled_time >= time '09:00'
    )
  );

COMMENT ON CONSTRAINT attendance_schedules_shift_time_window_chk ON public.attendance_schedules IS
  '退勤未設定・同日 start<end、または出勤が9時以降かつ退勤が翌日未明（〜05:45）の日跨ぎシフトを許可。00:00 終了はアプリ側で 24:00:00 に正規化。';
