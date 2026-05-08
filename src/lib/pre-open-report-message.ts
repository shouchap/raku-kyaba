/**
 * 営業前サマリー用のプレーンテキスト組み立て（LINE 送信向け）
 * - 通常業態: 共通テンプレート（合計予定組数・遅刻・お休み・未回答など）
 * - 風俗（fuzoku）: シフト時刻ベースの簡易フォーマットのみ
 */
import { formatScheduleTimeLabel } from "@/lib/attendance-remind-flex";
import {
  RULE_THICK,
  formatReasonSubLines,
  formatReservationSubLines,
} from "@/lib/pre-open-report-utils";
import { extractDeclaredGroupCountFromReservationDetails } from "@/lib/reservation-progress";

type CastJoin =
  | { name?: string; display_name?: string | null; role?: "cast" | "nakai" | null }
  | Array<{ name?: string; display_name?: string | null; role?: "cast" | "nakai" | null }>
  | null;

export type PreOpenScheduleRow = {
  cast_id?: string | null;
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
  return c?.name?.trim() || "不明";
}

/** 一覧・出勤ブロック用（表示名があれば優先） */
function castDisplayName(row: PreOpenScheduleRow): string {
  const raw = row.casts;
  if (!raw) return "不明";
  const c = Array.isArray(raw) ? raw[0] : raw;
  return c?.display_name?.trim() || c?.name?.trim() || "不明";
}

function castRoleIsNakai(row: PreOpenScheduleRow): boolean {
  const raw = row.casts;
  const c = Array.isArray(raw) ? raw[0] : raw;
  return c?.role === "nakai";
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

/** 出勤確定（予約ヒアリング中含む）または遅刻の人数。送信スキップ判定用（通常業態） */
export function countPreOpenWorkingCasts(rows: PreOpenScheduleRow[]): number {
  let n = 0;
  for (const r of rows) {
    const s = sectionForRow(r);
    if (s === "attending" || s === "late") n++;
  }
  return n;
}

/**
 * 営業前サマリー送信スキップ判定用の人数。
 * - fuzoku: 対象日の attendance_schedules 行について、`response_status` は無視し `cast_id` のユニーク人数（未取得時は行数）
 * - それ以外: {@link countPreOpenWorkingCasts}
 */
export function countPreOpenWorkingCastsByBusinessType(
  businessType: string | null | undefined,
  rows: PreOpenScheduleRow[]
): number {
  if (businessType !== "fuzoku") {
    return countPreOpenWorkingCasts(rows);
  }
  const ids = new Set<string>();
  for (const row of rows) {
    const cid = row.cast_id?.trim();
    if (cid) ids.add(cid);
  }
  if (ids.size > 0) return ids.size;
  return rows.length;
}

/**
 * 【出勤予定】に載る行のみ、申告済み reservation_details から予定組数を合算。
 */
export function sumDeclaredReservationGroupsForAttending(rows: PreOpenScheduleRow[]): number {
  let sum = 0;
  for (const r of rows) {
    if (sectionForRow(r) !== "attending") continue;
    sum += extractDeclaredGroupCountFromReservationDetails(r.reservation_details);
  }
  return sum;
}

/**
 * 出勤確定キャストのうち、同伴シフトは合計予定組数に 1 組として加算する。
 *（`is_dohan` または表示ラベルに「同伴」が含まれる場合）
 */
export function countCompanionGroupBonusForAttending(rows: PreOpenScheduleRow[]): number {
  let n = 0;
  for (const r of rows) {
    if (sectionForRow(r) !== "attending") continue;
    const label = formatScheduleTimeLabel(r.scheduled_time, r.is_dohan, r.is_sabaki);
    if (r.is_dohan === true || label.includes("同伴")) n++;
  }
  return n;
}

function formatHm(time: string | null | undefined): string {
  if (!time) return "";
  const m = String(time).match(/^(\d{1,2}):(\d{2})/);
  if (!m) return "";
  return `${m[1].padStart(2, "0")}:${m[2]}`;
}

/** 風俗向け: 単一行の短い罫線（RULE_THICK は使わない） */
const FUZOKU_RULE_LINE = "━━━━━━━━━━━━━━━";

function rowHasFuzokuShiftTime(row: PreOpenScheduleRow): boolean {
  return formatHm(row.scheduled_time) !== "" || formatHm(row.scheduled_end_time) !== "";
}

/** 開始が無い行は終了時刻で並べ替えキーにフォールバック */
function sortFuzokuShiftRows(rows: PreOpenScheduleRow[]): PreOpenScheduleRow[] {
  const key = (row: PreOpenScheduleRow): number => {
    const sm = minutesFromScheduledTime(row.scheduled_time);
    if (sm !== Number.MAX_SAFE_INTEGER) return sm;
    const em = minutesFromScheduledTime(row.scheduled_end_time);
    if (em !== Number.MAX_SAFE_INTEGER) return em;
    return Number.MAX_SAFE_INTEGER;
  };
  return [...rows].sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    if (ka !== kb) return ka - kb;
    return castDisplayName(a).localeCompare(castDisplayName(b), "ja");
  });
}

/** LINE OS の時間リンク誤検知回避（風俗フォーマットのみ） */
function fuzokuTimeForDisplay(hmFromFormatHm: string): string {
  return hmFromFormatHm.replace(/:/g, "：");
}

/** `scheduled_time` / `scheduled_end_time` のみで括弧内を組み立て（同伴・捌きは含めない） */
function fuzokuShiftParen(row: PreOpenScheduleRow): string {
  const start = formatHm(row.scheduled_time);
  const end = formatHm(row.scheduled_end_time);
  const sd = start ? fuzokuTimeForDisplay(start) : "";
  const ed = end ? fuzokuTimeForDisplay(end) : "";
  if (sd && ed) return `(${sd} 〜 ${ed})`;
  if (sd) return `(${sd})`;
  return `(${ed})`;
}

function fuzokuShiftLine(row: PreOpenScheduleRow): string {
  return `${castDisplayName(row)} ${fuzokuShiftParen(row)}`;
}

/**
 * 風俗業態向け・営業前サマリー（仕様どおりの固定レイアウト）
 */
export function buildFuzokuPreOpenReportMessage(
  storeName: string,
  todayJst: string,
  rows: PreOpenScheduleRow[]
): string {
  const working = sortFuzokuShiftRows(rows.filter(rowHasFuzokuShiftTime));
  const nakaiRows = working.filter((r) => castRoleIsNakai(r));
  const castRows = working.filter((r) => !castRoleIsNakai(r));

  const parts: string[] = [];
  parts.push("【本日の営業前サマリー】");
  parts.push(`🏢 ${storeName.trim() || "店舗"}`);
  parts.push(`📅 ${todayJst} (JST)`);
  parts.push(FUZOKU_RULE_LINE);
  parts.push("");
  parts.push("【出勤予定】");

  if (nakaiRows.length > 0) {
    parts.push("【仲居】");
    nakaiRows.forEach((r) => parts.push(fuzokuShiftLine(r)));
  }

  if (castRows.length > 0) {
    parts.push("");
    parts.push("【キャスト】");
    castRows.forEach((r) => parts.push(fuzokuShiftLine(r)));
  }

  return parts.join("\n");
}

/** 開始ラベル（同伴・捌き含む）に、終了時刻があれば ` - HH:mm` を連結 */
function formatShiftTimeParen(row: PreOpenScheduleRow): string {
  const startLabel = formatScheduleTimeLabel(row.scheduled_time, row.is_dohan, row.is_sabaki);
  const endHm = formatHm(row.scheduled_end_time);
  if (endHm) return `${startLabel} - ${endHm}`;
  return startLabel;
}

function blockAttending(row: PreOpenScheduleRow): string {
  const name = castDisplayName(row);
  const time = formatShiftTimeParen(row);
  const head = `${name} (${time})`;
  const subs = formatReservationSubLines(row);
  if (subs.length === 0) return head;
  return [head, ...subs].join("\n");
}

function blockLate(row: PreOpenScheduleRow): string {
  const name = castDisplayName(row);
  const time = formatShiftTimeParen(row);
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
  const name = castDisplayName(row);
  const time = formatShiftTimeParen(row);
  return `${name} (${time})`;
}

function sectionBlock(title: string, subtitle: string | null, body: string): string[] {
  const lines: string[] = [];
  lines.push(`【${title}】`);
  if (subtitle) lines.push(subtitle);
  lines.push(RULE_THICK);
  lines.push(RULE_THICK);
  lines.push("");
  lines.push(body);
  return lines;
}

function pushSummaryHeader(out: string[], storeName: string, todayJst: string, totalReservationGroups: number): void {
  out.push("【本日の営業前サマリー】");
  out.push(`🏢 ${storeName.trim() || "店舗"}`);
  out.push(`📅 ${todayJst} (JST)`);
  out.push(RULE_THICK);
  out.push(RULE_THICK);
  out.push(`本日の合計予定組数：${totalReservationGroups}組`);
  out.push(RULE_THICK);
  out.push(RULE_THICK);
  out.push("");
}

function buildUnifiedPreOpenReportMessage(storeName: string, todayJst: string, rows: PreOpenScheduleRow[]): string {
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

  const attendingCast = attending.filter((r) => !castRoleIsNakai(r));
  const attendingNakai = attending.filter((r) => castRoleIsNakai(r));

  const offSorted = sortOffRows(off);
  const totalReservationGroups =
    sumDeclaredReservationGroupsForAttending(attending) +
    countCompanionGroupBonusForAttending(attending);

  const out: string[] = [];
  pushSummaryHeader(out, storeName, todayJst, totalReservationGroups);

  const attendingBody = attendingCast.length ? attendingCast.map(blockAttending).join("\n\n") : "（なし）";
  out.push(...sectionBlock("出勤予定", null, attendingBody));

  if (attendingNakai.length > 0) {
    out.push("");
    out.push("");
    const nakaiBody = attendingNakai.map(blockAttending).join("\n\n");
    out.push(...sectionBlock("仲居", null, nakaiBody));
  }

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

/**
 * 店舗名・JST 日付・当日シフト行から営業前サマリー本文を生成する。
 */
export function buildPreOpenReportMessage(storeName: string, todayJst: string, rows: PreOpenScheduleRow[]): string {
  return buildUnifiedPreOpenReportMessage(storeName, todayJst, rows);
}

/** API から渡される `stores.business_type` でフォーマットを切り替え */
export function buildPreOpenReportMessageByBusinessType(
  businessType: string | null | undefined,
  storeName: string,
  todayJst: string,
  rows: PreOpenScheduleRow[]
): string {
  if (businessType === "fuzoku") {
    return buildFuzokuPreOpenReportMessage(storeName, todayJst, rows);
  }
  return buildUnifiedPreOpenReportMessage(storeName, todayJst, rows);
}
