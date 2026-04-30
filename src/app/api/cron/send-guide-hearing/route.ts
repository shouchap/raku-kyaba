import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type CronResult = {
  storeId: string;
  sent: number;
  skipped?: string;
  error?: string;
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
    const { buildGuideTargetSelectMessage, resolveBusinessDateFromJst } = await import(
      "@/lib/guide-hearing"
    );
    const { sendPushMessage } = await import("@/lib/line-reply");
    const { fetchResolvedLineChannelAccessTokenForStore } = await import("@/lib/line-channel-token");

    const supabase = createClient(supabaseUrl, supabaseKey);
    const businessDate = resolveBusinessDateFromJst();

    const { data: stores, error } = await supabase
      .from("stores")
      .select("id, name, guide_hearing_time, last_guide_hearing_sent_date");

    if (error || !stores) {
      console.error("[CRON] stores fetch failed:", {
        message: error?.message,
        details: error?.details,
        hint: error?.hint,
        code: error?.code,
      });
      return NextResponse.json(
        {
          error: "DB Error",
          message: error?.message,
          details: error?.details,
          hint: error?.hint,
          code: error?.code,
        },
        { status: 500 }
      );
    }

    const targetStores = stores.filter(
      (store) =>
        store.guide_hearing_time &&
        store.guide_hearing_time.startsWith(currentHour + ":") &&
        store.last_guide_hearing_sent_date !== businessDate
    );

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

      // 新スキーマ（guide_hearing_reporter_id / guide_staff_names）が使える場合は優先
      const { data: configStore, error: configErr } = await supabase
        .from("stores")
        .select("guide_hearing_reporter_id, guide_staff_names")
        .eq("id", store.id)
        .maybeSingle();

      if (!configErr && configStore) {
        reporterId =
          typeof configStore.guide_hearing_reporter_id === "string"
            ? configStore.guide_hearing_reporter_id
            : null;
        staffNames = Array.isArray(configStore.guide_staff_names)
          ? configStore.guide_staff_names.map((name: unknown) => String(name ?? "").trim()).filter(Boolean)
          : [];
      } else {
        // 旧スキーマ互換フォールバック（casts.is_guide_target / is_admin）
        if (configErr) {
          console.warn("[CRON] stores config columns unavailable, fallback to casts:", {
            storeId: store.id,
            message: configErr.message,
            code: configErr.code,
          });
        }
        const { data: castTargets, error: castTargetErr } = await supabase
          .from("casts")
          .select("name, is_admin, is_guide_target, line_user_id")
          .eq("store_id", store.id)
          .eq("is_active", true);
        if (castTargetErr) {
          results.push({
            storeId: store.id,
            sent: 0,
            skipped: "config_fetch_failed",
            error: castTargetErr.message,
          });
          continue;
        }
        const rows = castTargets ?? [];
        staffNames = rows
          .filter((r) => r.is_guide_target === true)
          .map((r) => String(r.name ?? "").trim())
          .filter(Boolean);
        const adminCandidate = rows.find((r) => r.is_admin === true && !!r.line_user_id);
        if (adminCandidate?.line_user_id) {
          const { data: reporterCast } = await supabase
            .from("casts")
            .select("id")
            .eq("store_id", store.id)
            .eq("line_user_id", adminCandidate.line_user_id)
            .maybeSingle();
          reporterId = reporterCast?.id ?? null;
        }
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
