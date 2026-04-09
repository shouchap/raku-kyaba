/**
 * LINE 勤怠回答や理由が載っている行かどうか（週次シフト保存で行を消さない判定に使用）
 */
export function scheduleRowHasLineAttendanceData(row: Record<string, unknown>): boolean {
  const rs = row.response_status;
  if (rs != null && String(rs).trim() !== "") return true;
  if (String(row.public_holiday_reason ?? "").trim()) return true;
  if (String(row.half_holiday_reason ?? "").trim()) return true;
  if (String(row.late_reason ?? "").trim()) return true;
  if (String(row.absent_reason ?? "").trim()) return true;
  return false;
}

/** 週次保存でシフト枠だけ更新し、LINE 由来の勤怠フィールドを引き継ぐときのマージ */
export function mergeScheduleRowForWeeklyUpsert(
  base: {
    store_id: string;
    cast_id: string;
    scheduled_date: string;
    scheduled_time: string;
    is_dohan: boolean;
    is_sabaki: boolean;
  },
  prev: Record<string, unknown> | undefined
): Record<string, unknown> {
  if (!prev) {
    return {
      ...base,
    };
  }
  return {
    ...base,
    response_status: prev.response_status ?? null,
    is_absent: prev.is_absent ?? false,
    is_late: prev.is_late ?? false,
    late_reason: prev.late_reason ?? null,
    absent_reason: prev.absent_reason ?? null,
    public_holiday_reason: prev.public_holiday_reason ?? null,
    half_holiday_reason: prev.half_holiday_reason ?? null,
    is_action_completed: prev.is_action_completed ?? false,
    pending_line_flow: prev.pending_line_flow ?? null,
    pending_line_updated_at: prev.pending_line_updated_at ?? null,
    has_reservation: prev.has_reservation ?? null,
    reservation_details: prev.reservation_details ?? null,
    last_reminded_at: prev.last_reminded_at ?? null,
    admin_warned_at: prev.admin_warned_at ?? null,
  };
}
