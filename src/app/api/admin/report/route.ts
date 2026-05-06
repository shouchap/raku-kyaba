import { NextResponse } from "next/server";
import type { User } from "@supabase/supabase-js";
import { createServiceRoleClient } from "@/lib/supabase-service";
import { isValidStoreId, parseActiveStoreIdFromCookieHeader } from "@/lib/current-store";
import { canUserEditStore, getAuthedUserForAdminApi } from "@/lib/admin-store-auth";
import { isSuperAdminUser } from "@/lib/super-admin";
import { isUndefinedColumnError, logPostgrestError } from "@/lib/postgrest-error";
import { getTodayJst } from "@/lib/date-utils";
import {
  buildAdminReportCastRows,
  normalizeRegularHolidays,
  type AdminReportScheduleRow,
} from "@/lib/admin-report-aggregate";

export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** GET /api/admin/report の cast_reports に付ける打刻一覧（管理画面の手動編集用） */
export type ReportAttendanceLogPeriodRow = {
  attendanceLogId: string;
  attendedDate: string;
  status: string;
  plannedGroups: number | null;
  tentativeGroups: number;
  actionType: string | null;
  actionDetail: string | null;
  isSabaki: boolean;
  publicHolidayReason: string | null;
  halfHolidayReason: string | null;
  hasReservation: boolean | null;
  reservationDetails: string | null;
  respondedAt: string;
};

function storeIdForbiddenUnlessMatchesCookie(
  request: Request,
  user: User,
  storeId: string
): NextResponse | null {
  if (isSuperAdminUser(user)) return null;
  const cookieStoreId = parseActiveStoreIdFromCookieHeader(request.headers.get("cookie"));
  if (cookieStoreId && storeId !== cookieStoreId) {
    return NextResponse.json(
      { error: "storeId must match active store (cookie)" },
      { status: 403 }
    );
  }
  return null;
}

/**
 * 月間レポート用データ（B型は welfare_daily_logs + casts 名）
 * GET /api/admin/report?storeId=uuid&start=YYYY-MM-DD&end=YYYY-MM-DD
 * 単日: GET /api/admin/report?storeId=uuid&view=day&date=YYYY-MM-DD
 */
export async function GET(request: Request) {
  const { user, error } = await getAuthedUserForAdminApi();
  if (error === "config") {
    return NextResponse.json({ error: "Supabase is not configured" }, { status: 500 });
  }
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sp = new URL(request.url).searchParams;
  const storeId = sp.get("storeId")?.trim() ?? "";
  const view = sp.get("view")?.trim().toLowerCase() ?? "";

  let start: string;
  let end: string;

  if (view === "day") {
    const dayOnly = sp.get("date")?.trim() ?? "";
    if (!DATE_RE.test(dayOnly)) {
      return NextResponse.json(
        { error: "view=day requires date=YYYY-MM-DD (single JST calendar day)" },
        { status: 400 }
      );
    }
    start = dayOnly;
    end = dayOnly;
  } else {
    start = sp.get("start")?.trim() ?? "";
    end = sp.get("end")?.trim() ?? "";
    if (!DATE_RE.test(start) || !DATE_RE.test(end)) {
      return NextResponse.json(
        { error: "start and end must be YYYY-MM-DD (JST range as calendar dates)" },
        { status: 400 }
      );
    }
    if (start > end) {
      return NextResponse.json({ error: "start must be <= end" }, { status: 400 });
    }
  }

  if (!storeId || !isValidStoreId(storeId)) {
    return NextResponse.json({ error: "Valid storeId is required" }, { status: 400 });
  }

  if (!canUserEditStore(user, storeId)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const cookieMismatch = storeIdForbiddenUnlessMatchesCookie(request, user, storeId);
  if (cookieMismatch) return cookieMismatch;

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()) {
    return NextResponse.json({ error: "Server configuration error" }, { status: 500 });
  }

  let admin: ReturnType<typeof createServiceRoleClient>;
  try {
    admin = createServiceRoleClient();
  } catch (e) {
    logPostgrestError("GET /api/admin/report createServiceRoleClient", e);
    return NextResponse.json(
      { error: "Server configuration error (service role)" },
      { status: 500 }
    );
  }

  type ReportStoreRow = {
    id: string;
    name?: string | null;
    business_type?: string | null;
    regular_holidays?: unknown;
    is_guide_enabled?: boolean | null;
    attendance_flow_type?: string | null;
  };

  let storeRow: ReportStoreRow | null = null;

  const fullStoreRes = await admin
    .from("stores")
    .select("id, name, business_type, regular_holidays, is_guide_enabled, attendance_flow_type")
    .eq("id", storeId)
    .maybeSingle();

  if (fullStoreRes.error && isUndefinedColumnError(fullStoreRes.error, "is_guide_enabled")) {
    const legacy = await admin
      .from("stores")
      .select("id, name, business_type, regular_holidays, attendance_flow_type")
      .eq("id", storeId)
      .maybeSingle();
    if (legacy.error || !legacy.data) {
      logPostgrestError("GET /api/admin/report stores (legacy)", legacy.error ?? new Error("no row"));
      return NextResponse.json(
        { error: "Failed to load store", details: legacy.error?.message ?? "unknown" },
        { status: 500 }
      );
    }
    storeRow = {
      ...(legacy.data as ReportStoreRow),
      is_guide_enabled: true,
    };
  } else if (fullStoreRes.error || !fullStoreRes.data) {
    logPostgrestError("GET /api/admin/report stores", fullStoreRes.error ?? new Error("no row"));
    return NextResponse.json(
      { error: "Failed to load store", details: fullStoreRes.error?.message ?? "unknown" },
      { status: 500 }
    );
  } else {
    storeRow = fullStoreRes.data as ReportStoreRow;
  }

  if (!storeRow?.id) {
    return NextResponse.json({ error: "Store not found" }, { status: 404 });
  }

  const businessType = String(storeRow.business_type ?? "cabaret");

  const storePayload = {
    id: storeRow.id,
    name: String(storeRow.name ?? ""),
    is_guide_enabled: storeRow.is_guide_enabled !== false,
    attendance_flow_type: String(storeRow.attendance_flow_type ?? "default"),
  };

  if (businessType !== "welfare_b") {
    const todayYmd = getTodayJst();
    const regularHolidays = normalizeRegularHolidays(
      (storeRow as { regular_holidays?: unknown }).regular_holidays
    );

    const { data: castRows, error: castListErr } = await admin
      .from("casts")
      .select("id, name")
      .eq("store_id", storeId)
      .eq("is_active", true)
      .order("name");

    if (castListErr) {
      logPostgrestError("GET /api/admin/report casts (cabaret/bar)", castListErr);
      return NextResponse.json(
        { error: "Failed to load casts", details: castListErr.message },
        { status: 500 }
      );
    }

    const casts = (castRows ?? []) as { id: string; name: string }[];
    const castIds = casts.map((c) => c.id);

    let schedules: AdminReportScheduleRow[] = [];
    const logsInPeriodByCast = new Map<string, ReportAttendanceLogPeriodRow[]>();
    if (castIds.length > 0) {
      const { data: schedRows, error: schedErr } = await admin
        .from("attendance_schedules")
        .select(
          "id, cast_id, scheduled_date, is_dohan, is_sabaki, is_absent, is_late, late_reason, absent_reason, public_holiday_reason, half_holiday_reason, response_status, is_action_completed, last_reminded_at"
        )
        .eq("store_id", storeId)
        .in("cast_id", castIds)
        .gte("scheduled_date", start)
        .lte("scheduled_date", end)
        .order("scheduled_date");

      if (schedErr) {
        logPostgrestError("GET /api/admin/report attendance_schedules", schedErr);
        return NextResponse.json(
          { error: "Failed to load schedules", details: schedErr.message },
          { status: 500 }
        );
      }

      schedules = (schedRows ?? []) as AdminReportScheduleRow[];

      const { data: attendanceLogs } = await admin
        .from("attendance_logs")
        .select(
          [
            "id",
            "cast_id",
            "attended_date",
            "status",
            "planned_groups",
            "tentative_groups",
            "action_type",
            "action_detail",
            "is_sabaki",
            "public_holiday_reason",
            "half_holiday_reason",
            "has_reservation",
            "reservation_details",
            "responded_at",
          ].join(", ")
        )
        .eq("store_id", storeId)
        .in("cast_id", castIds)
        .gte("attended_date", start)
        .lte("attended_date", end);

      type LogAugment = {
        attendance_log_id: string;
        log_status: AdminReportScheduleRow["log_status"];
        planned_groups: number | null;
        tentative_groups: number | null;
        action_type: string | null;
        action_detail: string | null;
      };

      const logMap = new Map<string, LogAugment>();

      const numericOrNull = (v: unknown): number | null => {
        if (v === null || v === undefined) return null;
        const n = typeof v === "number" ? v : Number(v);
        return Number.isFinite(n) ? n : null;
      };

      const intOrZero = (v: unknown): number => {
        if (typeof v === "number" && Number.isFinite(v)) return Math.trunc(v);
        if (v != null && v !== "") {
          const n = Number(v);
          if (Number.isFinite(n)) return Math.trunc(n);
        }
        return 0;
      };

      for (const row of attendanceLogs ?? []) {
        const castId = String((row as { cast_id?: string }).cast_id ?? "");
        const date = String((row as { attended_date?: string }).attended_date ?? "");
        const planned_groups = numericOrNull((row as { planned_groups?: unknown }).planned_groups);
        const tentative_groups = intOrZero((row as { tentative_groups?: unknown }).tentative_groups);
        const aug: LogAugment = {
          attendance_log_id: String((row as { id?: string }).id ?? ""),
          log_status: ((row as { status?: string | null }).status ??
            null) as AdminReportScheduleRow["log_status"],
          planned_groups,
          tentative_groups,
          action_type: ((row as { action_type?: string | null }).action_type ?? null) as string | null,
          action_detail: ((row as { action_detail?: string | null }).action_detail ?? null) as string | null,
        };
        logMap.set(`${castId}:${date}`, aug);

        const payload: ReportAttendanceLogPeriodRow = {
          attendanceLogId: aug.attendance_log_id,
          attendedDate: date,
          status: String((row as { status?: string }).status ?? "attending"),
          plannedGroups: planned_groups,
          tentativeGroups: tentative_groups,
          actionType: aug.action_type,
          actionDetail: aug.action_detail,
          isSabaki: Boolean((row as { is_sabaki?: boolean }).is_sabaki),
          publicHolidayReason: ((row as { public_holiday_reason?: string | null }).public_holiday_reason ??
            null) as string | null,
          halfHolidayReason: ((row as { half_holiday_reason?: string | null }).half_holiday_reason ??
            null) as string | null,
          hasReservation: (() => {
            const hr = (row as { has_reservation?: boolean | null }).has_reservation;
            return typeof hr === "boolean" ? hr : null;
          })(),
          reservationDetails: ((row as { reservation_details?: string | null }).reservation_details ??
            null) as string | null,
          respondedAt: String((row as { responded_at?: string }).responded_at ?? ""),
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
      periodStartYmd: start,
      periodEndYmd: end,
      regularHolidays,
      unfilledCountMode: "sent_confirmation_only",
    });

    const bt =
      businessType === "bar" ? "bar" : ("cabaret" as const);

    const cast_reports_payload = cast_reports.map((cr) => ({
      ...cr,
      attendance_logs_in_period: logsInPeriodByCast.get(cr.castId) ?? [],
    }));

    return NextResponse.json({
      ok: true,
      business_type: bt,
      store: storePayload,
      welfare_rows: null,
      today: todayYmd,
      period: { start, end },
      cast_reports: cast_reports_payload,
    });
  }

  const { data: logRows, error: logErr } = await admin
    .from("welfare_daily_logs")
    .select(
      "id, cast_id, work_date, started_at, ended_at, work_item, work_details, quantity, health_status, health_reason, health_notes, is_hospital_visit, hospital_name, symptoms, visit_duration"
    )
    .eq("store_id", storeId)
    .gte("work_date", start)
    .lte("work_date", end)
    .order("work_date", { ascending: false })
    .order("cast_id", { ascending: true });

  if (logErr) {
    logPostgrestError("GET /api/admin/report welfare_daily_logs", logErr);
    return NextResponse.json(
      { error: "Failed to load welfare daily logs", details: logErr.message, code: logErr.code },
      { status: 500 }
    );
  }

  const logs = (logRows ?? []) as Record<string, unknown>[];
  const castIds = [...new Set(logs.map((r) => String(r.cast_id ?? "")).filter(Boolean))];
  const nameByCastId = new Map<string, string>();
  if (castIds.length > 0) {
    const { data: castRows, error: castErr } = await admin
      .from("casts")
      .select("id, name")
      .eq("store_id", storeId)
      .in("id", castIds);
    if (castErr) {
      logPostgrestError("GET /api/admin/report casts", castErr);
      return NextResponse.json(
        { error: "Failed to load cast names", details: castErr.message },
        { status: 500 }
      );
    }
    for (const c of castRows ?? []) {
      const row = c as { id?: string; name?: string };
      if (row.id) nameByCastId.set(row.id, String(row.name ?? ""));
    }
  }

  const welfare_rows = logs.map((raw) => {
    const cid = String(raw.cast_id ?? "");
    return {
      id: String(raw.id ?? ""),
      cast_id: cid,
      cast_name: nameByCastId.get(cid) ?? "",
      work_date: String(raw.work_date ?? ""),
      started_at: (raw.started_at as string | null) ?? null,
      ended_at: (raw.ended_at as string | null) ?? null,
      work_item: (raw.work_item as string | null) ?? null,
      work_details: (raw.work_details as string | null) ?? null,
      quantity: typeof raw.quantity === "number" ? raw.quantity : null,
      health_status: (raw.health_status as string | null) ?? null,
      health_reason: (raw.health_reason as string | null) ?? null,
      health_notes: (raw.health_notes as string | null) ?? null,
      is_hospital_visit: raw.is_hospital_visit === true,
      hospital_name: (raw.hospital_name as string | null) ?? null,
      symptoms: (raw.symptoms as string | null) ?? null,
      visit_duration: (raw.visit_duration as string | null) ?? null,
    };
  });

  return NextResponse.json({
    ok: true,
    business_type: "welfare_b",
    store: storePayload,
    welfare_rows,
  });
}
