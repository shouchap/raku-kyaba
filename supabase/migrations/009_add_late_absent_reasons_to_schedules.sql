-- attendance_schedules に遅刻・欠勤フラグと理由を追加（月間レポート集計用）
-- ※ is_absent は要件上の名称。既存の response_status と併用し、バックフィルで整合させる

ALTER TABLE attendance_schedules
  ADD COLUMN IF NOT EXISTS is_absent BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_late BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS late_reason TEXT,
  ADD COLUMN IF NOT EXISTS absent_reason TEXT;

COMMENT ON COLUMN attendance_schedules.is_absent IS '欠勤かどうか。response_status=absent と整合';
COMMENT ON COLUMN attendance_schedules.is_late IS '遅刻かどうか。response_status=late と整合';
COMMENT ON COLUMN attendance_schedules.late_reason IS '遅刻理由（任意）';
COMMENT ON COLUMN attendance_schedules.absent_reason IS '欠勤理由（任意）';

-- 既存データ: response_status からフラグを復元
UPDATE attendance_schedules
SET
  is_absent = (response_status = 'absent'::attendance_status),
  is_late = (response_status = 'late'::attendance_status)
WHERE response_status IS NOT NULL;
