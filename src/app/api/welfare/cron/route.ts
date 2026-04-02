/**
 * B型事業所（welfare_b）向け定期配信（Cloud Scheduler 等から GET）
 *
 * GET /api/welfare/cron?segment=morning|midday|evening
 * - morning: 9:00 作業開始
 * - midday: 12:00 体調確認
 * - evening: 17:00 作業終了
 *
 * 認証: CRON_SECRET 設定時は Authorization: Bearer <CRON_SECRET>
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

function flexForSegment(seg: Segment, row: WelfareCronStoreRow) {
  switch (seg) {
    case "morning":
      return buildWelfareMorningStartFlexMessage(row.welfare_message_morning);
    case "midday":
      return buildWelfareMiddayHealthFlexMessage(row.welfare_message_midday);
    case "evening":
      return buildWelfareEveningEndFlexMessage(row.welfare_message_evening);
    default:
      return buildWelfareMorningStartFlexMessage(row.welfare_message_morning);
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
): Promise<{ ok: boolean; recipients: number; error?: string }> {
  const storeId = storeRow.id;
  const resolved = await fetchResolvedLineChannelAccessTokenForStore(supabase, storeId, LOG_PREFIX);
  if (!resolved?.token) {
    return { ok: false, recipients: 0, error: "no_line_token" };
  }

  const { data: casts, error: castErr } = await supabase
    .from("casts")
    .select("line_user_id")
    .eq("store_id", storeId)
    .eq("is_active", true)
    .not("line_user_id", "is", null);

  if (castErr) {
    console.error(LOG_PREFIX, "casts", storeId, castErr.message);
    return { ok: false, recipients: 0, error: castErr.message };
  }

  const ids = (casts ?? [])
    .map((r: { line_user_id?: string | null }) => r.line_user_id)
    .filter((id): id is string => !!id && id.trim() !== "");

  if (ids.length === 0) {
    return { ok: true, recipients: 0 };
  }

  const flex = flexForSegment(segment, storeRow);
  const chunkSize = 500;
  for (let i = 0; i < ids.length; i += chunkSize) {
    const chunk = ids.slice(i, i + chunkSize);
    await sendMulticastMessage(chunk, resolved.token, [flex]);
  }

  return { ok: true, recipients: ids.length };
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
    const results: { storeId: string; recipients: number; error?: string }[] = [];
    const todayJst = getTodayJst();

    for (const s of stores) {
      if (isRegularHolidayDay(s.regular_holidays, todayJst)) {
        results.push({
          storeId: s.id,
          recipients: 0,
          error: "regular_holiday",
        });
        console.info(
          `${LOG_PREFIX} segment=${segment} storeId=${s.id} skipped=regular_holiday weekday=${getWeekdayJst(todayJst)}`
        );
        continue;
      }
      const r = await pushSegmentToStore(supabase, s, segment);
      results.push({
        storeId: s.id,
        recipients: r.recipients,
        error: r.error,
      });
      console.info(
        `${LOG_PREFIX} segment=${segment} storeId=${s.id} recipients=${r.recipients} ok=${r.ok}`
      );
    }

    return NextResponse.json({
      ok: true,
      segment,
      storeCount: stores.length,
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
