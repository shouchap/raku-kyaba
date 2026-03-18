-- attendance_schedules に admin_warned_at を追加
-- リマインドから5時間経過後の管理者警告通知の二重送信防止用
ALTER TABLE attendance_schedules
  ADD COLUMN admin_warned_at TIMESTAMPTZ;

COMMENT ON COLUMN attendance_schedules.admin_warned_at IS '管理者へ未対応警告を送信した日時。二重通知防止に使用';
