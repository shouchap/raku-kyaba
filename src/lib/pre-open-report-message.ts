/**
 * 営業前サマリー用のプレーンテキスト組み立て（LINE 送信向け）
 */
import { formatRemindScheduledTime } from "@/lib/attendance-remind-flex";

const RULE = "────────────────";

type CastJoin = { name?: string } | { name?: string }[] | null;

export type PreOpenScheduleRow = {
  scheduled_time: string | null;
  is_dohan: boolean | null;
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
  return c?.name?.trim() || "不明";
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

function offKindOrder(rs: string | null): number {
  if (rs === "absent") return 0;
  if (rs === "public_holiday") return 1;
  if (rs === "half_holiday") return 2;
  return 99;
}

function sortOffRows(rows: PreOpenScheduleRow[]): PreOpenScheduleRow[] {
  return [...rows].sort((a, b) => {
    const oa = offKindOrder(a.response_status);
    const ob = offKindOrder(b.response_status);
    if (oa !== ob) return oa - ob;
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
  if (rs === "absent" || rs === "public_holiday" || rs === "half_holiday") return "off";
  return "unanswered";
}

function reservationSuffix(row: PreOpenScheduleRow): string {
  if (row.pending_line_flow === "reservation_ask") return " ｜ 予約: 回答待ち";
  if (row.pending_line_flow === "reservation_detail") return " ｜ 予約: 詳細入力待ち";
  if (row.pending_line_flow) return " ｜ 予約: 確認中";
  if (row.has_reservation === true) {
    const d = (row.reservation_details ?? "").trim();
    return d ? ` ｜ 予約: ${d}` : " ｜ 予約: （詳細あり）";
  }
  if (row.has_reservation === false) return " ｜ 予約なし";
  return "";
}

function lineAttending(row: PreOpenScheduleRow): string {
  const name = castName(row);
  const time = formatRemindScheduledTime(row.scheduled_time, row.is_dohan);
  return `  • ${name}  (${time})${reservationSuffix(row)}`;
}

function lineLate(row: PreOpenScheduleRow): string {
  const name = castName(row);
  const time = formatRemindScheduledTime(row.scheduled_time, row.is_dohan);
  const reason = (row.late_reason ?? "").trim();
  return reason
    ? `  • ${name}  (${time})\n      理由: ${reason}`
    : `  • ${name}  (${time})`;
}

function lineOff(row: PreOpenScheduleRow): string {
  const name = castName(row);
  const rs = row.response_status;
  if (rs === "absent") {
    const r = (row.absent_reason ?? "").trim();
    return `  • ${name}  欠勤${r ? ` — ${r}` : ""}`;
  }
  if (rs === "public_holiday") {
    const r = (row.public_holiday_reason ?? "").trim();
    return `  • ${name}  公休${r ? ` — ${r}` : ""}`;
  }
  if (rs === "half_holiday") {
    const r = (row.half_holiday_reason ?? "").trim();
    return `  • ${name}  半休${r ? ` — ${r}` : ""}`;
  }
  return `  • ${name}`;
}

function lineUnanswered(row: PreOpenScheduleRow): string {
  const name = castName(row);
  const time = formatRemindScheduledTime(row.scheduled_time, row.is_dohan);
  return `  • ${name}  (${time})`;
}

/**
 * 店舗名・JST 日付・当日シフト行から営業前サマリー本文を生成する。
 */
export function buildPreOpenReportMessage(storeName: string, todayJst: string, rows: PreOpenScheduleRow[]): string {
  const sorted = sortRows(rows);
  const attending: PreOpenScheduleRow[] = [];
  const late: PreOpenScheduleRow[] = [];
  const off: PreOpenScheduleRow[] = [];
  const unanswered: PreOpenScheduleRow[] = [];

  for (const r of sorted) {
    const s = sectionForRow(r);
    if (s === "attending") attending.push(r);
    else if (s === "late") late.push(r);
    else if (s === "off") off.push(r);
    else unanswered.push(r);
  }

  const offSorted = sortOffRows(off);

  const out: string[] = [];
  out.push(`【本日の営業前サマリー（${storeName}）】`);
  out.push(`対象日: ${todayJst}（JST）`);
  out.push("");
  out.push("✅ 出勤予定");
  out.push(RULE);
  out.push(attending.length ? attending.map(lineAttending).join("\n\n") : "  （該当なし）");
  out.push("");
  out.push("⚠️ 遅刻");
  out.push(RULE);
  out.push(late.length ? late.map(lineLate).join("\n\n") : "  （該当なし）");
  out.push("");
  out.push("❌ お休み（欠勤・公休・半休）");
  out.push(RULE);
  out.push(offSorted.length ? offSorted.map(lineOff).join("\n\n") : "  （該当なし）");

  if (unanswered.length > 0) {
    out.push("");
    out.push("❓ 未回答（出勤確認が未完了）");
    out.push(RULE);
    out.push(unanswered.map(lineUnanswered).join("\n\n"));
  }

  return out.join("\n");
}
