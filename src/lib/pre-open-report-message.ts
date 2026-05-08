/**
 * 営業前サマリー用のプレーンテキスト組み立て（LINE 送信向け）
 * 風俗運用向けに「キャスト」「仲居」の2区分で出力する。
 */
type CastJoin =
  | { name?: string; display_name?: string | null; role?: "cast" | "nakai" | null }
  | Array<{ name?: string; display_name?: string | null; role?: "cast" | "nakai" | null }>
  | null;

export type PreOpenScheduleRow = {
  scheduled_time: string | null;
  scheduled_end_time?: string | null;
  is_dohan: boolean | null;
  is_sabaki?: boolean | null;
  response_status: string | null;
  late_reason: string | null;
  absent_reason: string | null;
  public_holiday_reason: string | null;
  half_holiday_reason: string | null;
  has_reservation: boolean | null;
  reservation_details: string | null;
  pending_line_flow: string | null;
  casts?: CastJoin;
};

function castName(row: PreOpenScheduleRow): string {
  const raw = row.casts;
  if (!raw) return "不明";
  const c = Array.isArray(raw) ? raw[0] : raw;
  return c?.display_name?.trim() || c?.name?.trim() || "不明";
}

function castRole(row: PreOpenScheduleRow): "cast" | "nakai" {
  const raw = row.casts;
  const c = Array.isArray(raw) ? raw[0] : raw;
  return c?.role === "nakai" ? "nakai" : "cast";
}

function minutesFromScheduledTime(time: string | null | undefined): number {
  if (!time) return Number.MAX_SAFE_INTEGER;
  const m = String(time).match(/^(\d{1,2}):(\d{2})/);
  if (!m) return Number.MAX_SAFE_INTEGER;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

function sortRows(rows: PreOpenScheduleRow[]): PreOpenScheduleRow[] {
  return [...rows].sort((a, b) => {
    const ma = minutesFromScheduledTime(a.scheduled_time);
    const mb = minutesFromScheduledTime(b.scheduled_time);
    if (ma !== mb) return ma - mb;
    return castName(a).localeCompare(castName(b), "ja");
  });
}

function sectionForRow(row: PreOpenScheduleRow): "attending" | "late" | "off" | "unanswered" {
  if (row.pending_line_flow) return "attending";
  const rs = row.response_status;
  if (rs === "attending") return "attending";
  if (rs === "late") return "late";
  if (rs === "absent" || rs === "half_holiday" || rs === "public_holiday") return "off";
  return "unanswered";
}

/** 出勤確定（予約ヒアリング中含む）または遅刻の人数。送信スキップ判定用 */
export function countPreOpenWorkingCasts(rows: PreOpenScheduleRow[]): number {
  let n = 0;
  for (const r of rows) {
    const s = sectionForRow(r);
    if (s === "attending" || s === "late") n++;
  }
  return n;
}

function formatHm(time: string | null | undefined): string {
  if (!time) return "";
  const m = String(time).match(/^(\d{1,2}):(\d{2})/);
  if (!m) return "";
  return `${m[1].padStart(2, "0")}:${m[2]}`;
}

function formatMemberShift(row: PreOpenScheduleRow): string {
  const name = castName(row);
  const start = formatHm(row.scheduled_time);
  const end = formatHm(row.scheduled_end_time);
  if (start && end) return `${name}${start}-${end}`;
  if (start) return `${name}${start}`;
  if (end) return `${name}-${end}`;
  return name;
}

/**
 * 店舗名・JST 日付・当日シフト行から営業前サマリー本文を生成する。
 */
export function buildPreOpenReportMessage(storeName: string, todayJst: string, rows: PreOpenScheduleRow[]): string {
  void storeName;
  void todayJst;
  const sorted = sortRows(rows);
  const working: PreOpenScheduleRow[] = [];

  for (const r of sorted) {
    const s = sectionForRow(r);
    if (s === "attending" || s === "late") working.push(r);
  }

  const castMembers = working.filter((r) => castRole(r) === "cast").map(formatMemberShift);
  const nakaiMembers = working.filter((r) => castRole(r) === "nakai").map(formatMemberShift);
  const sep = "　";

  return [
    "本日出勤",
    castMembers.length > 0 ? castMembers.join(sep) : "（なし）",
    "仲居",
    nakaiMembers.length > 0 ? nakaiMembers.join(sep) : "（なし）",
  ].join("\n");
}
