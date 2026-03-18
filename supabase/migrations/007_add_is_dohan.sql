-- attendance_schedules に is_dohan（同伴）を追加
ALTER TABLE attendance_schedules
  ADD COLUMN IF NOT EXISTS is_dohan BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN attendance_schedules.is_dohan IS '同伴出勤かどうか。シフト管理UIで設定';
