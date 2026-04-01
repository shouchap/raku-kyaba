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

function flexForSegment(seg: Segment) {
  switch (seg) {
    case "morning":
      return buildWelfareMorningStartFlexMessage();
    case "midday":
      return buildWelfareMiddayHealthFlexMessage();
    case "evening":
      return buildWelfareEveningEndFlexMessage();
    default:
      return buildWelfareMorningStartFlexMessage();
  }
}

async function fetchWelfareStores(
  supabase: SupabaseClient,
  singleStoreId: string | null
): Promise<{ id: string }[]> {
  if (singleStoreId) {
    const { data, error } = await supabase
      .from("stores")
      .select("id")
      .eq("id", singleStoreId)
      .eq("business_type", "welfare_b")
      .maybeSingle();
    if (error) {
      console.error(LOG_PREFIX, "single store fetch", error.message);
      return [];
    }
    return data?.id ? [{ id: data.id }] : [];
  }

  const { data, error } = await supabase
    .from("stores")
    .select("id")
    .eq("business_type", "welfare_b");

  if (error) {
    console.error(LOG_PREFIX, "stores list", error.message);
    return [];
  }
  return (data ?? []) as { id: string }[];
}

async function pushSegmentToStore(
  supabase: SupabaseClient,
  storeId: string,
  segment: Segment
): Promise<{ ok: boolean; recipients: number; error?: string }> {
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

  const flex = flexForSegment(segment);
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

    for (const s of stores) {
      const r = await pushSegmentToStore(supabase, s.id, segment);
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
