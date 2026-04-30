export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type CronResult = {
  storeId: string;
  sent: number;
  skipped?: string;
  error?: string;
};

async function runGuideHearingCron(request: Request): Promise<Response> {
  try {
    // 1) 認証（CRON_SECRET が設定されている場合のみ）
    const cronSecret = process.env.CRON_SECRET?.trim() ?? "";
    if (cronSecret) {
      const authHeader = request.headers.get("authorization");
      if (authHeader?.trim() !== `Bearer ${cronSecret}`) {
        return Response.json({ error: "Unauthorized" }, { status: 401 });
      }
    }

    // 2) 必須ENVの遅延評価
    const supabaseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL)?.trim() ?? "";
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? "";
    const missingEnv: string[] = [];
    if (!supabaseUrl) missingEnv.push("NEXT_PUBLIC_SUPABASE_URL or SUPABASE_URL");
    if (!serviceRoleKey) missingEnv.push("SUPABASE_SERVICE_ROLE_KEY");
    if (missingEnv.length > 0) {
      return Response.json(
        {
          ok: false,
          error: "required environment variables are missing",
          missingEnv,
        },
        { status: 500 }
      );
    }

    // 3) 依存モジュールはすべて実行時 import
    const { createClient } = await import("@supabase/supabase-js");
    const guideLib = await import("@/lib/guide-hearing");
    const lineReplyLib = await import("@/lib/line-reply");
    const lineTokenLib = await import("@/lib/line-channel-token");

    const supabase = createClient(supabaseUrl, serviceRoleKey);
    const hourJst = guideLib.getCurrentHourJst();
    const businessDate = guideLib.resolveBusinessDateFromJst();

    const { data: stores, error: storeErr } = await supabase
      .from("stores")
      .select(
        "id, name, guide_hearing_enabled, guide_hearing_time, guide_hearing_reporter_id, guide_staff_names, line_channel_access_token, last_guide_hearing_sent_date"
      )
      .eq("guide_hearing_enabled", true);

    if (storeErr) {
      return Response.json(
        { ok: false, error: "failed to fetch stores", details: storeErr.message },
        { status: 500 }
      );
    }

    const results: CronResult[] = [];

    for (const store of stores ?? []) {
      const targetHour = guideLib.parseGuideHearingHour(store.guide_hearing_time);
      if (targetHour === null || targetHour !== hourJst) {
        results.push({ storeId: store.id, sent: 0, skipped: "hour_mismatch" });
        continue;
      }
      if (store.last_guide_hearing_sent_date === businessDate) {
        results.push({ storeId: store.id, sent: 0, skipped: "already_sent" });
        continue;
      }

      const token = await lineTokenLib.fetchResolvedLineChannelAccessTokenForStore(
        supabase,
        store.id,
        "[GuideCron]"
      );
      if (!token?.token) {
        results.push({ storeId: store.id, sent: 0, skipped: "no_line_token" });
        continue;
      }

      if (!store.guide_hearing_reporter_id) {
        results.push({ storeId: store.id, sent: 0, skipped: "no_reporter" });
        continue;
      }

      const staffNames = Array.isArray(store.guide_staff_names)
        ? store.guide_staff_names.map((v: unknown) => String(v ?? "").trim()).filter(Boolean)
        : [];
      if (staffNames.length === 0) {
        results.push({ storeId: store.id, sent: 0, skipped: "no_targets" });
        continue;
      }

      const { data: reporter, error: reporterErr } = await supabase
        .from("casts")
        .select("id, line_user_id")
        .eq("id", store.guide_hearing_reporter_id)
        .eq("store_id", store.id)
        .eq("is_active", true)
        .maybeSingle();

      if (reporterErr || !reporter?.id || !reporter.line_user_id) {
        results.push({ storeId: store.id, sent: 0, skipped: "invalid_reporter" });
        continue;
      }

      try {
        await lineReplyLib.sendPushMessage(reporter.line_user_id, token.token, [
          guideLib.buildGuideTargetSelectMessage({
            storeName: store.name,
            staffNames,
          }),
        ]);

        const { error: updateErr } = await supabase
          .from("stores")
          .update({
            last_guide_hearing_sent_date: businessDate,
            updated_at: new Date().toISOString(),
          })
          .eq("id", store.id);

        if (updateErr) {
          console.error("[GuideCron] failed to update last_guide_hearing_sent_date:", {
            storeId: store.id,
            message: updateErr.message,
          });
        }

        results.push({ storeId: store.id, sent: 1 });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error("[GuideCron] send failed:", { storeId: store.id, message });
        results.push({
          storeId: store.id,
          sent: 0,
          skipped: "send_failed",
          error: message,
        });
      }
    }

    return Response.json({ ok: true, hourJst, businessDate, results });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;
    console.error("[GuideCron] fatal error:", {
      message,
      stack,
      method: request.method,
      url: request.url,
    });
    return Response.json(
      {
        ok: false,
        error: "guide hearing cron failed",
        details: message,
      },
      { status: 500 }
    );
  }
}

export async function GET(request: Request) {
  return runGuideHearingCron(request);
}

export async function POST(request: Request) {
  return runGuideHearingCron(request);
}
