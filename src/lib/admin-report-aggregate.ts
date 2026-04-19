import { addCalendarDaysJst } from "@/lib/date-utils";

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
  response_status:
    | "attending"
    | "absent"
    | "late"
    | "public_holiday"
    | "half_holiday"
    | null;
  is_action_completed?: boolean | null;
};

export type AdminReportIncident = {
  dateStr: string;
  kind: "late" | "absent" | "public_holiday" | "half_holiday";
  reason: string | null;
};

export type AdminReportCastRow = {
  castId: string;
  name: string;
  attendanceDays: number;
  dohanCount: number;
  sabakiCount: number;
  sabakiDates: string[];
  lateCount: number;
  absentCount: number;
  halfHolidayCount: number;
  publicHolidayCount: number;
  /** 月初〜min(期末, 今日) の範囲で、回答済み日を除いた日数 */
  unfilledDays: number;
  incidents: AdminReportIncident[];
};

export type AdminReportCastInput = {
  id: string;
  name: string;
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

function countInclusiveCalendarDaysJst(startYmd: string, endYmd: string): number {
  if (startYmd > endYmd) return 0;
  let n = 0;
  let d = startYmd;
  while (d <= endYmd) {
    n++;
    d = addCalendarDaysJst(d, 1);
  }
  return n;
}

/**
 * 未入力集計の対象期間の終端（JST 暦日）。
 * 「今日までの未入力」: 集計終了日と今日のうち早い方まで。
 */
export function unfilledWindowEndYmd(periodEndYmd: string, todayYmd: string): string {
  return periodEndYmd < todayYmd ? periodEndYmd : todayYmd;
}

/**
 * 集計対象キャストごとの月間／週間レポート行を生成する。
 * - 各数値は scheduled_date <= todayYmd の行のみ反映（未来の予定は含めない）
 * - 同一日は DB 上 UNIQUE のため二重集計しない
 * - 未入力: [期間開始, min(期間終了, 今日)] の暦日数 − 回答済み日数（distinct）
 */
export function buildAdminReportCastRows(
  casts: AdminReportCastInput[],
  schedules: AdminReportScheduleRow[],
  opts: { todayYmd: string; periodStartYmd: string; periodEndYmd: string }
): AdminReportCastRow[] {
  const { todayYmd, periodStartYmd, periodEndYmd } = opts;

  const windowEnd = unfilledWindowEndYmd(periodEndYmd, todayYmd);
  const unfilledRangeStart = periodStartYmd;
  const unfilledRangeEnd = windowEnd;
  const unfilledWindowDayCount =
    unfilledRangeStart > unfilledRangeEnd
      ? 0
      : countInclusiveCalendarDaysJst(unfilledRangeStart, unfilledRangeEnd);

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
    }

    incidents.sort((a, b) => a.dateStr.localeCompare(b.dateStr));
    sabakiDates.sort();

    const unfilledDays = Math.max(0, unfilledWindowDayCount - answeredDatesInWindow.size);

    return {
      castId: cast.id,
      name: cast.name,
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
    };
  });
}
