import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type CronResult = {
  storeId: string;
  sent: number;
  skipped?: string;
  error?: string;
};

type StoreBaseRow = {
  id: string;
  name: string | null;
  business_type?: string | null;
  guidance_request_time?: string | null;
  guide_hearing_time: string | null;
  guide_hearing_enabled?: boolean;
  last_guide_hearing_sent_date?: string | null;
  is_guide_enabled?: boolean;
};

export async function GET(request: Request) {
  try {
    const authHeader = request.headers.get("authorization");
    const cronSecret = process.env.CRON_SECRET;
    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseKey) {
      return NextResponse.json({ error: "Missing config" }, { status: 500 });
    }

    const now = new Date();
    const jstTime = new Date(now.getTime() + 9 * 60 * 60 * 1000);
    const currentHour = jstTime.getUTCHours().toString().padStart(2, "0");
    const currentTimeStr = `${currentHour}:00`;

    const { createClient } = await import("@supabase/supabase-js");
    const {
      buildGuideTargetSelectMessage,
      resolveBusinessDateFromJst,
      resolveGuideHearingScheduleSlot,
    } = await import("@/lib/guide-hearing");
    const { sendPushMessage } = await import("@/lib/line-reply");
    const { fetchResolvedLineChannelAccessTokenForStore } = await import("@/lib/line-channel-token");

    const supabase = createClient(supabaseUrl, supabaseKey);
    const businessDate = resolveBusinessDateFromJst();

    let stores: StoreBaseRow[] = [];
    let storesHasLastSentDate = true;
    let storesHasIsGuideEnabled = true;
    /** フルスキーマ取得できたときのみ cabaret 限定・guide_hearing_enabled 判定を行う */
    let storesHasCabaretGuideCronColumns = true;
    /** guidance_request_time 列あり（053 以降） */
    let storesHasGuidanceRequestTime = true;

    const trySelect = async (cols: string) =>
      supabase.from("stores").select(cols);

    let sel =
      "id, name, business_type, guidance_request_time, guide_hearing_time, guide_hearing_enabled, last_guide_hearing_sent_date, is_guide_enabled";
    let storeFetch = await trySelect(sel);

    if (storeFetch.error?.code === "42703") {
      storesHasGuidanceRequestTime = false;
      sel =
        "id, name, business_type, guide_hearing_time, guide_hearing_enabled, last_guide_hearing_sent_date, is_guide_enabled";
      storeFetch = await trySelect(sel);
    }

    if (storeFetch.error?.code === "42703") {
      storesHasCabaretGuideCronColumns = false;
      sel = "id, name, guide_hearing_time, last_guide_hearing_sent_date, is_guide_enabled";
      storeFetch = await trySelect(sel);
    }

    if (storeFetch.error?.code === "42703") {
      storesHasIsGuideEnabled = false;
      sel = "id, name, guide_hearing_time, last_guide_hearing_sent_date";
      storeFetch = await trySelect(sel);
    }

    if (storeFetch.error?.code === "42703") {
      storesHasLastSentDate = false;
      sel = "id, name, guide_hearing_time";
      storeFetch = await trySelect(sel);
    }

    if (storeFetch.error || !storeFetch.data) {
      console.error("[CRON] stores fetch failed:", {
        message: storeFetch.error?.message,
        details: storeFetch.error?.details,
        hint: storeFetch.error?.hint,
        code: storeFetch.error?.code,
      });
      return NextResponse.json(
        {
          error: "DB Error",
          message: storeFetch.error?.message,
          details: storeFetch.error?.details,
          hint: storeFetch.error?.hint,
          code: storeFetch.error?.code,
        },
        { status: 500 }
      );
    }
    stores = storeFetch.data as unknown as StoreBaseRow[];

    const targetStores = stores.filter((store) => {
      if (storesHasIsGuideEnabled && store.is_guide_enabled === false) return false;
      if (storesHasCabaretGuideCronColumns) {
        if (String(store.business_type ?? "cabaret").trim() !== "cabaret") return false;
        if (store.guide_hearing_enabled !== true) return false;
      }
      const slot = resolveGuideHearingScheduleSlot(
        storesHasGuidanceRequestTime ? store.guidance_request_time : null,
        store.guide_hearing_time
      );
      return (
        !!slot &&
        slot.startsWith(`${currentHour}:`) &&
        (!storesHasLastSentDate || store.last_guide_hearing_sent_date !== businessDate)
      );
    });

    if (targetStores.length === 0) {
      return NextResponse.json({
        status: "skipped",
        hourJst: currentTimeStr,
        businessDate,
      });
    }

    let successCount = 0;
    const results: CronResult[] = [];

    for (const store of targetStores) {
      const token = await fetchResolvedLineChannelAccessTokenForStore(supabase, store.id, "[GuideCron]");
      if (!token?.token) {
        results.push({ storeId: store.id, sent: 0, skipped: "no_line_token" });
        continue;
      }

      let reporterId: string | null = null;
      let staffNames: string[] = [];

      // システム設定（guide_hearing_reporter_id / guide_staff_names）を唯一の送信元設定として扱う
      const { data: configStore, error: configErr } = await supabase
        .from("stores")
        .select("guide_hearing_reporter_id, guide_staff_names")
        .eq("id", store.id)
        .maybeSingle();

      if (configErr) {
        results.push({
          storeId: store.id,
          sent: 0,
          skipped: "config_fetch_failed",
          error: configErr.message,
        });
        continue;
      }

      if (configStore) {
        reporterId =
          typeof configStore.guide_hearing_reporter_id === "string"
            ? configStore.guide_hearing_reporter_id
            : null;
        staffNames = Array.isArray(configStore.guide_staff_names)
          ? configStore.guide_staff_names.map((name: unknown) => String(name ?? "").trim()).filter(Boolean)
          : [];
      }

      if (staffNames.length === 0) {
        console.warn(`[CRON] ${store.name} のスタッフ名が登録されていません`);
        results.push({ storeId: store.id, sent: 0, skipped: "no_targets" });
        continue;
      }

      if (!reporterId) {
        results.push({ storeId: store.id, sent: 0, skipped: "no_reporter" });
        continue;
      }

      const { data: reporter, error: reporterErr } = await supabase
        .from("casts")
        .select("id, line_user_id")
        .eq("id", reporterId)
        .eq("store_id", store.id)
        .eq("is_active", true)
        .maybeSingle();
      if (reporterErr || !reporter?.id || !reporter.line_user_id) {
        results.push({ storeId: store.id, sent: 0, skipped: "invalid_reporter" });
        continue;
      }

      try {
        await sendPushMessage(reporter.line_user_id, token.token, [
          buildGuideTargetSelectMessage({
            storeName: store.name,
            staffNames,
          }),
        ]);
        successCount++;
        results.push({ storeId: store.id, sent: 1 });

        if (storesHasLastSentDate) {
          const { error: updateErr } = await supabase
            .from("stores")
            .update({
              last_guide_hearing_sent_date: businessDate,
              updated_at: new Date().toISOString(),
            })
            .eq("id", store.id);
          if (updateErr) {
            console.error("[CRON] failed to update last_guide_hearing_sent_date:", updateErr.message);
          }
        }
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        console.error("LINE send error:", e);
        results.push({ storeId: store.id, sent: 0, skipped: "send_failed", error: message });
      }
    }

    return NextResponse.json({
      status: "ok",
      hourJst: currentTimeStr,
      businessDate,
      targetCount: targetStores.length,
      successCount,
      results,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[CRON] Critical Runtime Error:", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  return GET(request);
}
