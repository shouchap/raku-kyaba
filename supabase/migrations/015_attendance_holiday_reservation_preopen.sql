-- フェーズ1: attendance_status 拡張、予約・理由・LINE待ち、営業前サマリー用カラム

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_enum e ON t.oid = e.enumtypid
    WHERE t.typname = 'attendance_status'
      AND e.enumlabel = 'public_holiday'
  ) THEN
    ALTER TYPE attendance_status ADD VALUE 'public_holiday';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_enum e ON t.oid = e.enumtypid
    WHERE t.typname = 'attendance_status'
      AND e.enumlabel = 'half_holiday'
  ) THEN
    ALTER TYPE attendance_status ADD VALUE 'half_holiday';
  END IF;
END
$$;

ALTER TABLE public.attendance_schedules
  ADD COLUMN IF NOT EXISTS public_holiday_reason TEXT,
  ADD COLUMN IF NOT EXISTS half_holiday_reason TEXT,
  ADD COLUMN IF NOT EXISTS has_reservation BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS reservation_details TEXT,
  ADD COLUMN IF NOT EXISTS pending_line_flow VARCHAR(50),
  ADD COLUMN IF NOT EXISTS pending_line_updated_at TIMESTAMPTZ;

COMMENT ON COLUMN public.attendance_schedules.public_holiday_reason IS '公休の理由';
COMMENT ON COLUMN public.attendance_schedules.half_holiday_reason IS '半休の理由';
COMMENT ON COLUMN public.attendance_schedules.has_reservation IS '来客・同伴予約の有無（出勤確定時）';
COMMENT ON COLUMN public.attendance_schedules.reservation_details IS '来客・同伴予約の詳細';
COMMENT ON COLUMN public.attendance_schedules.pending_line_flow IS 'LINE対話状態（例: reservation_ask / reservation_detail）';
COMMENT ON COLUMN public.attendance_schedules.pending_line_updated_at IS 'pending_line_flow 最終更新';

ALTER TABLE public.attendance_logs
  ADD COLUMN IF NOT EXISTS public_holiday_reason TEXT,
  ADD COLUMN IF NOT EXISTS half_holiday_reason TEXT,
  ADD COLUMN IF NOT EXISTS has_reservation BOOLEAN,
  ADD COLUMN IF NOT EXISTS reservation_details TEXT;

COMMENT ON COLUMN public.attendance_logs.public_holiday_reason IS '公休の理由（ログスナップショット）';
COMMENT ON COLUMN public.attendance_logs.half_holiday_reason IS '半休の理由（ログスナップショット）';
COMMENT ON COLUMN public.attendance_logs.has_reservation IS '来客・同伴予約の有無';
COMMENT ON COLUMN public.attendance_logs.reservation_details IS '来客・同伴予約の詳細';

ALTER TABLE public.stores
  ADD COLUMN IF NOT EXISTS pre_open_report_hour_jst INTEGER CHECK (
    pre_open_report_hour_jst IS NULL
    OR (pre_open_report_hour_jst >= 0 AND pre_open_report_hour_jst <= 23)
  ),
  ADD COLUMN IF NOT EXISTS last_pre_open_report_date DATE;

COMMENT ON COLUMN public.stores.pre_open_report_hour_jst IS '営業前サマリー送信の JST 時（0–23）。NULL のときは環境変数 PRE_OPEN_REPORT_HOUR_JST 等';
COMMENT ON COLUMN public.stores.last_pre_open_report_date IS '最後に営業前サマリーを送信した JST 暦日（二重送信防止）';
