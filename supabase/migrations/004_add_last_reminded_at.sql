-- attendance_schedules に last_reminded_at を追加
-- リマインド送信の二重送信防止用。本日送信済みならスキップする
ALTER TABLE attendance_schedules
  ADD COLUMN last_reminded_at TIMESTAMPTZ;

COMMENT ON COLUMN attendance_schedules.last_reminded_at IS 'リマインド送信日時。同一日の二重送信防止に使用';
