/**
 * B型事業所（welfare_b）向け定期配信（Cloud Scheduler 等から GET）
 *
 * GET /api/welfare/cron?segment=morning|midday|evening
 * - morning: 9:00 作業開始
 * - midday: 12:00 体調確認
 * - evening: 17:00 作業終了
 *
 * 送信対象者（各店舗ごと）:
 * - casts で store_id が一致し is_active=true かつ line_user_id が非空の利用者すべて。
 * - 当日の出勤予定・作業開始済み・welfare_daily_logs の状態は見ない（同一配信）。
 * - stores.regular_holidays に「今日の曜日（JST）」が含まれる店舗はスキップ。
 *
 * 認証: CRON_SECRET 設定時は Authorization: Bearer <CRON_SECRET>
 * GET / POST いずれも同一処理（Scheduler のメソッド差で 405 にならないよう POST も受付）
 * テスト: ?storeId=uuid でその店のみ（時刻チェックなし）
 */

import { NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { sendMulticastMessage } from "@/lib/line-reply";
import { fetchResolvedLineChannelAccessTokenForStore } from "@/lib/line-channel-token";
import { isValidStoreId } from "@/lib/current-store";
import { isUndefinedColumnError } from "@/lib/postgrest-error";
import { getTodayJst, getWeekdayJst } from "@/lib/date-utils";
import {
  buildWelfareEveningEndFlexMessage,
  buildWelfareMiddayHealthFlexMessage,
  buildWelfareMorningStartFlexMessage,
} from "@/lib/welfare-line-flex";
import { fetchLineCustomizationForStore } from "@/lib/line-customization";

export const dynamic = "force-dynamic";

const LOG_PREFIX = "[WelfareCron]";

type Segment = "morning" | "midday" | "evening";

function getSupabaseKeys(): { url: string | null; key: string | null } {
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL)?.trim() ?? null;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? null;
  return { url, key };
}

function parseSegment(raw: string | null): Segment | null {
  const s = raw?.trim().toLowerCase() ?? "";
  if (s === "morning" || s === "midday" || s === "evening") return s;
  return null;
}

type WelfareCronStoreRow = {
  id: string;
  welfare_message_morning: string | null;
  welfare_message_midday: string | null;
  welfare_message_evening: string | null;
  /** 定休日（0=日〜6=土）。未設定・空はスキップしない */
  regular_holidays: number[] | null;
};

/** 定休日なら true（stores.regular_holidays と JST 暦日の曜日を照合） */
function isRegularHolidayDay(
  regularHolidays: number[] | null | undefined,
  todayJst: string
): boolean {
  const arr = Array.isArray(regularHolidays) ? regularHolidays : [];
  if (arr.length === 0) return false;
  const wd = getWeekdayJst(todayJst);
  return arr.includes(wd);
}

function flexForSegment(
  seg: Segment,
  row: WelfareCronStoreRow,
  welfareCustom?: Parameters<typeof buildWelfareMorningStartFlexMessage>[1]
) {
  switch (seg) {
    case "morning":
      return buildWelfareMorningStartFlexMessage(row.welfare_message_morning, welfareCustom);
    case "midday":
      return buildWelfareMiddayHealthFlexMessage(row.welfare_message_midday, welfareCustom);
    case "evening":
      return buildWelfareEveningEndFlexMessage(row.welfare_message_evening, welfareCustom);
    default:
      return buildWelfareMorningStartFlexMessage(row.welfare_message_morning, welfareCustom);
  }
}

const WELFARE_STORE_SELECT =
  "id, welfare_message_morning, welfare_message_midday, welfare_message_evening, regular_holidays";

const WELFARE_STORE_SELECT_NO_REGULAR =
  "id, welfare_message_morning, welfare_message_midday, welfare_message_evening";

async function fetchWelfareStores(
  supabase: SupabaseClient,
  singleStoreId: string | null
): Promise<WelfareCronStoreRow[]> {
  if (singleStoreId) {
    let { data, error } = await supabase
      .from("stores")
      .select(WELFARE_STORE_SELECT)
      .eq("id", singleStoreId)
      .eq("business_type", "welfare_b")
      .maybeSingle();
    if (error && isUndefinedColumnError(error, "regular_holidays")) {
      console.warn(
        `${LOG_PREFIX} stores.regular_holidays 未適用。定休スキップなし。マイグレーション 018 を適用してください。`
      );
      const retry = await supabase
        .from("stores")
        .select(WELFARE_STORE_SELECT_NO_REGULAR)
        .eq("id", singleStoreId)
        .eq("business_type", "welfare_b")
        .maybeSingle();
      data = retry.data as typeof data;
      error = retry.error;
    }
    if (error) {
      if (isUndefinedColumnError(error, "welfare_message_morning")) {
        console.warn(
          `${LOG_PREFIX} welfare_message_* 未適用。024 適用までデフォルト文言で送信します。`
        );
        const fb = await supabase
          .from("stores")
          .select("id")
          .eq("id", singleStoreId)
          .eq("business_type", "welfare_b")
          .maybeSingle();
        if (fb.error || !fb.data?.id) return [];
        return [normalizeWelfareCronRow(fb.data as Record<string, unknown>)];
      }
      console.error(LOG_PREFIX, "single store fetch", error.message);
      return [];
    }
    if (!data?.id) return [];
    return [normalizeWelfareCronRow(data as Record<string, unknown>)];
  }

  let { data, error } = await supabase
    .from("stores")
    .select(WELFARE_STORE_SELECT)
    .eq("business_type", "welfare_b");

  if (error && isUndefinedColumnError(error, "regular_holidays")) {
    console.warn(
      `${LOG_PREFIX} stores.regular_holidays 未適用。定休スキップなし。マイグレーション 018 を適用してください。`
    );
    const retry = await supabase
      .from("stores")
      .select(WELFARE_STORE_SELECT_NO_REGULAR)
      .eq("business_type", "welfare_b");
    data = retry.data as typeof data;
    error = retry.error;
  }

  if (error) {
    if (isUndefinedColumnError(error, "welfare_message_morning")) {
      console.warn(
        `${LOG_PREFIX} welfare_message_* 未適用。024 適用までデフォルト文言で送信します。`
      );
      const fb = await supabase.from("stores").select("id").eq("business_type", "welfare_b");
      if (fb.error) {
        console.error(LOG_PREFIX, "stores list fallback", fb.error.message);
        return [];
      }
      return (fb.data ?? []).map((r) => normalizeWelfareCronRow(r as Record<string, unknown>));
    }
    console.error(LOG_PREFIX, "stores list", error.message);
    return [];
  }
  return (data ?? []).map((r) => normalizeWelfareCronRow(r as Record<string, unknown>));
}

function normalizeWelfareCronRow(r: Record<string, unknown>): WelfareCronStoreRow {
  const rh = r.regular_holidays;
  let regular_holidays: number[] | null = null;
  if (Array.isArray(rh)) {
    regular_holidays = [...new Set(rh.filter((n) => Number.isInteger(n) && n >= 0 && n <= 6))].sort(
      (a, b) => a - b
    );
  }
  return {
    id: String(r.id ?? ""),
    welfare_message_morning:
      typeof r.welfare_message_morning === "string" ? r.welfare_message_morning : null,
    welfare_message_midday:
      typeof r.welfare_message_midday === "string" ? r.welfare_message_midday : null,
    welfare_message_evening:
      typeof r.welfare_message_evening === "string" ? r.welfare_message_evening : null,
    regular_holidays,
  };
}

async function pushSegmentToStore(
  supabase: SupabaseClient,
  storeRow: WelfareCronStoreRow,
  segment: Segment
): Promise<{
  ok: boolean;
  recipients: number;
  error?: string;
  activeCastCount?: number;
}> {
  const storeId = storeRow.id;
  const resolved = await fetchResolvedLineChannelAccessTokenForStore(supabase, storeId, LOG_PREFIX);
  if (!resolved?.token) {
    console.error(
      `${LOG_PREFIX} segment=${segment} storeId=${storeId} skip=no_line_token (LINE channel access token missing or invalid)`
    );
    return { ok: false, recipients: 0, error: "no_line_token" };
  }

  const { data: castRows, error: castErr } = await supabase
    .from("casts")
    .select("line_user_id")
    .eq("store_id", storeId)
    .eq("is_active", true);

  if (castErr) {
    console.error(
      `${LOG_PREFIX} segment=${segment} storeId=${storeId} casts_query_failed message=${castErr.message} code=${castErr.code ?? ""}`
    );
    return { ok: false, recipients: 0, error: castErr.message };
  }

  const rows = castRows ?? [];
  const activeCastCount = rows.length;
  const ids = rows
    .map((r: { line_user_id?: string | null }) => r.line_user_id)
    .filter((id): id is string => !!id && id.trim() !== "");

  if (ids.length === 0) {
    console.warn(
      `${LOG_PREFIX} segment=${segment} storeId=${storeId} recipients=0 reason=no_line_linked_users activeCastCount=${activeCastCount}`
    );
    return { ok: true, recipients: 0, activeCastCount };
  }

  let flex: ReturnType<typeof flexForSegment>;
  try {
    const lineCustomization = await fetchLineCustomizationForStore(supabase, storeId);
    flex = flexForSegment(segment, storeRow, lineCustomization.welfare);
  } catch (flexErr) {
    const msg = flexErr instanceof Error ? flexErr.message : String(flexErr);
    console.error(
      `${LOG_PREFIX} segment=${segment} storeId=${storeId} FLEX_BUILD_FAILED message=${msg}`
    );
    return { ok: false, recipients: 0, error: `flex_build: ${msg}`, activeCastCount };
  }

  const chunkSize = 500;
  let sentTotal = 0;
  const chunkErrors: string[] = [];
  const numChunks = Math.ceil(ids.length / chunkSize);

  for (let i = 0; i < ids.length; i += chunkSize) {
    const chunk = ids.slice(i, i + chunkSize);
    const chunkIdx = Math.floor(i / chunkSize) + 1;
    try {
      await sendMulticastMessage(chunk, resolved.token, [flex]);
      sentTotal += chunk.length;
      console.info(
        `${LOG_PREFIX} segment=${segment} storeId=${storeId} multicast_ok chunk=${chunkIdx}/${numChunks} size=${chunk.length}`
      );
    } catch (sendErr) {
      const msg = sendErr instanceof Error ? sendErr.message : String(sendErr);
      chunkErrors.push(`chunk ${chunkIdx}/${numChunks} (${chunk.length} users): ${msg}`);
      console.error(
        `${LOG_PREFIX} segment=${segment} storeId=${storeId} LINE_MULTICAST_CHUNK_FAILED chunk=${chunkIdx}/${numChunks} size=${chunk.length} message=${msg}`
      );
    }
  }

  if (sentTotal === 0) {
    const joined = chunkErrors.join(" | ");
    console.error(
      `${LOG_PREFIX} segment=${segment} storeId=${storeId} LINE_MULTICAST_ALL_CHUNKS_FAILED attemptedRecipients=${ids.length} details=${joined}`
    );
    return {
      ok: false,
      recipients: 0,
      error: `line_multicast: ${joined || "all chunks failed"}`,
      activeCastCount,
    };
  }

  if (chunkErrors.length > 0) {
    console.warn(
      `${LOG_PREFIX} segment=${segment} storeId=${storeId} multicast_partial_success sent=${sentTotal}/${ids.length} failures=${chunkErrors.length}`
    );
    return {
      ok: true,
      recipients: sentTotal,
      activeCastCount,
      error: `partial: ${chunkErrors.join("; ")}`,
    };
  }

  console.info(
    `${LOG_PREFIX} segment=${segment} storeId=${storeId} push_complete recipients=${sentTotal} activeCastCount=${activeCastCount}`
  );
  return { ok: true, recipients: sentTotal, activeCastCount };
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

    const { url, key } = getSupabaseKeys();
    if (!url || !key) {
      return NextResponse.json({ error: "Supabase configuration missing" }, { status: 500 });
    }

    const supabase = createClient(url, key);
    const sp = new URL(request.url).searchParams;
    const segment = parseSegment(sp.get("segment"));
    if (!segment) {
      return NextResponse.json(
        { error: "segment is required (morning|midday|evening)" },
        { status: 400 }
      );
    }

    const storeIdRaw = sp.get("storeId")?.trim() ?? "";
    const singleStoreId =
      storeIdRaw && isValidStoreId(storeIdRaw) ? storeIdRaw.toLowerCase() : null;

    const stores = await fetchWelfareStores(supabase, singleStoreId);
    const results: {
      storeId: string;
      recipients: number;
      error?: string;
      activeCastCount?: number;
    }[] = [];
    const todayJst = getTodayJst();

    console.info(
      `${LOG_PREFIX} run_begin segment=${segment} todayJst=${todayJst} weekdayJst=${getWeekdayJst(todayJst)} storeCount=${stores.length} singleStoreId=${singleStoreId ?? "null"}`
    );

    if (stores.length === 0) {
      console.warn(
        `${LOG_PREFIX} segment=${segment} no_welfare_b_stores (business_type=welfare_b の店舗が0件、または storeId 指定が不正)`
      );
    }

    for (const s of stores) {
      try {
        if (isRegularHolidayDay(s.regular_holidays, todayJst)) {
          results.push({
            storeId: s.id,
            recipients: 0,
            error: "regular_holiday",
          });
          console.info(
            `${LOG_PREFIX} segment=${segment} storeId=${s.id} skipped=regular_holiday weekday=${getWeekdayJst(todayJst)} regular_holidays=${JSON.stringify(s.regular_holidays ?? [])}`
          );
          continue;
        }
        const r = await pushSegmentToStore(supabase, s, segment);
        results.push({
          storeId: s.id,
          recipients: r.recipients,
          error: r.error,
          activeCastCount: r.activeCastCount,
        });
        const statusLine = `${LOG_PREFIX} segment=${segment} storeId=${s.id} ok=${r.ok} recipients=${r.recipients} activeCastCount=${r.activeCastCount ?? "n/a"} error=${r.error ?? "none"}`;
        if (r.ok && r.recipients === 0 && !r.error) {
          console.warn(`${statusLine} (note: 0 recipients may mean no LINE-linked active casts)`);
        } else if (!r.ok) {
          console.error(statusLine);
        } else if (r.error?.startsWith("partial:")) {
          console.warn(statusLine);
        } else {
          console.info(statusLine);
        }
      } catch (storeErr) {
        const msg = storeErr instanceof Error ? storeErr.message : String(storeErr);
        console.error(
          `${LOG_PREFIX} segment=${segment} storeId=${s.id} STORE_ITERATION_UNCAUGHT message=${msg}`
        );
        results.push({
          storeId: s.id,
          recipients: 0,
          error: `uncaught: ${msg}`,
        });
      }
    }

    const anyHardFailure = results.some((row) => {
      const e = row.error ?? "";
      return e !== "" && e !== "regular_holiday" && !e.startsWith("partial:");
    });
    const anyPartial = results.some((row) => row.error?.startsWith("partial:"));

    return NextResponse.json({
      ok: !anyHardFailure,
      segment,
      storeCount: stores.length,
      results,
      ...(anyPartial ? { warning: "one_or_more_multicast_chunks_failed_see_results" } : {}),
    });
  } catch (e) {
    console.error(LOG_PREFIX, e);
    return NextResponse.json(
      { error: "Internal error", details: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}

/** Cloud Scheduler が POST のジョブでも 405 にならないよう GET と同等処理 */
export async function POST(request: Request) {
  return GET(request);
}
