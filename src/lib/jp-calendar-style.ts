import { getWeekdayJst } from "@/lib/date-utils";

export type DayStyle = "weekday" | "saturday" | "sunday" | "holiday";

/**
 * 日付表示用: 土曜は青、日曜・祝日は赤、それ以外はデフォルト。
 *
 * 祝日判定は `japanese-holidays`（数十KB）が必要なため、このモジュールでは
 * 読み込まず呼び出し側から結果を渡す。クライアントバンドルに載せないための分離。
 * 判定モジュールは `@/lib/jp-holidays`。
 */
export function getDayStyleForYmd(ymd: string, isHoliday = false): DayStyle {
  if (isHoliday) return "holiday";
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
