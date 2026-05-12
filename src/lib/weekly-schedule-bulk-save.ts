import {
  mergeScheduleRowForWeeklyUpsert,
  scheduleRowHasLineAttendanceData,
} from "@/lib/attendance-schedule-preserve";
import { normalizeScheduledEndTimeForDb } from "@/lib/date-utils";

export type WeeklyShiftMatrix = Record<string, Record<string, string>>;
export type WeeklyBoolMatrix = Record<string, Record<string, boolean>>;

/** 週間一括保存用: 既存行とマージした upsert ペイロードを組み立てる（API / 将来の再利用） */
export function buildWeeklyScheduleUpsertRows(opts: {
  storeId: string;
  castIds: string[];
  dates: string[];
  matrix: WeeklyShiftMatrix;
  endMatrix: WeeklyShiftMatrix;
  dohan: WeeklyBoolMatrix;
  sabaki: WeeklyBoolMatrix;
  existingRows: Record<string, unknown>[];
}): Record<string, unknown>[] {
  const prevByKey = new Map<string, Record<string, unknown>>();
  for (const r of opts.existingRows) {
    const cid = String(r.cast_id ?? "");
    const d = String(r.scheduled_date ?? "");
    if (cid && d) prevByKey.set(`${cid}_${d}`, r);
  }

  const toUpsert: Record<string, unknown>[] = [];
  for (const castId of opts.castIds) {
    for (const dateStr of opts.dates) {
      const time = opts.matrix[castId]?.[dateStr]?.trim();
      if (!time) continue;
      const key = `${castId}_${dateStr}`;
      const prev = prevByKey.get(key);
      const endHm = (opts.endMatrix[castId]?.[dateStr] ?? "").trim();
      const scheduledEndDb = endHm ? normalizeScheduledEndTimeForDb(endHm) : null;
      const merged = mergeScheduleRowForWeeklyUpsert(
        {
          store_id: opts.storeId,
          cast_id: castId,
          scheduled_date: dateStr,
          scheduled_time: time.length === 5 ? `${time}:00` : time,
          scheduled_end_time: scheduledEndDb,
          is_dohan: opts.dohan[castId]?.[dateStr] ?? false,
          is_sabaki: opts.sabaki[castId]?.[dateStr] ?? false,
        },
        prev
      );
      toUpsert.push(merged);
    }
  }
  return toUpsert;
}
