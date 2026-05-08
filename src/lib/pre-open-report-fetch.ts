/**
 * 営業前サマリー用に attendance_schedules を取得（casts ネスト付き、失敗時はフォールバック）
 * Cron / 個別テスト / pre-open-report で共通利用。
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PreOpenScheduleRow } from "@/lib/pre-open-report-message";

const DEFAULT_LOG_PREFIX = "[PreOpenReportFetch]";

export async function fetchSchedulesForPreOpenReport(
  supabase: SupabaseClient,
  storeId: string,
  targetDate: string,
  logPrefix: string = DEFAULT_LOG_PREFIX
): Promise<{ data: PreOpenScheduleRow[] | null; error: { message: string; code?: string } | null }> {
  const fullSelect =
    "id, cast_id, scheduled_time, scheduled_end_time, is_dohan, is_sabaki, response_status, late_reason, absent_reason, public_holiday_reason, half_holiday_reason, has_reservation, reservation_details, pending_line_flow, casts(name, display_name, role)";

  const minSelect =
    "id, cast_id, scheduled_time, scheduled_end_time, is_dohan, is_sabaki, response_status, late_reason, absent_reason, public_holiday_reason, half_holiday_reason, has_reservation, reservation_details, pending_line_flow";

  const first = await supabase
    .from("attendance_schedules")
    .select(fullSelect)
    .eq("store_id", storeId)
    .eq("scheduled_date", targetDate);

  if (first.error) {
    console.error(`${logPrefix} schedules select (with casts)`, storeId, {
      message: first.error.message,
      code: first.error.code,
      details: first.error.details,
      hint: first.error.hint,
    });
    const second = await supabase
      .from("attendance_schedules")
      .select(minSelect)
      .eq("store_id", storeId)
      .eq("scheduled_date", targetDate);
    if (second.error) {
      console.error(`${logPrefix} schedules select (minimal)`, storeId, {
        message: second.error.message,
        code: second.error.code,
      });
      return { data: null, error: { message: second.error.message, code: second.error.code } };
    }
    console.warn(`${logPrefix} using schedule rows without casts(name); names may show as 不明`);
    return {
      data: (second.data ?? []) as PreOpenScheduleRow[],
      error: null,
    };
  }

  return {
    data: (first.data ?? []) as PreOpenScheduleRow[],
    error: null,
  };
}
