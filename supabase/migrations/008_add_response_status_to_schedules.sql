-- attendance_schedules に回答完了フラグとステータスを追加
-- 管理画面の「未返信」表示と warn-unanswered の未対応者抽出に使用
ALTER TABLE attendance_schedules
  ADD COLUMN IF NOT EXISTS is_action_completed BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS response_status attendance_status;

COMMENT ON COLUMN attendance_schedules.is_action_completed IS 'リマインドへの回答が完了したか。未返信判定に使用';
COMMENT ON COLUMN attendance_schedules.response_status IS 'キャストの回答（出勤/遅刻/欠勤）。未回答時はnull';
