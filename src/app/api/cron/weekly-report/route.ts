import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase-service";
import { getCurrentTimeJstString, getTodayJst, getWeekdayJst } from "@/lib/date-utils";
import { sendWeeklyReportForStore } from "@/lib/weekly-report-send";
import { isUndefinedColumnError, logPostgrestError } from "@/lib/postgrest-error";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type StoreCronRow = {
  id: string;
  name: string | null;
  weekly_report_enabled: boolean;
  weekly_report_day: number;
  weekly_report_time: string;
};

function normalizeWeeklyTimeHm(raw: string | null | undefined): string {
  const t = String(raw ?? "").trim();
  const m = t.match(/^(\d{1,2}):(\d{2})/);
  if (!m) return "";
  const h = Math.min(23, Math.max(0, parseInt(m[1], 10)));
  const min = Math.min(59, Math.max(0, parseInt(m[2], 10)));
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
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

    const admin = createServiceRoleClient();
    const todayYmd = getTodayJst();
    const dow = getWeekdayJst(todayYmd);
    const nowHm = normalizeWeeklyTimeHm(getCurrentTimeJstString());

    const storeRes = await admin
      .from("stores")
      .select("id, name, weekly_report_enabled, weekly_report_day, weekly_report_time")
      .eq("weekly_report_enabled", true);

    if (storeRes.error) {
      if (isUndefinedColumnError(storeRes.error, "weekly_report_enabled")) {
        console.warn("[cron/weekly-report] weekly_report_* 未適用（049）。対象店舗なし。");
        return NextResponse.json({
          ok: true,
          skipped: "migration_049_not_applied",
          today: todayYmd,
          dow,
          nowHm,
          results: [],
        });
      }
      logPostgrestError("cron/weekly-report stores", storeRes.error);
      return NextResponse.json(
        { ok: false, error: storeRes.error.message },
        { status: 500 }
      );
    }

    const rows = (storeRes.data ?? []) as StoreCronRow[];

    const candidates = rows.filter(
      (s) => Number.isInteger(s.weekly_report_day) && s.weekly_report_day === dow
    );

    const results: Array<{
      storeId: string;
      name: string | null;
      sent?: boolean;
      skipped?: string;
      chunkCount?: number;
      error?: string;
    }> = [];

    for (const s of candidates) {
      const slotTime = normalizeWeeklyTimeHm(s.weekly_report_time);
      if (slotTime !== nowHm || slotTime === "") continue;

      const sendRes = await sendWeeklyReportForStore(admin, {
        storeId: s.id,
        sendDateYmd: todayYmd,
        skipIdempotency: false,
        logPrefix: "[cron/weekly-report]",
      });

      if (!sendRes.ok) {
        results.push({
          storeId: s.id,
          name: s.name,
          sent: false,
          error: sendRes.error,
        });
        continue;
      }

      if (sendRes.skipped) {
        results.push({
          storeId: s.id,
          name: s.name,
          sent: false,
          skipped: sendRes.skipped,
          chunkCount: sendRes.chunkCount,
        });
        continue;
      }

      results.push({
        storeId: s.id,
        name: s.name,
        sent: true,
        chunkCount: sendRes.chunkCount,
      });
    }

    return NextResponse.json({
      ok: true,
      today: todayYmd,
      dow,
      nowHm,
      candidateDayCount: candidates.length,
      processedCount: results.length,
      results,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[cron/weekly-report]", e);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  return GET(request);
}
