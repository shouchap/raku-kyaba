import { addCalendarDaysJst, getWeekdayJst } from "@/lib/date-utils";

/** レポート集計用（attendance_schedules の行） */
export type AdminReportScheduleRow = {
  id: string;
  cast_id: string;
  scheduled_date: string;
  is_dohan: boolean | null;
  is_sabaki: boolean | null;
  is_absent: boolean | null;
  is_late: boolean | null;
  late_reason: string | null;
  absent_reason: string | null;
  public_holiday_reason: string | null;
  half_holiday_reason: string | null;
  /** attendance_logs.id があれば打刻の手動編集対象 */
  attendance_log_id?: string | null;
  /** attendance_logs.status（シフトの response_status とは別） */
  log_status?:
    | "attending"
    | "absent"
    | "late"
    | "public_holiday"
    | "half_holiday"
    | null;
  planned_groups?: number | null;
  tentative_groups?: number | null;
  action_type?: string | null;
  action_detail?: string | null;
  response_status:
    | "attending"
    | "absent"
    | "late"
    | "public_holiday"
    | "half_holiday"
    | null;
  is_action_completed?: boolean | null;
  /** 出勤確認 Flex 送信済み日時（送信ログ代替） */
  last_reminded_at?: string | null;
};

export type AdminReportIncident = {
  dateStr: string;
  kind: "late" | "absent" | "public_holiday" | "half_holiday";
  reason: string | null;
};

export type AdminReportCastRow = {
  castId: string;
  name: string;
  /** 集計期間内に退店した場合のみ（JST YYYY-MM-DD） */
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
  /** 定休を除く月初〜min(期末, 今日) の範囲で、回答済み日を除いた日数 */
  unfilledDays: number;
  incidents: AdminReportIncident[];
  actionDetails: Array<{
    dateStr: string;
    attendanceLogId: string | null;
    plannedGroups: number | null;
    tentativeGroups: number | null;
    actionType: string | null;
    actionDetail: string | null;
  }>;
};

type UnfilledCountMode = "calendar_excluding_regular_holidays" | "sent_confirmation_only";

export type AdminReportCastInput = {
  id: string;
  name: string;
  /** 集計期間内の退店日（退店済み行のみ） */
  departed_at?: string | null;
  departure_reason?: string | null;
};

function rowIsAbsent(row: AdminReportScheduleRow): boolean {
  return row.is_absent === true || row.response_status === "absent";
}

function rowIsOffDay(row: AdminReportScheduleRow): boolean {
  return (
    rowIsAbsent(row) ||
    row.response_status === "half_holiday" ||
    row.response_status === "public_holiday"
  );
}

function rowIsLate(row: AdminReportScheduleRow): boolean {
  return row.is_late === true || row.response_status === "late";
}

/**
 * キャストがその日について何らかの回答・確定があるか（未入力判定の減算側）。
 * 管理画面のみで同伴・捌きが付いた場合もシフト登録ありとみなす。
 */
export function scheduleRowHasRecordedAction(row: AdminReportScheduleRow): boolean {
  if (row.response_status != null) return true;
  if (row.is_action_completed === true) return true;
  if (row.is_absent === true || row.is_late === true) return true;
  if (row.is_dohan === true || row.is_sabaki === true) return true;
  return false;
}

/**
 * 未入力集計の対象期間の終端（JST 暦日）。
 * 「今日までの未入力」: 集計終了日と今日のうち早い方まで。
 */
export function unfilledWindowEndYmd(periodEndYmd: string, todayYmd: string): string {
  return periodEndYmd < todayYmd ? periodEndYmd : todayYmd;
}

/** stores.regular_holidays（0=日〜6=土）を正規化 */
export function normalizeRegularHolidays(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.filter((n) => Number.isInteger(n) && n >= 0 && n <= 6) as number[])].sort(
    (a, b) => a - b
  );
}

/** JST 暦日が店舗の定休日か（regular_holidays が空なら常に false） */
export function isYmdRegularHoliday(regularHolidays: number[], ymd: string): boolean {
  if (regularHolidays.length === 0) return false;
  return regularHolidays.includes(getWeekdayJst(ymd));
}

/**
 * [start, end] の JST 暦日のうち、定休日を除いた日数（未入力の分母）
 */
export function countNonRegularHolidayDaysJst(
  startYmd: string,
  endYmd: string,
  regularHolidays: number[]
): number {
  if (startYmd > endYmd) return 0;
  let n = 0;
  let d = startYmd;
  while (d <= endYmd) {
    if (!isYmdRegularHoliday(regularHolidays, d)) n++;
    d = addCalendarDaysJst(d, 1);
  }
  return n;
}

/**
 * 集計対象キャストごとの月間／週間レポート行を生成する。
 * - 各数値は scheduled_date <= todayYmd の行のみ反映（未来の予定は含めない）
 * - 同一日は DB 上 UNIQUE のため二重集計しない
 * - 未入力:
 *   - calendar_excluding_regular_holidays: 定休除外の暦日数 − 回答済み日数（welfare_b）
 *   - sent_confirmation_only: 出勤確認送信済みかつ未回答の件数（cabaret/bar）
 */
export function buildAdminReportCastRows(
  casts: AdminReportCastInput[],
  schedules: AdminReportScheduleRow[],
  opts: {
    todayYmd: string;
    periodStartYmd: string;
    periodEndYmd: string;
    /** stores.regular_holidays（0=日〜6=土）。未指定は [] */
    regularHolidays?: number[];
    /**
     * 未入力の分母定義:
     * - calendar_excluding_regular_holidays: 定休除外の暦日ベース（welfare_b）
     * - sent_confirmation_only: 出勤確認送信済み件数ベース（cabaret/bar）
     */
    unfilledCountMode?: UnfilledCountMode;
  }
): AdminReportCastRow[] {
  const { todayYmd, periodStartYmd, periodEndYmd } = opts;
  const regularHolidays = opts.regularHolidays ?? [];
  const unfilledCountMode = opts.unfilledCountMode ?? "calendar_excluding_regular_holidays";

  const windowEnd = unfilledWindowEndYmd(periodEndYmd, todayYmd);
  const unfilledRangeStart = periodStartYmd;
  const unfilledRangeEnd = windowEnd;
  const unfilledDenominatorDays =
    unfilledCountMode !== "calendar_excluding_regular_holidays" ||
    unfilledRangeStart > unfilledRangeEnd
      ? 0
      : countNonRegularHolidayDaysJst(unfilledRangeStart, unfilledRangeEnd, regularHolidays);

  const byCast = new Map<string, AdminReportScheduleRow[]>();
  for (const s of schedules) {
    const list = byCast.get(s.cast_id) ?? [];
    list.push(s);
    byCast.set(s.cast_id, list);
  }

  return casts.map((cast) => {
    const rows = byCast.get(cast.id) ?? [];

    let attendanceDays = 0;
    let dohanCount = 0;
    let sabakiCount = 0;
    const sabakiDates: string[] = [];
    let lateCount = 0;
    let absentCount = 0;
    let halfHolidayCount = 0;
    let publicHolidayCount = 0;
    const incidents: AdminReportIncident[] = [];
    const actionDetails: Array<{
      dateStr: string;
      attendanceLogId: string | null;
      plannedGroups: number | null;
      tentativeGroups: number | null;
      actionType: string | null;
      actionDetail: string | null;
    }> = [];

    const answeredDatesInWindow = new Set<string>();

    for (const row of rows) {
      const dateStr = row.scheduled_date;
      const recorded = scheduleRowHasRecordedAction(row);

      if (dateStr >= unfilledRangeStart && dateStr <= unfilledRangeEnd && recorded) {
        answeredDatesInWindow.add(dateStr);
      }

      if (dateStr > todayYmd) {
        continue;
      }

      // 今日以前でも未回答・未確定のみの行は実績に含めない（未来予定と同様に集計対象外）
      if (!recorded) {
        continue;
      }

      const off = rowIsOffDay(row);
      const late = rowIsLate(row);

      if (!off) attendanceDays += 1;
      if (row.is_dohan === true) dohanCount += 1;
      if (row.is_sabaki === true) {
        sabakiCount += 1;
        sabakiDates.push(dateStr);
      }
      if (late) lateCount += 1;

      if (row.response_status === "half_holiday") {
        halfHolidayCount += 1;
      } else if (row.response_status === "public_holiday") {
        publicHolidayCount += 1;
      } else if (rowIsAbsent(row)) {
        absentCount += 1;
      }

      if (late) {
        incidents.push({
          dateStr,
          kind: "late",
          reason: row.late_reason,
        });
      }
      if (
        row.response_status !== "half_holiday" &&
        row.response_status !== "public_holiday" &&
        rowIsAbsent(row)
      ) {
        incidents.push({
          dateStr,
          kind: "absent",
          reason: row.absent_reason,
        });
      }
      if (row.response_status === "half_holiday") {
        incidents.push({
          dateStr,
          kind: "half_holiday",
          reason: row.half_holiday_reason,
        });
      }
      if (row.response_status === "public_holiday") {
        incidents.push({
          dateStr,
          kind: "public_holiday",
          reason: row.public_holiday_reason,
        });
      }
      const tentative =
        typeof row.tentative_groups === "number" && !Number.isNaN(row.tentative_groups)
          ? row.tentative_groups
          : row.tentative_groups != null
            ? Number(row.tentative_groups)
            : 0;
      const tentativeSafe = Number.isFinite(tentative) ? tentative : 0;
      if (
        row.planned_groups != null ||
        tentativeSafe > 0 ||
        (row.action_type && row.action_type.trim() !== "") ||
        (row.action_detail && row.action_detail.trim() !== "")
      ) {
        actionDetails.push({
          dateStr,
          attendanceLogId: row.attendance_log_id ?? null,
          plannedGroups: row.planned_groups ?? null,
          tentativeGroups: tentativeSafe,
          actionType: row.action_type ?? null,
          actionDetail: row.action_detail ?? null,
        });
      }
    }

    incidents.sort((a, b) => a.dateStr.localeCompare(b.dateStr));
    sabakiDates.sort();

    let unfilledDays = 0;
    if (unfilledCountMode === "sent_confirmation_only") {
      for (const row of rows) {
        const dateStr = row.scheduled_date;
        if (dateStr < unfilledRangeStart || dateStr > unfilledRangeEnd) continue;
        if (!row.last_reminded_at) continue;
        if (scheduleRowHasRecordedAction(row)) continue;
        unfilledDays += 1;
      }
    } else {
      let answeredOnRequiredDays = 0;
      for (const d of answeredDatesInWindow) {
        if (!isYmdRegularHoliday(regularHolidays, d)) answeredOnRequiredDays += 1;
      }
      unfilledDays = Math.max(0, unfilledDenominatorDays - answeredOnRequiredDays);
    }

    return {
      castId: cast.id,
      name: cast.name,
      departedAt: cast.departed_at ?? null,
      departureReason: cast.departure_reason ?? null,
      attendanceDays,
      dohanCount,
      sabakiCount,
      sabakiDates,
      lateCount,
      absentCount,
      halfHolidayCount,
      publicHolidayCount,
      unfilledDays,
      incidents,
      actionDetails,
    };
  });
}
