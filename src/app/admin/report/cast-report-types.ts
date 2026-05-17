import type { ReportAttendanceLogPeriodRow } from "@/app/api/admin/report/route";

export type CastReportIncident = {
  dateStr: string;
  kind: "late" | "absent" | "public_holiday" | "half_holiday";
  reason: string | null;
};

export type CastReport = {
  castId: string;
  name: string;
  departedAt: string | null;
  departureReason: string | null;
  attendanceDays: number;
  dohanCount: number;
  sabakiCount: number;
  sabakiDates: string[];
  lateCount: number;
  absentCount: number;
  halfHolidayCount: number;
  publicHolidayCount: number;
  unfilledDays: number;
  incidents: CastReportIncident[];
  attendanceLogsInPeriod: ReportAttendanceLogPeriodRow[];
  actionDetails: Array<{
    dateStr: string;
    attendanceLogId: string | null;
    plannedGroups: number | null;
    tentativeGroups: number | null;
    actionType: string | null;
    actionDetail: string | null;
  }>;
};

export type CastReportSortKey =
  | "name"
  | "attendance"
  | "dohan"
  | "sabaki"
  | "late"
  | "absent"
  | "halfHoliday"
  | "publicHoliday"
  | "unfilled";

export function mapCastReportRow(raw: Record<string, unknown>): CastReport {
  const logsRaw = raw.attendance_logs_in_period;
  const attendanceLogsInPeriod: ReportAttendanceLogPeriodRow[] = Array.isArray(logsRaw)
    ? (logsRaw as Record<string, unknown>[]).map((row) => ({
        attendanceLogId: String(row.attendanceLogId ?? ""),
        attendedDate: String(row.attendedDate ?? ""),
        status: String(row.status ?? "attending"),
        plannedGroups:
          row.plannedGroups === null || row.plannedGroups === undefined
            ? null
            : typeof row.plannedGroups === "number"
              ? row.plannedGroups
              : Number(row.plannedGroups),
        tentativeGroups:
          typeof row.tentativeGroups === "number"
            ? Math.trunc(row.tentativeGroups)
            : Number(row.tentativeGroups ?? 0),
        actionType: (row.actionType ?? null) as string | null,
        actionDetail: (row.actionDetail ?? null) as string | null,
        isSabaki: Boolean(row.isSabaki),
        publicHolidayReason: (row.publicHolidayReason ?? null) as string | null,
        halfHolidayReason: (row.halfHolidayReason ?? null) as string | null,
        hasReservation: typeof row.hasReservation === "boolean" ? row.hasReservation : null,
        reservationDetails: (row.reservationDetails ?? null) as string | null,
        respondedAt: String(row.respondedAt ?? ""),
      }))
    : [];
  const detailsRaw = raw.actionDetails;
  const actionDetails = Array.isArray(detailsRaw)
    ? (detailsRaw as Record<string, unknown>[]).map((d) => ({
        dateStr: String(d.dateStr ?? ""),
        attendanceLogId:
          typeof d.attendanceLogId === "string"
            ? d.attendanceLogId
            : d.attendanceLogId != null
              ? String(d.attendanceLogId)
              : null,
        plannedGroups:
          typeof d.plannedGroups === "number"
            ? d.plannedGroups
            : d.plannedGroups != null
              ? Number(d.plannedGroups)
              : null,
        tentativeGroups:
          typeof d.tentativeGroups === "number"
            ? d.tentativeGroups
            : d.tentativeGroups != null
              ? Number(d.tentativeGroups)
              : null,
        actionType: (d.actionType ?? null) as string | null,
        actionDetail: (d.actionDetail ?? null) as string | null,
      }))
    : [];

  return {
    castId: String(raw.castId ?? ""),
    name: String(raw.name ?? ""),
    departedAt:
      typeof raw.departedAt === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw.departedAt)
        ? raw.departedAt
        : null,
    departureReason: typeof raw.departureReason === "string" ? raw.departureReason : null,
    attendanceDays: typeof raw.attendanceDays === "number" ? raw.attendanceDays : 0,
    dohanCount: typeof raw.dohanCount === "number" ? raw.dohanCount : 0,
    sabakiCount: typeof raw.sabakiCount === "number" ? raw.sabakiCount : 0,
    sabakiDates: Array.isArray(raw.sabakiDates) ? (raw.sabakiDates as string[]) : [],
    lateCount: typeof raw.lateCount === "number" ? raw.lateCount : 0,
    absentCount: typeof raw.absentCount === "number" ? raw.absentCount : 0,
    halfHolidayCount: typeof raw.halfHolidayCount === "number" ? raw.halfHolidayCount : 0,
    publicHolidayCount: typeof raw.publicHolidayCount === "number" ? raw.publicHolidayCount : 0,
    unfilledDays: typeof raw.unfilledDays === "number" ? raw.unfilledDays : 0,
    incidents: Array.isArray(raw.incidents) ? (raw.incidents as CastReportIncident[]) : [],
    attendanceLogsInPeriod,
    actionDetails,
  };
}

export function sortCastReports(
  list: CastReport[],
  sortKey: CastReportSortKey,
  sortDir: "asc" | "desc"
): CastReport[] {
  const dir = sortDir === "asc" ? 1 : -1;
  return [...list].sort((a, b) => {
    let cmp = 0;
    switch (sortKey) {
      case "name":
        cmp = a.name.localeCompare(b.name, "ja");
        break;
      case "attendance":
        cmp = a.attendanceDays - b.attendanceDays;
        break;
      case "dohan":
        cmp = a.dohanCount - b.dohanCount;
        break;
      case "sabaki":
        cmp = a.sabakiCount - b.sabakiCount;
        break;
      case "late":
        cmp = a.lateCount - b.lateCount;
        break;
      case "absent":
        cmp = a.absentCount - b.absentCount;
        break;
      case "halfHoliday":
        cmp = a.halfHolidayCount - b.halfHolidayCount;
        break;
      case "publicHoliday":
        cmp = a.publicHolidayCount - b.publicHolidayCount;
        break;
      case "unfilled":
        cmp = a.unfilledDays - b.unfilledDays;
        break;
      default:
        cmp = 0;
    }
    return cmp * dir;
  });
}

export async function fetchCastReportsForPeriod(
  storeId: string,
  start: string,
  end: string
): Promise<CastReport[]> {
  const reportUrl = `/api/admin/report?storeId=${encodeURIComponent(storeId)}&start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`;
  const reportRes = await fetch(reportUrl, { credentials: "include" });
  const payload = (await reportRes.json().catch(() => ({}))) as {
    ok?: boolean;
    cast_reports?: Record<string, unknown>[];
    error?: string;
    details?: string;
  };
  if (!reportRes.ok) {
    throw new Error(
      [payload.error, payload.details].filter(Boolean).join(" — ") ||
        "レポートの取得に失敗しました"
    );
  }
  const rows = Array.isArray(payload.cast_reports) ? payload.cast_reports : [];
  return rows.map((raw) => mapCastReportRow(raw));
}
