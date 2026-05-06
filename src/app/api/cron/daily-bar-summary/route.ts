import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceRoleClient } from "@/lib/supabase-service";
import { getTodayJst } from "@/lib/date-utils";
import { sendMulticastMessage } from "@/lib/line-reply";
import { fetchResolvedLineChannelAccessTokenForStore } from "@/lib/line-channel-token";
import { isUndefinedColumnError, logPostgrestError } from "@/lib/postgrest-error";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type StoreRow = { id: string; name: string | null; attendance_flow_type?: string | null };

type LogRow = {
  cast_id: string;
  status: string;
  planned_groups: number | null;
  tentative_groups: number | null;
  action_type: string | null;
  action_detail: string | null;
};

type ScheduleRow = {
  cast_id: string;
  is_dohan: boolean | null;
  late_reason: string | null;
  absent_reason: string | null;
  public_holiday_reason: string | null;
  half_holiday_reason: string | null;
};

function formatJaDateFromYmd(ymd: string): string {
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

function reasonForStatus(s: ScheduleRow | undefined, status: string): string {
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

async function fetchAdminLineUserIds(supabase: SupabaseClient, storeId: string): Promise<string[]> {
  const { data: adminCasts } = await supabase
    .from("casts")
    .select("line_user_id")
    .eq("store_id", storeId)
    .eq("is_admin", true)
    .eq("is_active", true)
    .not("line_user_id", "is", null);

  const fromCasts = (adminCasts ?? [])
    .map((r: { line_user_id?: string }) => r.line_user_id)
    .filter((id): id is string => !!id && id.trim() !== "");

  if (fromCasts.length > 0) return fromCasts;

  const { data: store } = await supabase.from("stores").select("admin_line_user_id").eq("id", storeId).single();

  const legacyId = (store as { admin_line_user_id?: string | null } | null)?.admin_line_user_id;
  if (legacyId && String(legacyId).trim() !== "") return [legacyId];

  return [];
}

async function runDailyBarSummary(): Promise<{
  dateYmd: string;
  results: Array<{ storeId: string; name: string | null; sent: boolean; skipped?: string; error?: string }>;
}> {
  const dateYmd = getTodayJst();
  const dateJa = formatJaDateFromYmd(dateYmd);
  const admin = createServiceRoleClient();

  let stores: StoreRow[] = [];
  const storeRes = await admin
    .from("stores")
    .select("id, name, attendance_flow_type")
    .eq("attendance_flow_type", "bar_extended");

  if (storeRes.error) {
    if (isUndefinedColumnError(storeRes.error, "attendance_flow_type")) {
      console.warn("[daily-bar-summary] attendance_flow_type 未適用のため対象店舗なし");
      stores = [];
    } else {
      logPostgrestError("daily-bar-summary stores", storeRes.error);
      throw new Error(storeRes.error.message);
    }
  } else {
    stores = (storeRes.data ?? []) as StoreRow[];
  }

  const results: Array<{
    storeId: string;
    name: string | null;
    sent: boolean;
    skipped?: string;
    error?: string;
  }> = [];

  for (const store of stores) {
    const storeId = store.id;

    try {
      const tokenPack = await fetchResolvedLineChannelAccessTokenForStore(admin, storeId, "[daily-bar-summary]");
      if (!tokenPack?.token) {
        results.push({ storeId, name: store.name, sent: false, skipped: "no_line_token" });
        continue;
      }

      const adminIds = await fetchAdminLineUserIds(admin, storeId);
      if (adminIds.length === 0) {
        results.push({ storeId, name: store.name, sent: false, skipped: "no_admin_recipients" });
        continue;
      }

      const { data: logsRaw, error: logsErr } = await admin
        .from("attendance_logs")
        .select("cast_id, status, planned_groups, tentative_groups, action_type, action_detail")
        .eq("store_id", storeId)
        .eq("attended_date", dateYmd);

      if (logsErr) {
        logPostgrestError("daily-bar-summary attendance_logs", logsErr);
        results.push({ storeId, name: store.name, sent: false, error: logsErr.message });
        continue;
      }

      const logs = (logsRaw ?? []) as LogRow[];
      const castIds = [...new Set(logs.map((l) => l.cast_id).filter(Boolean))];

      const nameByCastId = new Map<string, string>();
      if (castIds.length > 0) {
        const { data: casts } = await admin.from("casts").select("id, name").eq("store_id", storeId).in("id", castIds);
        for (const c of casts ?? []) {
          const row = c as { id?: string; name?: string | null };
          if (row.id) nameByCastId.set(row.id, String(row.name ?? "").trim() || "（名前なし）");
        }
      }

      const { data: schedRaw } = await admin
        .from("attendance_schedules")
        .select("cast_id, is_dohan, late_reason, absent_reason, public_holiday_reason, half_holiday_reason")
        .eq("store_id", storeId)
        .eq("scheduled_date", dateYmd);

      const scheduleByCast = new Map<string, ScheduleRow>();
      for (const s of schedRaw ?? []) {
        const row = s as ScheduleRow;
        if (row.cast_id) scheduleByCast.set(row.cast_id, row);
      }

      const attending = logs.filter((l) => String(l.status ?? "") === "attending");
      const others = logs.filter((l) => String(l.status ?? "") !== "attending");

      const sortLogs = (arr: LogRow[]) =>
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
          lines.push("", formatCastSectionLine({
            headerTag: tag,
            castName,
            planned: row.planned_groups,
            tentative: row.tentative_groups,
            actionDetail: row.action_detail,
            actionType: row.action_type,
          }));
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
          lines.push("", formatCastSectionLine({
            headerTag: tag,
            castName,
            planned: row.planned_groups,
            tentative: row.tentative_groups,
            actionDetail: row.action_detail,
            actionType: row.action_type,
            reasonSuffix: reasonText || undefined,
          }));
        }
      }

      const body = lines.join("\n").trimEnd();

      const maxLen = 4800;
      const chunks: string[] = [];
      if (body.length <= maxLen) {
        chunks.push(body);
      } else {
        let rest = body;
        let part = 1;
        while (rest.length > 0) {
          const head = rest.slice(0, maxLen);
          chunks.push(part === 1 ? head : `（続き ${part}）\n${head}`);
          rest = rest.slice(maxLen);
          part += 1;
        }
      }

      for (const chunk of chunks) {
        await sendMulticastMessage(adminIds, tokenPack.token, [{ type: "text", text: chunk }]);
      }

      results.push({ storeId, name: store.name, sent: true });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[daily-bar-summary] store error", storeId, msg);
      results.push({ storeId, name: store.name, sent: false, error: msg });
    }
  }

  return { dateYmd, results };
}

export async function GET(request: Request) {
  try {
    const cronSecret = process.env.CRON_SECRET;
    const authHeader = request.headers.get("authorization");
    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()) {
      return NextResponse.json({ error: "Missing config" }, { status: 500 });
    }

    const { dateYmd, results } = await runDailyBarSummary();
    return NextResponse.json({
      ok: true,
      date: dateYmd,
      storeCount: results.length,
      results,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[daily-bar-summary]", e);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  return GET(request);
}
