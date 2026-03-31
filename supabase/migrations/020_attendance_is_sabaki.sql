-- 捌き出勤フラグ（同伴 is_dohan と同様）
ALTER TABLE attendance_schedules
  ADD COLUMN IF NOT EXISTS is_sabaki BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN attendance_schedules.is_sabaki IS '捌き出勤。シフト管理UIで設定';

ALTER TABLE attendance_logs
  ADD COLUMN IF NOT EXISTS is_sabaki BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN attendance_logs.is_sabaki IS '当日の回答時点でシフトが捌き出勤だったことのスナップショット';
