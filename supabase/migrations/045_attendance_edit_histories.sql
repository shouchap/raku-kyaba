-- attendance_logs の管理者による手動更新・削除の監査ログ
-- 親ログ削除後も一覧できるよう subject_attendance_log_id でキーを固定。
-- attendance_log_id は参照整合・JOIN 用で ON DELETE SET NULL（CASCADE は監査が連鎖削除されるため不採用）

CREATE TABLE public.attendance_edit_histories (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  subject_attendance_log_id UUID NOT NULL,
  attendance_log_id UUID REFERENCES public.attendance_logs(id) ON DELETE SET NULL,
  edited_by_admin_id UUID NOT NULL,
  action_type VARCHAR(16) NOT NULL CHECK (action_type IN ('UPDATE', 'DELETE')),
  old_data JSONB NOT NULL,
  new_data JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT attendance_edit_histories_log_fk_aligned_chk CHECK (
    attendance_log_id IS NULL OR attendance_log_id = subject_attendance_log_id
  )
);

CREATE INDEX idx_attendance_edit_histories_subject_log
  ON public.attendance_edit_histories(subject_attendance_log_id);
CREATE INDEX idx_attendance_edit_histories_attendance_log
  ON public.attendance_edit_histories(attendance_log_id);
CREATE INDEX idx_attendance_edit_histories_created_at
  ON public.attendance_edit_histories(created_at DESC);

COMMENT ON TABLE public.attendance_edit_histories IS
  '出勤打刻 attendance_logs の管理画面からの手動編集・削除の監査ログ';
COMMENT ON COLUMN public.attendance_edit_histories.subject_attendance_log_id IS
  '対象 attendance_logs.id の不変コピー（削除後も検索キーに使用）';
COMMENT ON COLUMN public.attendance_edit_histories.attendance_log_id IS
  '現レコードが存在する間は subject と同一。親削除後は NULL';

ALTER TABLE public.attendance_edit_histories ENABLE ROW LEVEL SECURITY;
