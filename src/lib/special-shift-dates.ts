import { addCalendarDaysJst } from "@/lib/date-utils";

/** start_date 〜 end_date（JST 暦日、両端含む）の YYYY-MM-DD 列 */
export function enumerateInclusiveYmd(start: string, end: string): string[] {
  const out: string[] = [];
  let cur = start;
  for (let guard = 0; guard < 500; guard++) {
    out.push(cur);
    if (cur === end) break;
    cur = addCalendarDaysJst(cur, 1);
  }
  return out;
}
