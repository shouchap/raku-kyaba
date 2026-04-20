-- 福祉（B型）日報: 通院報告
ALTER TABLE public.welfare_daily_logs
  ADD COLUMN IF NOT EXISTS is_hospital_visit boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS hospital_name text,
  ADD COLUMN IF NOT EXISTS symptoms text,
  ADD COLUMN IF NOT EXISTS visit_duration text;

COMMENT ON COLUMN public.welfare_daily_logs.is_hospital_visit IS '通院報告で終了した日は true';
COMMENT ON COLUMN public.welfare_daily_logs.hospital_name IS '通院: 病院名（LINE ヒアリング）';
COMMENT ON COLUMN public.welfare_daily_logs.symptoms IS '通院: 症状・診察内容';
COMMENT ON COLUMN public.welfare_daily_logs.visit_duration IS '通院: 所要時間（目安）';

ALTER TABLE public.welfare_daily_logs DROP CONSTRAINT IF EXISTS welfare_daily_logs_pending_line_flow_check;

ALTER TABLE public.welfare_daily_logs
  ADD CONSTRAINT welfare_daily_logs_pending_line_flow_check
  CHECK (
    pending_line_flow IS NULL
    OR pending_line_flow IN (
      'welfare_health_reason',
      'welfare_work_item',
      'welfare_end_choice',
      'welfare_hospital_name',
      'welfare_hospital_symptoms',
      'welfare_hospital_duration'
    )
  );
