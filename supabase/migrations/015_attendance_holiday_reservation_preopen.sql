-- 出勤ステータスに公休・半休を追加、予約情報・LINEフロー待ち・営業前サマリー用カラム

DO $$ BEGIN
  ALTER TYPE attendance_status ADD VALUE 'public_holiday';
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TYPE attendance_status ADD VALUE 'half_holiday';
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE attendance_schedules
  ADD COLUMN IF NOT EXISTS public_holiday_reason TEXT,
  ADD COLUMN IF NOT EXISTS half_holiday_reason TEXT,
  ADD COLUMN IF NOT EXISTS has_reservation BOOLEAN,
  ADD COLUMN IF NOT EXISTS reservation_details TEXT,
  ADD COLUMN IF NOT EXISTS pending_line_flow TEXT,
  ADD COLUMN IF NOT EXISTS pending_line_updated_at TIMESTAMPTZ;

COMMENT ON COLUMN attendance_schedules.public_holiday_reason IS '公休の理由（自由記述）';
COMMENT ON COLUMN attendance_schedules.half_holiday_reason IS '半休の理由（自由記述）';
COMMENT ON COLUMN attendance_schedules.has_reservation IS '来客・同伴予約の有無（出勤確定時）';
COMMENT ON COLUMN attendance_schedules.reservation_details IS '来客・同伴予約の詳細';
COMMENT ON COLUMN attendance_schedules.pending_line_flow IS 'LINE: reservation_ask / reservation_detail など';
COMMENT ON COLUMN attendance_schedules.pending_line_updated_at IS 'pending_line_flow 最終更新';

ALTER TABLE attendance_logs
  ADD COLUMN IF NOT EXISTS public_holiday_reason TEXT,
  ADD COLUMN IF NOT EXISTS half_holiday_reason TEXT,
  ADD COLUMN IF NOT EXISTS has_reservation BOOLEAN,
  ADD COLUMN IF NOT EXISTS reservation_details TEXT;

COMMENT ON COLUMN attendance_logs.public_holiday_reason IS '公休の理由（スナップショット）';
COMMENT ON COLUMN attendance_logs.half_holiday_reason IS '半休の理由（スナップショット）';
COMMENT ON COLUMN attendance_logs.has_reservation IS '来客・同伴予約の有無';
COMMENT ON COLUMN attendance_logs.reservation_details IS '来客・同伴予約の詳細';

ALTER TABLE stores
  ADD COLUMN IF NOT EXISTS pre_open_report_hour_jst INTEGER,
  ADD COLUMN IF NOT EXISTS last_pre_open_report_date DATE;

ALTER TABLE stores DROP CONSTRAINT IF EXISTS stores_pre_open_report_hour_chk;
ALTER TABLE stores
  ADD CONSTRAINT stores_pre_open_report_hour_chk
  CHECK (pre_open_report_hour_jst IS NULL OR (pre_open_report_hour_jst >= 0 AND pre_open_report_hour_jst <= 23));

COMMENT ON COLUMN stores.pre_open_report_hour_jst IS '営業前サマリー送信のJST「時」（0–23）。NULL時は環境変数 PRE_OPEN_REPORT_HOUR_JST 等';
COMMENT ON COLUMN stores.last_pre_open_report_date IS '最後に営業前サマリーを送信したJST暦日';
