-- BAR詳細フロー: 仮予定組数を独立して保存
ALTER TABLE public.attendance_logs
ADD COLUMN IF NOT EXISTS tentative_groups INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.attendance_logs.tentative_groups IS
'BAR詳細フローでの仮予定組数（確定組数は planned_groups）';
