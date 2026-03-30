/**
 * 営業前サマリー（本日のシフト状況）を管理者へプッシュ通知する API
 *
 * GET /api/remind/pre-open-report
 * - Cloud Scheduler: storeId なし → 全店舗のうち、JST の「時」が店舗の pre_open_report_hour_jst と一致し、
 *   かつ「送信しない」でない（NULL でない）店のみ。二重送信防止: stores.last_pre_open_report_date
 * - テスト: ?storeId=uuid → 上記の時刻・当日重複チェックを無視し、その店のみ送信（last_pre_open_report_date は更新しない）
 * - 認証: CRON_SECRET 設定時は Authorization: Bearer <CRON_SECRET>（/api/remind と同様）
 * - 送信先: is_admin のキャストの line_user_id を優先、なければ stores.admin_line_user_id
 */

import { NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { sendMulticastMessage } from "@/lib/line-reply";
import { fetchResolvedLineChannelAccessTokenForStore } from "@/lib/line-channel-token";
import { getTodayJst, getCurrentTimeJst } from "@/lib/date-utils";
import { buildPreOpenReportMessage, type PreOpenScheduleRow } from "@/lib/pre-open-report-message";
import { isValidStoreId } from "@/lib/current-store";

export const dynamic = "force-dynamic";

function getSupabaseKeys(): { url: string | null; key: string | null; isServiceRole: boolean } {
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL)?.trim() ?? null;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (service) return { url, key: service, isServiceRole: true };
  return { url, key: anon ?? null, isServiceRole: false };
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

type ProcessResult = {
  storeId: string;
  skipped?: string;
  sent?: boolean;
  adminCount?: number;
};

/**
 * 1 店舗分の営業前サマリー送信。
 * - force=false: 時刻一致・送信 ON（pre_open 非 NULL）・未送信日・シフト 1 件以上
 * - force=true: 時刻・当日重複・シフト件数は見ない。送信成功後も last_pre_open_report_date は更新しない
 */
async function processPreOpenReportForStore(
  supabase: SupabaseClient,
  store: StoreRow,
  ctx: { todayJst: string; hourJst: number; force: boolean }
): Promise<ProcessResult> {
  const { todayJst, hourJst, force } = ctx;

  try {
    if (!force) {
      if (store.pre_open_report_hour_jst == null) {
        return { storeId: store.id, skipped: "summary_disabled" };
      }
      if (store.pre_open_report_hour_jst !== hourJst) {
        return { storeId: store.id, skipped: "hour_mismatch" };
      }
      const sentDate = store.last_pre_open_report_date?.trim() ?? null;
      if (sentDate === todayJst) {
        return { storeId: store.id, skipped: "already_sent_today" };
      }
    }

    const resolved = await fetchResolvedLineChannelAccessTokenForStore(
      supabase,
      store.id,
      "[PreOpenReport]"
    );
    if (!resolved?.token) {
      return { storeId: store.id, skipped: "no_line_token" };
    }

    const adminIds = await getAdminLineUserIds(supabase, store.id);
    if (adminIds.length === 0) {
      return { storeId: store.id, skipped: "no_admin_recipients" };
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
      return { storeId: store.id, skipped: `fetch_error:${schedErr.message}` };
    }

    const schedules = (rawSchedules ?? []) as PreOpenScheduleRow[];
    if (schedules.length === 0 && !force) {
      return { storeId: store.id, skipped: "no_schedules_today" };
    }

    const body = buildPreOpenReportMessage(store.name ?? "店舗", todayJst, schedules);

    try {
      await sendMulticastMessage(adminIds, resolved.token, [{ type: "text", text: body }]);
    } catch (e) {
      return {
        storeId: store.id,
        skipped: `line_send_failed:${e instanceof Error ? e.message : String(e)}`,
      };
    }

    if (!force) {
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
    }

    return { storeId: store.id, sent: true, adminCount: adminIds.length };
  } catch (e) {
    return {
      storeId: store.id,
      skipped: `unexpected:${e instanceof Error ? e.message : String(e)}`,
    };
  }
}

function settledToResult(
  storeId: string,
  outcome: PromiseSettledResult<ProcessResult>
): ProcessResult {
  if (outcome.status === "fulfilled") return outcome.value;
  const reason = outcome.reason;
  return {
    storeId,
    skipped: `rejected:${reason instanceof Error ? reason.message : String(reason)}`,
  };
}

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

    const paramStoreId = new URL(request.url).searchParams.get("storeId")?.trim() ?? "";

    if (paramStoreId) {
      if (!isValidStoreId(paramStoreId)) {
        return NextResponse.json({ error: "Invalid storeId" }, { status: 400 });
      }

      const { data: oneStore, error: oneErr } = await supabase
        .from("stores")
        .select("id, name, pre_open_report_hour_jst, last_pre_open_report_date")
        .eq("id", paramStoreId)
        .maybeSingle();

      if (oneErr) {
        return NextResponse.json(
          { error: "Failed to fetch store", details: oneErr.message },
          { status: 500 }
        );
      }
      if (!oneStore) {
        return NextResponse.json({ error: "Store not found" }, { status: 404 });
      }

      const settled = await Promise.allSettled([
        processPreOpenReportForStore(supabase, oneStore as StoreRow, {
          todayJst,
          hourJst,
          force: true,
        }),
      ]);

      const results = [settledToResult(paramStoreId, settled[0]!)];
      const processedCount = results.filter((r) => r.sent === true).length;

      return NextResponse.json({
        ok: true,
        mode: "force_single" as const,
        storeId: paramStoreId,
        processedCount,
        todayJst,
        hourJst,
        results,
      });
    }

    const { data: stores, error: storesErr } = await supabase
      .from("stores")
      .select("id, name, pre_open_report_hour_jst, last_pre_open_report_date");

    if (storesErr) {
      return NextResponse.json(
        { error: "Failed to fetch stores", details: storesErr.message },
        { status: 500 }
      );
    }

    const list = (stores ?? []) as StoreRow[];

    const settled = await Promise.allSettled(
      list.map((store) =>
        processPreOpenReportForStore(supabase, store, {
          todayJst,
          hourJst,
          force: false,
        })
      )
    );

    const results: ProcessResult[] = list.map((store, i) =>
      settledToResult(store.id, settled[i]!)
    );

    const processedCount = results.filter((r) => r.sent === true).length;

    return NextResponse.json({
      ok: true,
      mode: "batch_all_stores" as const,
      processedCount,
      todayJst,
      hourJst,
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
