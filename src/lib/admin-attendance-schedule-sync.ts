import type { createServiceRoleClient } from "@/lib/supabase-service";
import { logPostgrestError } from "@/lib/postgrest-error";
import { normalizeYmdDateKey } from "@/lib/date-utils";

type AdminClient = ReturnType<typeof createServiceRoleClient>;

type AttendanceStatus =
  | "attending"
  | "absent"
  | "late"
  | "public_holiday"
  | "half_holiday";

type AttendanceLogLike = {
  store_id: string;
  cast_id: string;
  attended_date: string;
  status: AttendanceStatus;
  attendance_schedule_id?: string | null;
  is_sabaki?: boolean | null;
  public_holiday_reason?: string | null;
  half_holiday_reason?: string | null;
};

export type AttendanceScheduleSyncOverrides = {
  scheduled_time?: string | null;
  scheduled_end_time?: string | null;
};

type SyncResult =
  | { ok: true; scheduleId: string }
  | { ok: false; error: string; details?: string };

function buildSchedulePatchFromLog(
  log: AttendanceLogLike,
  overrides: AttendanceScheduleSyncOverrides = {}
): Record<string, unknown> {
  const status = log.status;
  const dateKey = normalizeYmdDateKey(log.attended_date);
  if (!dateKey) {
    throw new Error("Invalid attendance date key");
  }
  const patch: Record<string, unknown> = {
    store_id: log.store_id,
    cast_id: log.cast_id,
    scheduled_date: dateKey,
    response_status: status,
    is_action_completed: true,
    is_absent: status === "absent",
    is_late: status === "late",
    is_sabaki: Boolean(log.is_sabaki),
    public_holiday_reason: status === "public_holiday" ? log.public_holiday_reason ?? null : null,
    half_holiday_reason: status === "half_holiday" ? log.half_holiday_reason ?? null : null,
    updated_at: new Date().toISOString(),
  };
  if ("scheduled_time" in overrides) {
    patch.scheduled_time = overrides.scheduled_time;
  }
  if ("scheduled_end_time" in overrides) {
    patch.scheduled_end_time = overrides.scheduled_end_time;
  }
  return patch;
}

/**
 * 手動編集された実績を、出勤一覧・レポートが参照する予定行にも反映する。
 */
export async function syncAttendanceScheduleFromLog(
  admin: AdminClient,
  log: AttendanceLogLike,
  overrides: AttendanceScheduleSyncOverrides = {}
): Promise<SyncResult> {
  const dateKey = normalizeYmdDateKey(log.attended_date);
  if (!dateKey) {
    return { ok: false, error: "Invalid attendance date key" };
  }

  const { data, error } = await admin
    .from("attendance_schedules")
    .upsert(buildSchedulePatchFromLog(log, overrides), {
      onConflict: "store_id,cast_id,scheduled_date",
    })
    .select("id")
    .single();

  if (error || !data?.id) {
    logPostgrestError("syncAttendanceScheduleFromLog upsert", error ?? new Error("no row"));
    return {
      ok: false,
      error: "Failed to sync attendance schedule",
      details: error?.message,
    };
  }

  return { ok: true, scheduleId: String(data.id) };
}

export async function resetAttendanceScheduleAfterLogDelete(
  admin: AdminClient,
  log: AttendanceLogLike
): Promise<SyncResult> {
  const dateKey = normalizeYmdDateKey(log.attended_date);
  if (!dateKey) {
    return { ok: false, error: "Invalid attendance date key" };
  }

  const { data, error } = await admin
    .from("attendance_schedules")
    .update({
      response_status: null,
      is_action_completed: false,
      is_absent: false,
      is_late: false,
      is_sabaki: false,
      public_holiday_reason: null,
      half_holiday_reason: null,
      late_reason: null,
      absent_reason: null,
      pending_line_flow: null,
      pending_line_updated_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq("store_id", log.store_id)
    .eq("cast_id", log.cast_id)
    .eq("scheduled_date", dateKey)
    .select("id")
    .maybeSingle();

  if (error) {
    logPostgrestError("resetAttendanceScheduleAfterLogDelete update", error);
    return {
      ok: false,
      error: "Failed to reset attendance schedule",
      details: error.message,
    };
  }

  return { ok: true, scheduleId: String(data?.id ?? log.attendance_schedule_id ?? "") };
}
