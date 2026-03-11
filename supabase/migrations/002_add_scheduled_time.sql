-- attendance_schedules に scheduled_time を追加
-- リマインドメッセージで「〇〇時出勤予定」を表示するために使用
ALTER TABLE attendance_schedules
  ADD COLUMN scheduled_time TIME DEFAULT '20:00';

COMMENT ON COLUMN attendance_schedules.scheduled_time IS '出勤予定時刻。リマインドメッセージの表示に使用';
