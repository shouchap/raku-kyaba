/**
 * 営業前サマリー（本日のシフト状況）を管理者へプッシュ通知する API
 *
 * GET /api/remind/pre-open-report
 * - Cloud Scheduler 等: 現在 JST の「時」が店舗の pre_open_report_hour_jst（NULL 時は PRE_OPEN_REPORT_HOUR_JST、既定 10）と一致
 * - 二重送信防止: stores.last_pre_open_report_date
 * - 認証: CRON_SECRET 設定時は Authorization: Bearer <CRON_SECRET>（/api/remind と同様）
 * - 送信先: is_admin のキャストの line_user_id を優先、なければ stores.admin_line_user_id
 */

import { NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { sendMulticastMessage } from "@/lib/line-reply";
import { fetchResolvedLineChannelAccessTokenForStore } from "@/lib/line-channel-token";
import { getTodayJst, getCurrentTimeJst } from "@/lib/date-utils";
import { buildPreOpenReportMessage, type PreOpenScheduleRow } from "@/lib/pre-open-report-message";

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

    let processedCount = 0;

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

      const schedules = (rawSchedules ?? []) as PreOpenScheduleRow[];
      if (schedules.length === 0) {
        results.push({ storeId: store.id, skipped: "no_schedules_today" });
        continue;
      }

      const body = buildPreOpenReportMessage(store.name ?? "店舗", todayJst, schedules);

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

      processedCount += 1;
      results.push({ storeId: store.id, sent: true, adminCount: adminIds.length });
    }

    return NextResponse.json({
      ok: true,
      processedCount,
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
