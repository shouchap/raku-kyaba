import JapaneseHolidays from "japanese-holidays";
import { getWeekdayJst } from "@/lib/date-utils";

export type DayStyle = "weekday" | "saturday" | "sunday" | "holiday";

/**
 * 日本の祝日（振替休日を含む）かどうか。ymd は JST の暦日。
 */
export function isJapanesePublicHolidayYmd(ymd: string): boolean {
  const d = new Date(`${ymd}T12:00:00+09:00`);
  return Boolean(JapaneseHolidays.isHolidayAt(d, true));
}

/** 日付表示用: 土曜は青、日曜・祝日は赤、それ以外はデフォルト */
export function getDayStyleForYmd(ymd: string): DayStyle {
  if (isJapanesePublicHolidayYmd(ymd)) return "holiday";
  const w = getWeekdayJst(ymd);
  if (w === 0) return "sunday";
  if (w === 6) return "saturday";
  return "weekday";
}

export const DAY_STYLE_TEXT_CLASS: Record<DayStyle, string> = {
  weekday: "text-slate-900",
  saturday: "text-blue-600 font-semibold",
  sunday: "text-red-600 font-semibold",
  holiday: "text-red-600 font-semibold",
};
