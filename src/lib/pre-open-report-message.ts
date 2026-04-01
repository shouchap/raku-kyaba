/**
 * 営業前サマリー用のプレーンテキスト組み立て（LINE 送信向け）
 */
import { formatScheduleTimeLabel } from "@/lib/attendance-remind-flex";
import {
  RULE_THICK,
  formatReasonSubLines,
  formatReservationSubLines,
} from "@/lib/pre-open-report-utils";

type CastJoin = { name?: string } | { name?: string }[] | null;

export type PreOpenScheduleRow = {
  scheduled_time: string | null;
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
  if (rs === "half_holiday") return 1;
  if (rs === "public_holiday") return 2;
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

function blockAttending(row: PreOpenScheduleRow): string {
  const name = castName(row);
  const time = formatScheduleTimeLabel(row.scheduled_time, row.is_dohan, row.is_sabaki);
  const head = `${name} (${time})`;
  const subs = formatReservationSubLines(row);
  if (subs.length === 0) return head;
  return [head, ...subs].join("\n");
}

function blockLate(row: PreOpenScheduleRow): string {
  const name = castName(row);
  const time = formatScheduleTimeLabel(row.scheduled_time, row.is_dohan, row.is_sabaki);
  const head = `${name} (${time})`;
  const reason = (row.late_reason ?? "").trim();
  if (!reason) {
    return `${head}\n遅刻`;
  }
  return [head, ...formatReasonSubLines("遅刻", reason)].join("\n");
}

function blockOff(row: PreOpenScheduleRow): string {
  const name = castName(row);
  const head = name;
  const rs = row.response_status;
  if (rs === "absent") {
    const r = (row.absent_reason ?? "").trim();
    if (r) return [head, ...formatReasonSubLines("欠勤", r)].join("\n");
    return `${head}\n欠勤`;
  }
  if (rs === "half_holiday") {
    const r = (row.half_holiday_reason ?? "").trim();
    if (r) return [head, ...formatReasonSubLines("半休", r)].join("\n");
    return `${head}\n半休`;
  }
  if (rs === "public_holiday") {
    const r = (row.public_holiday_reason ?? "").trim();
    if (r) return [head, ...formatReasonSubLines("公休", r)].join("\n");
    return `${head}\n公休`;
  }
  return head;
}

function blockUnanswered(row: PreOpenScheduleRow): string {
  const name = castName(row);
  const time = formatScheduleTimeLabel(row.scheduled_time, row.is_dohan, row.is_sabaki);
  return `${name} (${time})`;
}

function sectionBlock(title: string, subtitle: string | null, body: string): string[] {
  const lines: string[] = [];
  lines.push(`【${title}】`);
  if (subtitle) lines.push(subtitle);
  lines.push(RULE_THICK);
  lines.push("");
  lines.push(body);
  return lines;
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

  out.push("【本日の営業前サマリー】");
  out.push(storeName.trim() || "店舗");
  out.push(`${todayJst} (JST)`);
  out.push("");
  out.push(RULE_THICK);
  out.push("");

  const attendingBody = attending.length ? attending.map(blockAttending).join("\n\n") : "（なし）";
  out.push(...sectionBlock("出勤予定", null, attendingBody));
  out.push("");
  out.push("");

  const lateBody = late.length ? late.map(blockLate).join("\n\n") : "（なし）";
  out.push(...sectionBlock("遅刻", null, lateBody));
  out.push("");
  out.push("");

  const offBody = offSorted.length ? offSorted.map(blockOff).join("\n\n") : "（なし）";
  out.push(...sectionBlock("お休み", "欠勤・半休・公休", offBody));
  out.push("");
  out.push("");

  const unansweredBody = unanswered.length ? unanswered.map(blockUnanswered).join("\n\n") : "（なし）";
  out.push(...sectionBlock("未回答", "出勤確認が未完了の方", unansweredBody));

  return out.join("\n");
}
