import type { SupabaseClient } from "@supabase/supabase-js";
import { logPostgrestError } from "@/lib/postgrest-error";

/** LINE テキストの上限に合わせた分割長（Cron・個別テスト共通） */
export const DAILY_BAR_SUMMARY_MAX_CHUNK_LEN = 4800;

export type DailyBarSummaryLogRow = {
  cast_id: string;
  status: string;
  planned_groups: number | null;
  tentative_groups: number | null;
  action_type: string | null;
  action_detail: string | null;
};

export type DailyBarSummaryScheduleRow = {
  cast_id: string;
  is_dohan: boolean | null;
  late_reason: string | null;
  absent_reason: string | null;
  public_holiday_reason: string | null;
  half_holiday_reason: string | null;
};

export function formatJaDateFromYmdForBarSummary(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  if (!y || !m || !d) return ymd;
  return `${y}年${m}月${d}日`;
}

function formatActionLine(actionDetail: string | null, actionType: string | null): string {
  const d = typeof actionDetail === "string" ? actionDetail.trim() : "";
  const t = typeof actionType === "string" ? actionType.trim() : "";
  if (d) return d;
  if (t) return t;
  return "—";
}

function statusTag(status: string): string {
  switch (status) {
    case "late":
      return "[遅刻]";
    case "absent":
      return "[欠勤]";
    case "public_holiday":
      return "[公休]";
    case "half_holiday":
      return "[半休]";
    default:
      return "[その他]";
  }
}

function reasonForStatus(s: DailyBarSummaryScheduleRow | undefined, status: string): string {
  if (!s) return "";
  switch (status) {
    case "late":
      return String(s.late_reason ?? "").trim();
    case "absent":
      return String(s.absent_reason ?? "").trim();
    case "public_holiday":
      return String(s.public_holiday_reason ?? "").trim();
    case "half_holiday":
      return String(s.half_holiday_reason ?? "").trim();
    default:
      return "";
  }
}

function formatCastSectionLine(params: {
  headerTag: string;
  castName: string;
  planned: number | null;
  tentative: number | null;
  actionDetail: string | null;
  actionType: string | null;
  reasonSuffix?: string;
}): string {
  const fixed = typeof params.planned === "number" ? params.planned : 0;
  const tent = typeof params.tentative === "number" ? params.tentative : 0;
  const name = params.castName.trim() || "（名前なし）";
  const head =
    params.reasonSuffix && params.reasonSuffix.trim().length > 0
      ? `${params.headerTag} ${name} (理由: ${params.reasonSuffix.trim()})`
      : `${params.headerTag} ${name}`;
  return [
    head,
    `組数: 確定 ${fixed}組 / 仮 ${tent}組`,
    `行動: ${formatActionLine(params.actionDetail, params.actionType)}`,
  ].join("\n");
}

/**
 * 営業前サマリー本文をチャンク配列に分割（長文時は複数メッセージ）
 */
export function chunkDailyBarSummaryBody(
  body: string,
  maxLen: number = DAILY_BAR_SUMMARY_MAX_CHUNK_LEN
): string[] {
  const trimmed = body.trimEnd();
  if (trimmed.length <= maxLen) {
    return [trimmed];
  }
  const chunks: string[] = [];
  let rest = trimmed;
  let part = 1;
  while (rest.length > 0) {
    const head = rest.slice(0, maxLen);
    chunks.push(part === 1 ? head : `（続き ${part}）\n${head}`);
    rest = rest.slice(maxLen);
    part += 1;
  }
  return chunks;
}

export type DailyBarSummaryBuildInput = {
  dateYmd: string;
  logs: DailyBarSummaryLogRow[];
  nameByCastId: Map<string, string>;
  scheduleByCast: Map<string, DailyBarSummaryScheduleRow>;
};

/**
 * attendance_logs + シフト情報から営業前サマリー（日報）テキストを組み立てる（純関数）
 */
export function buildDailyBarSummaryBody(input: DailyBarSummaryBuildInput): string {
  const { dateYmd, logs, nameByCastId, scheduleByCast } = input;
  const dateJa = formatJaDateFromYmdForBarSummary(dateYmd);

  const attending = logs.filter((l) => String(l.status ?? "") === "attending");
  const others = logs.filter((l) => String(l.status ?? "") !== "attending");

  const sortLogs = (arr: DailyBarSummaryLogRow[]) =>
    [...arr].sort((a, b) => {
      const na = nameByCastId.get(a.cast_id) ?? a.cast_id;
      const nb = nameByCastId.get(b.cast_id) ?? b.cast_id;
      return na.localeCompare(nb, "ja");
    });

  const lines: string[] = [
    "【営業前サマリー（日報）】",
    `📅 ${dateJa}`,
    "",
    "■ 出勤・同伴キャスト",
  ];

  const attSorted = sortLogs(attending);
  if (attSorted.length === 0) {
    lines.push("（該当なし）", "");
  } else {
    for (const row of attSorted) {
      const sched = scheduleByCast.get(row.cast_id);
      const isDohan = sched?.is_dohan === true;
      const tag = isDohan ? "[同伴]" : "[出勤]";
      const castName = nameByCastId.get(row.cast_id) ?? "（名前なし）";
      lines.push(
        "",
        formatCastSectionLine({
          headerTag: tag,
          castName,
          planned: row.planned_groups,
          tentative: row.tentative_groups,
          actionDetail: row.action_detail,
          actionType: row.action_type,
        })
      );
    }
    lines.push("");
  }

  lines.push("■ 遅刻・欠勤・その他");
  const othSorted = sortLogs(others);
  if (othSorted.length === 0) {
    lines.push("（該当なし）");
  } else {
    for (const row of othSorted) {
      const st = String(row.status ?? "");
      const tag = statusTag(st);
      const castName = nameByCastId.get(row.cast_id) ?? "（名前なし）";
      const sched = scheduleByCast.get(row.cast_id);
      const reasonText = reasonForStatus(sched, st);
      lines.push(
        "",
        formatCastSectionLine({
          headerTag: tag,
          castName,
          planned: row.planned_groups,
          tentative: row.tentative_groups,
          actionDetail: row.action_detail,
          actionType: row.action_type,
          reasonSuffix: reasonText || undefined,
        })
      );
    }
  }

  return lines.join("\n").trimEnd();
}

export type GenerateDailyBarSummaryResult =
  | { ok: true; body: string; chunks: string[] }
  | { ok: false; error: string };

/**
 * 指定店舗・日付の attendance_logs を読み、営業前サマリー本文と送信用チャンクを生成する。
 * Cron `/api/cron/daily-bar-summary` と管理画面の個別テスト送信で共通利用。
 */
export async function generateDailyBarSummaryForStore(
  admin: SupabaseClient,
  storeId: string,
  dateYmd: string
): Promise<GenerateDailyBarSummaryResult> {
  const { data: logsRaw, error: logsErr } = await admin
    .from("attendance_logs")
    .select("cast_id, status, planned_groups, tentative_groups, action_type, action_detail")
    .eq("store_id", storeId)
    .eq("attended_date", dateYmd);

  if (logsErr) {
    logPostgrestError("daily-bar-summary attendance_logs", logsErr);
    return { ok: false, error: logsErr.message };
  }

  const logs = (logsRaw ?? []) as DailyBarSummaryLogRow[];
  const castIds = [...new Set(logs.map((l) => l.cast_id).filter(Boolean))];

  const nameByCastId = new Map<string, string>();
  if (castIds.length > 0) {
    const { data: casts, error: castErr } = await admin
      .from("casts")
      .select("id, name")
      .eq("store_id", storeId)
      .in("id", castIds);
    if (castErr) {
      logPostgrestError("daily-bar-summary casts", castErr);
      return { ok: false, error: castErr.message };
    }
    for (const c of casts ?? []) {
      const row = c as { id?: string; name?: string | null };
      if (row.id) nameByCastId.set(row.id, String(row.name ?? "").trim() || "（名前なし）");
    }
  }

  const { data: schedRaw, error: schedErr } = await admin
    .from("attendance_schedules")
    .select("cast_id, is_dohan, late_reason, absent_reason, public_holiday_reason, half_holiday_reason")
    .eq("store_id", storeId)
    .eq("scheduled_date", dateYmd);

  if (schedErr) {
    logPostgrestError("daily-bar-summary attendance_schedules", schedErr);
    return { ok: false, error: schedErr.message };
  }

  const scheduleByCast = new Map<string, DailyBarSummaryScheduleRow>();
  for (const s of schedRaw ?? []) {
    const row = s as DailyBarSummaryScheduleRow;
    if (row.cast_id) scheduleByCast.set(row.cast_id, row);
  }

  const body = buildDailyBarSummaryBody({
    dateYmd,
    logs,
    nameByCastId,
    scheduleByCast,
  });

  return {
    ok: true,
    body,
    chunks: chunkDailyBarSummaryBody(body),
  };
}
