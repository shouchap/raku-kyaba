/**
 * B型事業所（welfare_b）向け「作業開始 未打刻アラート」
 *
 * 12:00 時点で当日の「作業開始」を押していない利用者を抽出し、
 * 店舗の LINE 公式アカウントから管理者へ名前を列挙して通知する。
 * キャバクラ・バー業態の未返信アラート（/api/remind/warn-unanswered）の welfare_b 版。
 *
 * GET / POST /api/welfare/warn-unstarted
 * - 対象: business_type = welfare_b の全店舗（?storeId=uuid でその店のみ）
 * - 利用者: casts の is_active = true（管理者アカウントは除く）。出勤予定の有無は見ない
 * - 未打刻判定: welfare_daily_logs に当日行が無い、または started_at が NULL
 * - 欠席・体調不良の連絡があっても、作業開始が押されていなければ一覧に含める
 * - stores.regular_holidays に今日の曜日（JST）が含まれる店舗はスキップ
 * - 同日中の重複送信は system_settings で抑止（?force=1 で無視）
 *
 * 認証: CRON_SECRET 設定時は Authorization: Bearer <CRON_SECRET>
 */

import { NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  fetchUnstartedCastNames,
  sendUnstartedAlertToAdmins,
} from "@/lib/welfare-unstarted-alert";
import { isValidStoreId } from "@/lib/current-store";
import { isUndefinedColumnError } from "@/lib/postgrest-error";
import { getTodayJst, getWeekdayJst } from "@/lib/date-utils";

export const dynamic = "force-dynamic";

const LOG_PREFIX = "[WelfareWarnUnstarted]";

/** 重複送信を抑止するための状態を保存する system_settings のキー */
const WARN_STATE_KEY = "welfare_unstarted_warn_state";

type WelfareStoreRow = {
  id: string;
  /** 定休日（0=日〜6=土）。未設定・空はスキップしない */
  regular_holidays: number[] | null;
};

type StoreResult = {
  storeId: string;
  unstartedCount: number;
  notified: boolean;
  skipped?: string;
  error?: string;
};

function getSupabaseKeys(): { url: string | null; key: string | null } {
  const url =
    (process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL)?.trim() ?? null;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? null;
  return { url, key };
}

function isRegularHolidayDay(
  regularHolidays: number[] | null | undefined,
  todayJst: string
): boolean {
  const arr = Array.isArray(regularHolidays) ? regularHolidays : [];
  if (arr.length === 0) return false;
  return arr.includes(getWeekdayJst(todayJst));
}

function normalizeRegularHolidays(raw: unknown): number[] | null {
  if (!Array.isArray(raw)) return null;
  return [...new Set(raw.filter((n) => Number.isInteger(n) && n >= 0 && n <= 6))].sort(
    (a, b) => a - b
  );
}

async function fetchWelfareStores(
  supabase: SupabaseClient,
  singleStoreId: string | null
): Promise<WelfareStoreRow[]> {
  const applyFilters = (columns: string) => {
    const q = supabase.from("stores").select(columns).eq("business_type", "welfare_b");
    return singleStoreId ? q.eq("id", singleStoreId) : q;
  };

  let { data, error } = await applyFilters("id, regular_holidays");

  if (error && isUndefinedColumnError(error, "regular_holidays")) {
    console.warn(
      `${LOG_PREFIX} stores.regular_holidays 未適用。定休スキップなしで続行します。`
    );
    const retry = await applyFilters("id");
    data = retry.data as typeof data;
    error = retry.error;
  }

  if (error) {
    console.error(LOG_PREFIX, "stores fetch", error.message);
    return [];
  }

  return ((data ?? []) as unknown as Record<string, unknown>[])
    .map((r) => ({
      id: String(r.id ?? ""),
      regular_holidays: normalizeRegularHolidays(r.regular_holidays),
    }))
    .filter((r) => r.id !== "");
}

/** 同じ日に二重送信しないための記録を読む */
async function getLastWarnedDate(
  supabase: SupabaseClient,
  storeId: string
): Promise<string | null> {
  const { data } = await supabase
    .from("system_settings")
    .select("value")
    .eq("store_id", storeId)
    .eq("key", WARN_STATE_KEY)
    .maybeSingle();

  const value = (data?.value ?? {}) as Record<string, unknown>;
  const last = value.last_warned_date;
  return typeof last === "string" && last.trim() !== "" ? last : null;
}

async function setLastWarnedDate(
  supabase: SupabaseClient,
  storeId: string,
  date: string
): Promise<void> {
  const { error } = await supabase.from("system_settings").upsert(
    {
      store_id: storeId,
      key: WARN_STATE_KEY,
      value: { last_warned_date: date },
    },
    { onConflict: "store_id,key" }
  );

  if (error) {
    console.warn(`${LOG_PREFIX} storeId=${storeId} 送信記録の保存に失敗: ${error.message}`);
  }
}

async function warnStore(
  supabase: SupabaseClient,
  store: WelfareStoreRow,
  today: string,
  force: boolean
): Promise<StoreResult> {
  const storeId = store.id;

  if (isRegularHolidayDay(store.regular_holidays, today)) {
    return { storeId, unstartedCount: 0, notified: false, skipped: "regular_holiday" };
  }

  if (!force && (await getLastWarnedDate(supabase, storeId)) === today) {
    return { storeId, unstartedCount: 0, notified: false, skipped: "already_warned_today" };
  }

  const names = await fetchUnstartedCastNames(supabase, storeId, today);
  if (names.length === 0) {
    return { storeId, unstartedCount: 0, notified: false, skipped: "all_started" };
  }

  const sent = await sendUnstartedAlertToAdmins(supabase, storeId, names, LOG_PREFIX);
  if (!sent.ok) {
    const error = sent.detail ? `${sent.reason}: ${sent.detail}` : sent.reason;
    console.error(`${LOG_PREFIX} storeId=${storeId} 送信できませんでした error=${error}`);
    return { storeId, unstartedCount: names.length, notified: false, error };
  }

  await setLastWarnedDate(supabase, storeId, today);
  console.info(
    `${LOG_PREFIX} storeId=${storeId} notified unstarted=${names.length} recipients=${sent.recipients}`
  );
  return { storeId, unstartedCount: names.length, notified: true };
}

export async function GET(request: Request) {
  try {
    const cronSecret = process.env.CRON_SECRET;
    if (cronSecret && cronSecret.trim() !== "") {
      const authHeader = request.headers.get("authorization");
      if (authHeader?.trim() !== `Bearer ${cronSecret.trim()}`) {
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
    const storeIdRaw = sp.get("storeId")?.trim() ?? "";
    const singleStoreId =
      storeIdRaw && isValidStoreId(storeIdRaw) ? storeIdRaw.toLowerCase() : null;
    const force = sp.get("force") === "1";

    const today = getTodayJst();
    const stores = await fetchWelfareStores(supabase, singleStoreId);

    console.info(
      `${LOG_PREFIX} run_begin todayJst=${today} storeCount=${stores.length} singleStoreId=${singleStoreId ?? "null"} force=${force}`
    );

    const results: StoreResult[] = [];
    for (const store of stores) {
      try {
        results.push(await warnStore(supabase, store, today, force));
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`${LOG_PREFIX} storeId=${store.id} uncaught message=${msg}`);
        results.push({
          storeId: store.id,
          unstartedCount: 0,
          notified: false,
          error: `uncaught: ${msg}`,
        });
      }
    }

    return NextResponse.json({
      ok: !results.some((r) => r.error),
      date: today,
      storeCount: stores.length,
      notifiedStores: results.filter((r) => r.notified).length,
      results,
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
