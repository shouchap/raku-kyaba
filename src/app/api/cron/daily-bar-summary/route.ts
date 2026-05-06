import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceRoleClient } from "@/lib/supabase-service";
import { getTodayJst } from "@/lib/date-utils";
import { sendMulticastMessage } from "@/lib/line-reply";
import { fetchResolvedLineChannelAccessTokenForStore } from "@/lib/line-channel-token";
import { isUndefinedColumnError, logPostgrestError } from "@/lib/postgrest-error";
import { generateDailyBarSummaryForStore } from "@/lib/daily-bar-summary";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type StoreRow = { id: string; name: string | null; attendance_flow_type?: string | null };

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

      const generated = await generateDailyBarSummaryForStore(admin, storeId, dateYmd);
      if (!generated.ok) {
        results.push({ storeId, name: store.name, sent: false, error: generated.error });
        continue;
      }

      for (const chunk of generated.chunks) {
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
