import { NextResponse } from "next/server";
import { canUserEditStore, getAuthedUserForAdminApi } from "@/lib/admin-store-auth";
import { createServiceRoleClient } from "@/lib/supabase-service";
import { getTodayJst } from "@/lib/date-utils";
import { sendWeeklyReportForStore } from "@/lib/weekly-report-send";

/**
 * 週間レポートを時刻条件なしで管理者へ送信する（設定画面のテスト用）。
 */
export async function POST(request: Request) {
  const { user, error: authErr } = await getAuthedUserForAdminApi();
  if (authErr === "config") {
    return NextResponse.json({ error: "Supabase is not configured" }, { status: 500 });
  }
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as { storeId?: string } | null;
  const storeId = body?.storeId?.trim() ?? "";
  if (!storeId) return NextResponse.json({ error: "storeId is required" }, { status: 400 });
  if (!canUserEditStore(user, storeId)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const admin = createServiceRoleClient();
  const sendDateYmd = getTodayJst();

  const res = await sendWeeklyReportForStore(admin, {
    storeId,
    sendDateYmd,
    skipIdempotency: true,
    logPrefix: "[admin/weekly-report-test]",
  });

  if (!res.ok) {
    const status =
      res.error === "no_line_token"
        ? 400
        : res.error === "no_admin_recipients"
          ? 400
          : 500;
    return NextResponse.json({ ok: false, error: res.error }, { status });
  }

  return NextResponse.json({
    ok: true,
    sendDateYmd,
    chunkCount: res.chunkCount,
    skipped: res.skipped ?? null,
  });
}
