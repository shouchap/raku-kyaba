-- 福祉 通院時間ヒアリングの2ステップ化に伴う pending_line_flow 拡張
ALTER TABLE public.welfare_daily_logs
  DROP CONSTRAINT IF EXISTS welfare_daily_logs_pending_line_flow_check;

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
      'welfare_hospital_duration',
      'welfare_hospital_duration_start_input',
      'welfare_hospital_duration_end_input'
    )
  );
