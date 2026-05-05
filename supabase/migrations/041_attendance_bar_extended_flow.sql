-- BAR業態向け出勤確認フロー拡張
-- stores: フロー種別（従来 / BAR詳細）を保持
-- attendance_logs: 予定組数・行動確認を保持

ALTER TABLE public.stores
  ADD COLUMN IF NOT EXISTS attendance_flow_type VARCHAR(32) NOT NULL DEFAULT 'default';

COMMENT ON COLUMN public.stores.attendance_flow_type IS
  '出勤確認フロー種別。default=従来、bar_extended=BAR詳細';

ALTER TABLE public.attendance_logs
  ADD COLUMN IF NOT EXISTS planned_groups NUMERIC(4,1),
  ADD COLUMN IF NOT EXISTS action_type VARCHAR(32),
  ADD COLUMN IF NOT EXISTS action_detail VARCHAR(255);

COMMENT ON COLUMN public.attendance_logs.planned_groups IS
  '予定組数（仮予定を0.1,0.2のような小数で保持）';
COMMENT ON COLUMN public.attendance_logs.action_type IS
  '行動確認の種別（配信/声かけ/SNS/できていない）';
COMMENT ON COLUMN public.attendance_logs.action_detail IS
  '行動確認の詳細（時間帯や人数など）';
