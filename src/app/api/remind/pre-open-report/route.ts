/**
 * 営業前サマリー（本日のシフト状況）を管理者へプッシュ通知する API
 *
 * GET /api/remind/pre-open-report
 * - Cloud Scheduler / Cron: JST の「時」が店舗の pre_open_report_hour_jst（無ければ PRE_OPEN_REPORT_HOUR_JST、既定 10）と一致
 * - 同一暦日の二重送信防止: stores.last_pre_open_report_date
 * - 認証: CRON_SECRET が設定されている場合は Authorization: Bearer <CRON_SECRET>（/api/remind と同様）
 */

import { NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { sendMulticastMessage } from "@/lib/line-reply";
import { fetchResolvedLineChannelAccessTokenForStore } from "@/lib/line-channel-token";
import { getTodayJst, getCurrentTimeJst } from "@/lib/date-utils";
import { formatRemindScheduledTime } from "@/lib/attendance-remind-flex";

export const dynamic = "force-dynamic";

function getSupabaseKeys(): { url: string | null; key: string | null; isServiceRole: boolean } {
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL)?.trim() ?? null;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (service) return { url, key: service, isServiceRole: true };
  return { url, key: anon ?? null, isServiceRole: false };
}

function parseDefaultPreOpenHourJst(): number {
  const raw = process.env.PRE_OPEN_REPORT_HOUR_JST?.trim();
  if (!raw) return 10;
  const n = parseInt(raw, 10);
  if (Number.isNaN(n) || n < 0 || n > 23) return 10;
  return n;
}

function minutesFromScheduledTime(time: string | null | undefined): number {
  if (!time) return Number.MAX_SAFE_INTEGER;
  const m = String(time).match(/^(\d{1,2}):(\d{2})/);
  if (!m) return Number.MAX_SAFE_INTEGER;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

type CastJoin = { name?: string } | { name?: string }[] | null;

type ScheduleRow = {
  id: string;
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

async function getAdminLineUserIds(supabase: SupabaseClient, storeId: string): Promise<string[]> {
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

  const { data: store } = await supabase
    .from("stores")
    .select("admin_line_user_id")
    .eq("id", storeId)
    .single();

  const legacyId = (store as { admin_line_user_id?: string | null })?.admin_line_user_id;
  if (legacyId && String(legacyId).trim() !== "") return [legacyId];

  return [];
}

function castNameFromRow(row: ScheduleRow): string {
  const raw = row.casts;
  if (!raw) return "不明";
  const c = Array.isArray(raw) ? raw[0] : raw;
  return c?.name?.trim() || "不明";
}

function sectionForRow(row: ScheduleRow): "attending" | "late" | "off" | "unanswered" {
  if (row.pending_line_flow) return "attending";
  const rs = row.response_status;
  if (rs === "attending") return "attending";
  if (rs === "late") return "late";
  if (rs === "absent" || rs === "public_holiday" || rs === "half_holiday") return "off";
  return "unanswered";
}

function reservationSuffix(row: ScheduleRow): string {
  if (row.pending_line_flow === "reservation_ask") return " / 予約: 回答待ち";
  if (row.pending_line_flow === "reservation_detail") return " / 予約: 詳細入力待ち";
  if (row.pending_line_flow) return " / 予約: 確認中";
  if (row.has_reservation === true) {
    const d = (row.reservation_details ?? "").trim();
    return d ? ` / 予約: ${d}` : " / 予約: （詳細あり）";
  }
  if (row.has_reservation === false) return " / 予約なし";
  return "";
}

function lineAttending(row: ScheduleRow): string {
  const name = castNameFromRow(row);
  const time = formatRemindScheduledTime(row.scheduled_time, row.is_dohan);
  return `・${name} (${time})${reservationSuffix(row)}`;
}

function lineLate(row: ScheduleRow): string {
  const name = castNameFromRow(row);
  const time = formatRemindScheduledTime(row.scheduled_time, row.is_dohan);
  const reason = (row.late_reason ?? "").trim();
  return reason ? `・${name} (${time}) — ${reason}` : `・${name} (${time})`;
}

function lineOff(row: ScheduleRow): string {
  const name = castNameFromRow(row);
  const rs = row.response_status;
  if (rs === "absent") {
    const r = (row.absent_reason ?? "").trim();
    return `・${name} (欠勤${r ? `: ${r}` : ""})`;
  }
  if (rs === "public_holiday") {
    const r = (row.public_holiday_reason ?? "").trim();
    return `・${name} (公休${r ? `: ${r}` : ""})`;
  }
  if (rs === "half_holiday") {
    const r = (row.half_holiday_reason ?? "").trim();
    return `・${name} (半休${r ? `: ${r}` : ""})`;
  }
  return `・${name}`;
}

function lineUnanswered(row: ScheduleRow): string {
  const name = castNameFromRow(row);
  const time = formatRemindScheduledTime(row.scheduled_time, row.is_dohan);
  return `・${name} (${time})`;
}

function sortSchedules(rows: ScheduleRow[]): ScheduleRow[] {
  return [...rows].sort((a, b) => {
    const ma = minutesFromScheduledTime(a.scheduled_time);
    const mb = minutesFromScheduledTime(b.scheduled_time);
    if (ma !== mb) return ma - mb;
    return castNameFromRow(a).localeCompare(castNameFromRow(b), "ja");
  });
}

function buildPreOpenReportText(storeName: string, rows: ScheduleRow[]): string {
  const sorted = sortSchedules(rows);
  const attending: ScheduleRow[] = [];
  const late: ScheduleRow[] = [];
  const off: ScheduleRow[] = [];
  const unanswered: ScheduleRow[] = [];

  for (const r of sorted) {
    const s = sectionForRow(r);
    if (s === "attending") attending.push(r);
    else if (s === "late") late.push(r);
    else if (s === "off") off.push(r);
    else unanswered.push(r);
  }

  const lines: string[] = [];
  lines.push(`【本日の営業前サマリー（${storeName}）】`);
  lines.push("");
  lines.push("✅ 出勤予定");
  lines.push(attending.length ? attending.map(lineAttending).join("\n") : "・なし");
  lines.push("");
  lines.push("⚠️ 遅刻");
  lines.push(late.length ? late.map(lineLate).join("\n") : "・なし");
  lines.push("");
  lines.push("❌ お休み");
  lines.push(off.length ? off.map(lineOff).join("\n") : "・なし");
  if (unanswered.length > 0) {
    lines.push("");
    lines.push("❓ 未回答");
    lines.push(unanswered.map(lineUnanswered).join("\n"));
  }
  return lines.join("\n");
}

type StoreRow = {
  id: string;
  name: string;
  pre_open_report_hour_jst: number | null;
  last_pre_open_report_date: string | null;
};

export async function GET(request: Request) {
  try {
    const cronSecret = process.env.CRON_SECRET;
    if (cronSecret && cronSecret.trim() !== "") {
      const authHeader = request.headers.get("authorization");
      const expected = `Bearer ${cronSecret.trim()}`;
      if (authHeader?.trim() !== expected) {
        return NextResponse.json(
          { error: "Unauthorized", message: "Invalid or missing Authorization header" },
          { status: 401 }
        );
      }
    }

    const { url, key, isServiceRole } = getSupabaseKeys();
    if (!url || !key) {
      return NextResponse.json(
        { error: "Supabase URL or key is not configured" },
        { status: 500 }
      );
    }

    if (!isServiceRole) {
      return NextResponse.json(
        {
          error: "Configuration error",
          message:
            "Multi-store cron requires SUPABASE_SERVICE_ROLE_KEY. Set the service role key for server-side batch jobs.",
        },
        { status: 500 }
      );
    }

    const supabase = createClient(url, key);
    const todayJst = getTodayJst();
    const hourJst = getCurrentTimeJst().hour;
    const defaultHour = parseDefaultPreOpenHourJst();

    const { data: stores, error: storesErr } = await supabase
      .from("stores")
      .select("id, name, pre_open_report_hour_jst, last_pre_open_report_date");

    if (storesErr) {
      return NextResponse.json(
        { error: "Failed to fetch stores", details: storesErr.message },
        { status: 500 }
      );
    }

    const results: Array<{
      storeId: string;
      skipped?: string;
      sent?: boolean;
      adminCount?: number;
    }> = [];

    for (const store of (stores ?? []) as StoreRow[]) {
      const targetHour = store.pre_open_report_hour_jst ?? defaultHour;
      if (targetHour !== hourJst) {
        results.push({ storeId: store.id, skipped: "hour_mismatch" });
        continue;
      }

      const sentDate = store.last_pre_open_report_date?.trim() ?? null;
      if (sentDate === todayJst) {
        results.push({ storeId: store.id, skipped: "already_sent_today" });
        continue;
      }

      const resolved = await fetchResolvedLineChannelAccessTokenForStore(
        supabase,
        store.id,
        "[PreOpenReport]"
      );
      if (!resolved?.token) {
        results.push({ storeId: store.id, skipped: "no_line_token" });
        continue;
      }

      const adminIds = await getAdminLineUserIds(supabase, store.id);
      if (adminIds.length === 0) {
        results.push({ storeId: store.id, skipped: "no_admin_recipients" });
        continue;
      }

      const { data: rawSchedules, error: schedErr } = await supabase
        .from("attendance_schedules")
        .select(
          "id, scheduled_time, is_dohan, response_status, late_reason, absent_reason, public_holiday_reason, half_holiday_reason, has_reservation, reservation_details, pending_line_flow, casts(name)"
        )
        .eq("store_id", store.id)
        .eq("scheduled_date", todayJst)
        .not("scheduled_time", "is", null);

      if (schedErr) {
        results.push({ storeId: store.id, skipped: `fetch_error:${schedErr.message}` });
        continue;
      }

      const schedules = (rawSchedules ?? []) as ScheduleRow[];
      const body = buildPreOpenReportText(store.name ?? "店舗", schedules);

      try {
        await sendMulticastMessage(adminIds, resolved.token, [{ type: "text", text: body }]);
      } catch (e) {
        results.push({
          storeId: store.id,
          skipped: `line_send_failed:${e instanceof Error ? e.message : String(e)}`,
        });
        continue;
      }

      const { error: updErr } = await supabase
        .from("stores")
        .update({
          last_pre_open_report_date: todayJst,
          updated_at: new Date().toISOString(),
        })
        .eq("id", store.id);

      if (updErr) {
        console.error("[PreOpenReport] last_pre_open_report_date 更新失敗", store.id, updErr);
      }

      results.push({ storeId: store.id, sent: true, adminCount: adminIds.length });
    }

    return NextResponse.json({
      ok: true,
      todayJst,
      hourJst,
      defaultHourFallback: defaultHour,
      results,
    });
  } catch (err) {
    console.error("[PreOpenReport]", err);
    return NextResponse.json(
      {
        error: "Internal server error",
        details: err instanceof Error ? err.message : String(err),
      },
      { status: 500 }
    );
  }
}
