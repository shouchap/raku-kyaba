import type { SupabaseClient } from "@supabase/supabase-js";
import { getTodayJst } from "@/lib/date-utils";
import { resolveCustomTerms } from "@/lib/custom-terms";
import { logPostgrestError, isUndefinedColumnError } from "@/lib/postgrest-error";
import {
  buildAdminReportCastRows,
  normalizeRegularHolidays,
  type AdminReportScheduleRow,
} from "@/lib/admin-report-aggregate";
import {
  computeWeeklyReportPeriod,
  mergeBarActionDetailCountsInto,
  type WeeklyReportBuildInput,
  type WeeklyReportBusinessType,
} from "@/lib/line-weekly-report";

type PeriodLogRow = {
  attendedDate: string;
  status: string;
  plannedGroups: number | null;
  tentativeGroups: number;
  actionDetail: string | null;
};

function numericOrNull(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function intOrZero(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return Math.trunc(v);
  if (v != null && v !== "") {
    const n = Number(v);
    if (Number.isFinite(n)) return Math.trunc(n);
  }
  return 0;
}

/**
 * 週間レポート用に店舗データを集計する（送信日 JST から対象7日間を算出）。
 */
export async function loadWeeklyReportBuildInput(
  admin: SupabaseClient,
  params: { storeId: string; sendDateYmd: string }
): Promise<{ ok: true; input: WeeklyReportBuildInput } | { ok: false; error: string }> {
  const { storeId, sendDateYmd } = params;
  const todayYmd = getTodayJst();
  const { startYmd: periodStartYmd, endYmd: periodEndYmd } = computeWeeklyReportPeriod(sendDateYmd);

  const storeRes = await admin
    .from("stores")
    .select("id, name, business_type, regular_holidays, custom_terms")
    .eq("id", storeId)
    .maybeSingle();

  if (storeRes.error || !storeRes.data) {
    if (storeRes.error) logPostgrestError("weekly-report stores", storeRes.error);
    return { ok: false, error: storeRes.error?.message ?? "店舗が見つかりません" };
  }

  const storeRow = storeRes.data as {
    id?: string;
    name?: string | null;
    business_type?: string | null;
    regular_holidays?: unknown;
    custom_terms?: unknown;
  };

  const storeName = String(storeRow.name ?? "");
  const rawBt = String(storeRow.business_type ?? "cabaret");
  const businessType: WeeklyReportBusinessType =
    rawBt === "welfare_b" ? "welfare_b" : rawBt === "bar" ? "bar" : "cabaret";
  const regularHolidays = normalizeRegularHolidays(storeRow.regular_holidays);
  const terms = resolveCustomTerms(storeRow.custom_terms);

  if (businessType === "welfare_b") {
    const { data: logRows, error: logErr } = await admin
      .from("welfare_daily_logs")
      .select("cast_id, work_date, quantity")
      .eq("store_id", storeId)
      .gte("work_date", periodStartYmd)
      .lte("work_date", periodEndYmd);

    if (logErr) {
      logPostgrestError("weekly-report welfare_daily_logs", logErr);
      return { ok: false, error: logErr.message };
    }

    const logs = logRows ?? [];
    const dayKeys = new Set<string>();
    const castSet = new Set<string>();
    let quantitySum = 0;

    for (const r of logs) {
      const cid = String((r as { cast_id?: string }).cast_id ?? "");
      const wd = String((r as { work_date?: string }).work_date ?? "");
      if (cid) castSet.add(cid);
      if (cid && wd) dayKeys.add(`${cid}:${wd}`);
      const q = (r as { quantity?: unknown }).quantity;
      if (typeof q === "number" && Number.isFinite(q)) quantitySum += q;
    }

    const input: WeeklyReportBuildInput = {
      storeName,
      businessType: "welfare_b",
      periodStartYmd,
      periodEndYmd,
      termAttendance: terms.term_attendance,
      termCast: terms.term_cast,
      totalAttendanceDaysComposite: dayKeys.size,
      welfare: {
        logCount: logs.length,
        distinctCastCount: castSet.size,
        quantitySum,
      },
    };
    return { ok: true, input };
  }

  const { data: castRows, error: castListErr } = await admin
    .from("casts")
    .select("id, name")
    .eq("store_id", storeId)
    .eq("is_active", true)
    .order("name");

  if (castListErr) {
    logPostgrestError("weekly-report casts", castListErr);
    return { ok: false, error: castListErr.message };
  }

  const casts = (castRows ?? []) as { id: string; name: string }[];
  const castIds = casts.map((c) => c.id);

  let schedules: AdminReportScheduleRow[] = [];
  const logsInPeriodByCast = new Map<string, PeriodLogRow[]>();

  if (castIds.length > 0) {
    const { data: schedRows, error: schedErr } = await admin
      .from("attendance_schedules")
      .select(
        "id, cast_id, scheduled_date, is_dohan, is_sabaki, is_absent, is_late, late_reason, absent_reason, public_holiday_reason, half_holiday_reason, response_status, is_action_completed, last_reminded_at"
      )
      .eq("store_id", storeId)
      .in("cast_id", castIds)
      .gte("scheduled_date", periodStartYmd)
      .lte("scheduled_date", periodEndYmd)
      .order("scheduled_date");

    if (schedErr) {
      logPostgrestError("weekly-report attendance_schedules", schedErr);
      return { ok: false, error: schedErr.message };
    }

    schedules = (schedRows ?? []) as AdminReportScheduleRow[];

    const { data: attendanceLogs, error: logFetchErr } = await admin
      .from("attendance_logs")
      .select(
        "id, cast_id, attended_date, status, planned_groups, tentative_groups, action_type, action_detail"
      )
      .eq("store_id", storeId)
      .in("cast_id", castIds)
      .gte("attended_date", periodStartYmd)
      .lte("attended_date", periodEndYmd);

    if (logFetchErr) {
      logPostgrestError("weekly-report attendance_logs", logFetchErr);
      return { ok: false, error: logFetchErr.message };
    }

    type LogAugment = {
      attendance_log_id: string;
      log_status: AdminReportScheduleRow["log_status"];
      planned_groups: number | null;
      tentative_groups: number | null;
      action_type: string | null;
      action_detail: string | null;
    };

    const logMap = new Map<string, LogAugment>();

    for (const row of attendanceLogs ?? []) {
      const castId = String((row as { cast_id?: string }).cast_id ?? "");
      const date = String((row as { attended_date?: string }).attended_date ?? "");
      const planned_groups = numericOrNull((row as { planned_groups?: unknown }).planned_groups);
      const tentative_groups = intOrZero((row as { tentative_groups?: unknown }).tentative_groups);
      const aug: LogAugment = {
        attendance_log_id: String((row as { id?: string }).id ?? ""),
        log_status: ((row as { status?: string | null }).status ?? null) as AdminReportScheduleRow["log_status"],
        planned_groups,
        tentative_groups,
        action_type: ((row as { action_type?: string | null }).action_type ?? null) as string | null,
        action_detail: ((row as { action_detail?: string | null }).action_detail ?? null) as string | null,
      };
      logMap.set(`${castId}:${date}`, aug);

      const payload: PeriodLogRow = {
        attendedDate: date,
        status: String((row as { status?: string }).status ?? "attending"),
        plannedGroups: planned_groups,
        tentativeGroups: tentative_groups,
        actionDetail: aug.action_detail,
      };
      const list = logsInPeriodByCast.get(castId) ?? [];
      list.push(payload);
      logsInPeriodByCast.set(castId, list);
    }

    for (const [, list] of logsInPeriodByCast) {
      list.sort((a, b) => a.attendedDate.localeCompare(b.attendedDate));
    }

    schedules = schedules.map((s): AdminReportScheduleRow => {
      const key = `${s.cast_id}:${s.scheduled_date}`;
      const found = logMap.get(key);
      return found ? ({ ...s, ...found } as AdminReportScheduleRow) : s;
    });
  }

  const cast_reports = buildAdminReportCastRows(casts, schedules, {
    todayYmd,
    periodStartYmd,
    periodEndYmd,
    regularHolidays,
    unfilledCountMode: "sent_confirmation_only",
  });

  const totalAttendanceDaysComposite = cast_reports.reduce((sum, cr) => sum + cr.attendanceDays, 0);

  let totalGuideGroups = 0;
  const gRes = await admin
    .from("daily_guide_results")
    .select("guide_count")
    .eq("store_id", storeId)
    .gte("target_date", periodStartYmd)
    .lte("target_date", periodEndYmd);

  if (gRes.error) {
    if (!isUndefinedColumnError(gRes.error, "guide_count")) {
      logPostgrestError("weekly-report daily_guide_results", gRes.error);
      return { ok: false, error: gRes.error.message };
    }
  } else {
    for (const row of gRes.data ?? []) {
      const n = (row as { guide_count?: unknown }).guide_count;
      totalGuideGroups += typeof n === "number" && Number.isFinite(n) ? n : 0;
    }
  }

  const totalCompanionPairs = cast_reports.reduce((sum, cr) => sum + cr.dohanCount, 0);

  let plannedGroupsSum = 0;
  let tentativeGroupsSum = 0;
  const castActionLines: Array<{ castName: string; summaryParts: string[] }> = [];

  if (businessType === "bar") {
    const sortedCasts = [...cast_reports].sort((a, b) =>
      a.name.localeCompare(b.name, "ja") || a.castId.localeCompare(b.castId)
    );
    for (const cr of sortedCasts) {
      const logs = logsInPeriodByCast.get(cr.castId) ?? [];
      const kindMap = new Map<string, number>();
      for (const log of logs) {
        if (log.status !== "attending") continue;
        const p = log.plannedGroups;
        plannedGroupsSum += typeof p === "number" && Number.isFinite(p) ? p : 0;
        tentativeGroupsSum +=
          typeof log.tentativeGroups === "number" && Number.isFinite(log.tentativeGroups)
            ? log.tentativeGroups
            : 0;
        mergeBarActionDetailCountsInto(kindMap, log.actionDetail);
      }
      const summaryParts = [...kindMap.entries()]
        .sort((a, b) => a[0].localeCompare(b[0], "ja"))
        .map(([k, c]) => `${k} ${c}`);
      if (summaryParts.length === 0) continue;
      castActionLines.push({ castName: cr.name, summaryParts });
    }
  }

  const input: WeeklyReportBuildInput = {
    storeName,
    businessType,
    periodStartYmd,
    periodEndYmd,
    termAttendance: terms.term_attendance,
    termCast: terms.term_cast,
    totalAttendanceDaysComposite,
    ...(businessType === "cabaret"
      ? {
          cabaret: {
            totalGuideGroups,
            totalCompanionPairs,
          },
        }
      : {}),
    ...(businessType === "bar"
      ? {
          bar: {
            plannedGroupsSum,
            tentativeGroupsSum,
            castActionLines,
          },
        }
      : {}),
  };

  return { ok: true, input };
}
