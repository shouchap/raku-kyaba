import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { sendPushMessage } from "@/lib/line-reply";
import { fetchResolvedLineChannelAccessTokenForStore } from "@/lib/line-channel-token";
import {
  buildGuideTargetSelectMessage,
  getCurrentHourJst,
  parseGuideHearingHour,
  resolveBusinessDateFromJst,
} from "@/lib/guide-hearing";

export const dynamic = "force-dynamic";

function getSupabaseClient() {
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL)?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) return null;
  return createClient(url, key);
}

function checkCronAuth(request: Request): NextResponse | null {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return null;
  const authHeader = request.headers.get("authorization");
  if (authHeader?.trim() !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}

export async function GET(request: Request) {
  const authRes = checkCronAuth(request);
  if (authRes) return authRes;

  const supabase = getSupabaseClient();
  if (!supabase) {
    return NextResponse.json({ error: "Supabase configuration missing" }, { status: 500 });
  }

  const hourJst = getCurrentHourJst();
  const businessDate = resolveBusinessDateFromJst();

  const { data: stores, error: storeErr } = await supabase
    .from("stores")
    .select(
      "id, name, guide_hearing_enabled, guide_hearing_time, guide_hearing_reporter_id, guide_staff_names, line_channel_access_token, last_guide_hearing_sent_date"
    )
    .eq("guide_hearing_enabled", true);

  if (storeErr) {
    return NextResponse.json({ error: storeErr.message }, { status: 500 });
  }

  const results: Array<{
    storeId: string;
    sent: number;
    skipped?: string;
    error?: string;
  }> = [];

  for (const store of stores ?? []) {
    const targetHour = parseGuideHearingHour(store.guide_hearing_time);
    if (targetHour === null || targetHour !== hourJst) {
      results.push({ storeId: store.id, sent: 0, skipped: "hour_mismatch" });
      continue;
    }
    if (store.last_guide_hearing_sent_date === businessDate) {
      results.push({ storeId: store.id, sent: 0, skipped: "already_sent" });
      continue;
    }

    const token = await fetchResolvedLineChannelAccessTokenForStore(supabase, store.id, "[GuideCron]");
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
      await sendPushMessage(reporter.line_user_id, token.token, [
        buildGuideTargetSelectMessage({
          storeName: store.name,
          staffNames,
        }),
      ]);

      const sent = 1;

      if (sent > 0) {
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
      }

      results.push({ storeId: store.id, sent });
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

  return NextResponse.json({ ok: true, hourJst, businessDate, results });
}

export async function POST(request: Request) {
  return GET(request);
}
