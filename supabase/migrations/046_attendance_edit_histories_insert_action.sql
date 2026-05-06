-- 手動新規打刻の監査用に action_type に INSERT を追加

ALTER TABLE public.attendance_edit_histories
  DROP CONSTRAINT IF EXISTS attendance_edit_histories_action_type_check;

ALTER TABLE public.attendance_edit_histories
  ADD CONSTRAINT attendance_edit_histories_action_type_check
  CHECK (action_type IN ('UPDATE', 'DELETE', 'INSERT'));

COMMENT ON COLUMN public.attendance_edit_histories.action_type IS
  'UPDATE / DELETE / INSERT（管理画面からの手動新規打刻）';
