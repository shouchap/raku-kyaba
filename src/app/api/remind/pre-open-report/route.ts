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

const LOG_PREFIX = "[PreOpenReport]";

function getSupabaseKeys(): { url: string | null; key: string | null; isServiceRole: boolean } {
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL)?.trim() ?? null;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (service) return { url, key: service, isServiceRole: true };
  return { url, key: anon ?? null, isServiceRole: false };
}

/** Cloud Scheduler / Vercel で request.url が不正な場合のフォールバック */
function safeSearchParams(request: Request): URLSearchParams {
  try {
    return new URL(request.url).searchParams;
  } catch (e) {
    console.error(`${LOG_PREFIX} new URL(request.url) failed`, {
      rawUrl: request.url,
      error: e instanceof Error ? e.message : String(e),
    });
    const host =
      request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? "localhost";
    const path = "/api/remind/pre-open-report";
    try {
      return new URL(`https://${host}${path}`).searchParams;
    } catch (e2) {
      console.error(`${LOG_PREFIX} URL fallback failed`, e2);
      return new URLSearchParams();
    }
  }
}

async function getAdminLineUserIds(supabase: SupabaseClient, storeId: string): Promise<string[]> {
  const { data: adminCasts, error: castsErr } = await supabase
    .from("casts")
    .select("line_user_id")
    .eq("store_id", storeId)
    .eq("is_admin", true)
    .eq("is_active", true)
    .not("line_user_id", "is", null);

  if (castsErr) {
    console.error(`${LOG_PREFIX} casts query (admin)`, storeId, castsErr.message, castsErr.code);
  }

  const fromCasts = (adminCasts ?? [])
    .map((r: { line_user_id?: string }) => r.line_user_id)
    .filter((id): id is string => !!id && id.trim() !== "");

  if (fromCasts.length > 0) return fromCasts;

  const { data: storeRow, error: storeErr } = await supabase
    .from("stores")
    .select("admin_line_user_id")
    .eq("id", storeId)
    .maybeSingle();

  if (storeErr) {
    console.error(`${LOG_PREFIX} stores admin_line_user_id`, storeId, storeErr.message, storeErr.code);
  }

  const legacyId = (storeRow as { admin_line_user_id?: string | null } | null)?.admin_line_user_id;
  if (legacyId && String(legacyId).trim() !== "") return [legacyId];

  return [];
}

/** ネスト casts 付き（失敗時はフォールバック） */
async function fetchSchedulesForPreOpenReport(
  supabase: SupabaseClient,
  storeId: string,
  todayJst: string
): Promise<{ data: PreOpenScheduleRow[] | null; error: { message: string; code?: string } | null }> {
  const fullSelect =
    "id, scheduled_time, is_dohan, is_sabaki, response_status, late_reason, absent_reason, public_holiday_reason, half_holiday_reason, has_reservation, reservation_details, pending_line_flow, casts(name)";

  const minSelect =
    "id, scheduled_time, is_dohan, is_sabaki, response_status, late_reason, absent_reason, public_holiday_reason, half_holiday_reason, has_reservation, reservation_details, pending_line_flow";

  const first = await supabase
    .from("attendance_schedules")
    .select(fullSelect)
    .eq("store_id", storeId)
    .eq("scheduled_date", todayJst)
    .or("scheduled_time.not.is.null,is_sabaki.eq.true");

  if (first.error) {
    console.error(`${LOG_PREFIX} schedules select (with casts)`, storeId, {
      message: first.error.message,
      code: first.error.code,
      details: first.error.details,
      hint: first.error.hint,
    });
    const second = await supabase
      .from("attendance_schedules")
      .select(minSelect)
      .eq("store_id", storeId)
      .eq("scheduled_date", todayJst)
      .or("scheduled_time.not.is.null,is_sabaki.eq.true");
    if (second.error) {
      console.error(`${LOG_PREFIX} schedules select (minimal)`, storeId, {
        message: second.error.message,
        code: second.error.code,
      });
      return { data: null, error: { message: second.error.message, code: second.error.code } };
    }
    console.warn(`${LOG_PREFIX} using schedule rows without casts(name); names may show as 不明`);
    return {
      data: (second.data ?? []) as PreOpenScheduleRow[],
      error: null,
    };
  }

  return {
    data: (first.data ?? []) as PreOpenScheduleRow[],
    error: null,
  };
}

type StoreRow = {
  id: string;
  name: string | null;
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
  const sid = String(store?.id ?? "").trim();
  if (!sid) {
    console.error(`${LOG_PREFIX} processPreOpenReportForStore: missing store.id`, store);
    return { storeId: "(unknown)", skipped: "invalid_store_row" };
  }

  const { todayJst, hourJst, force } = ctx;

  try {
    if (!force) {
      if (store.pre_open_report_hour_jst == null) {
        return { storeId: sid, skipped: "summary_disabled" };
      }
      if (store.pre_open_report_hour_jst !== hourJst) {
        return { storeId: sid, skipped: "hour_mismatch" };
      }
      const sentDate = store.last_pre_open_report_date?.trim() ?? null;
      if (sentDate === todayJst) {
        return { storeId: sid, skipped: "already_sent_today" };
      }
    }

    const resolved = await fetchResolvedLineChannelAccessTokenForStore(supabase, sid, LOG_PREFIX);
    if (!resolved?.token) {
      return { storeId: sid, skipped: "no_line_token" };
    }

    const adminIds = await getAdminLineUserIds(supabase, sid);
    if (adminIds.length === 0) {
      return { storeId: sid, skipped: "no_admin_recipients" };
    }

    const { data: rawSchedules, error: schedErr } = await fetchSchedulesForPreOpenReport(
      supabase,
      sid,
      todayJst
    );

    if (schedErr) {
      return { storeId: sid, skipped: `fetch_error:${schedErr.message}` };
    }

    const schedules = rawSchedules ?? [];
    if (schedules.length === 0 && !force) {
      return { storeId: sid, skipped: "no_schedules_today" };
    }

    let body: string;
    try {
      body = buildPreOpenReportMessage(store.name ?? "店舗", todayJst, schedules);
    } catch (buildErr) {
      console.error(`${LOG_PREFIX} buildPreOpenReportMessage failed`, sid, buildErr);
      return {
        storeId: sid,
        skipped: `build_message_failed:${buildErr instanceof Error ? buildErr.message : String(buildErr)}`,
      };
    }

    try {
      await sendMulticastMessage(adminIds, resolved.token, [{ type: "text", text: body }]);
    } catch (e) {
      console.error(`${LOG_PREFIX} sendMulticastMessage`, sid, e);
      return {
        storeId: sid,
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
        .eq("id", sid);

      if (updErr) {
        console.error(`${LOG_PREFIX} last_pre_open_report_date 更新失敗`, sid, updErr);
      }
    }

    return { storeId: sid, sent: true, adminCount: adminIds.length };
  } catch (e) {
    console.error(`${LOG_PREFIX} processPreOpenReportForStore unexpected`, sid, e);
    return {
      storeId: sid,
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
  console.error(`${LOG_PREFIX} Promise rejected`, storeId, reason);
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
      console.error(`${LOG_PREFIX} missing Supabase URL or key`);
      return NextResponse.json(
        { error: "Supabase URL or key is not configured" },
        { status: 500 }
      );
    }

    if (!isServiceRole) {
      console.error(`${LOG_PREFIX} SUPABASE_SERVICE_ROLE_KEY not set (required for cron)`);
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

    const paramStoreIdRaw = safeSearchParams(request).get("storeId")?.trim() ?? "";
    const paramStoreId = paramStoreIdRaw ? paramStoreIdRaw.toLowerCase() : "";

    if (paramStoreId) {
      if (!isValidStoreId(paramStoreId)) {
        return NextResponse.json({ error: "Invalid storeId" }, { status: 400 });
      }

      /** テスト用: pre_open 系カラム未適用でも 500 にしないよう id / name のみ取得 */
      const { data: oneStore, error: oneErr } = await supabase
        .from("stores")
        .select("id, name")
        .eq("id", paramStoreId)
        .maybeSingle();

      if (oneErr) {
        console.error(`${LOG_PREFIX} force_single fetch store`, {
          storeId: paramStoreId,
          message: oneErr.message,
          code: oneErr.code,
          details: oneErr.details,
          hint: oneErr.hint,
        });
        return NextResponse.json(
          { error: "Failed to fetch store", details: oneErr.message, code: oneErr.code },
          { status: 500 }
        );
      }
      if (!oneStore?.id) {
        return NextResponse.json({ error: "Store not found" }, { status: 404 });
      }

      const storeRow: StoreRow = {
        id: oneStore.id,
        name: oneStore.name ?? null,
        pre_open_report_hour_jst: null,
        last_pre_open_report_date: null,
      };

      let settled: PromiseSettledResult<ProcessResult>[];
      try {
        settled = await Promise.allSettled([
          processPreOpenReportForStore(supabase, storeRow, {
            todayJst,
            hourJst,
            force: true,
          }),
        ]);
      } catch (loopErr) {
        console.error(`${LOG_PREFIX} force_single Promise.allSettled failed`, loopErr);
        throw loopErr;
      }

      const first = settled[0];
      if (!first) {
        console.error(`${LOG_PREFIX} force_single: empty settled array`);
        return NextResponse.json(
          { error: "Internal server error", details: "empty settled result" },
          { status: 500 }
        );
      }

      const results = [settledToResult(paramStoreId, first)];
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
      console.error(`${LOG_PREFIX} batch fetch stores`, {
        message: storesErr.message,
        code: storesErr.code,
        details: storesErr.details,
      });
      return NextResponse.json(
        { error: "Failed to fetch stores", details: storesErr.message },
        { status: 500 }
      );
    }

    const list = (stores ?? []) as StoreRow[];

    let settled: PromiseSettledResult<ProcessResult>[];
    try {
      settled = await Promise.allSettled(
        list.map((store) =>
          processPreOpenReportForStore(supabase, store, {
            todayJst,
            hourJst,
            force: false,
          })
        )
      );
    } catch (batchErr) {
      console.error(`${LOG_PREFIX} batch Promise.allSettled failed`, batchErr);
      throw batchErr;
    }

    const results: ProcessResult[] = list.map((store, i) => {
      const out = settled[i];
      if (!out) {
        console.error(`${LOG_PREFIX} batch: missing settled index`, i, store.id);
        return { storeId: store.id, skipped: "internal_settled_missing" };
      }
      return settledToResult(store.id, out);
    });

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
    console.error(`${LOG_PREFIX} GET handler failed`, err);
    if (err instanceof Error) {
      console.error(`${LOG_PREFIX} stack`, err.stack);
    }
    return NextResponse.json(
      {
        error: "Internal server error",
        details: err instanceof Error ? err.message : String(err),
      },
      { status: 500 }
    );
  }
}
