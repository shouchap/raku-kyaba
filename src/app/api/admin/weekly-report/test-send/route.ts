import { NextResponse } from "next/server";
import { canUserEditStore, getAuthedUserForAdminApi } from "@/lib/admin-store-auth";
import { createServiceRoleClient } from "@/lib/supabase-service";
import { getTodayJst } from "@/lib/date-utils";
import { sendWeeklyReportForStore } from "@/lib/weekly-report-send";
import { sendPushMessage } from "@/lib/line-reply";
import { fetchResolvedLineChannelAccessTokenForStore } from "@/lib/line-channel-token";
import { buildWeeklyReportBody, chunkWeeklyReportBody } from "@/lib/line-weekly-report";
import { loadWeeklyReportBuildInput } from "@/lib/weekly-report-data";
import { isValidStoreId } from "@/lib/current-store";

/**
 * 週間レポートを時刻条件なしで管理者へ送信する（設定画面のテスト用）。
 */
export async function POST(request: Request) {
  const { user, error: authErr } = await getAuthedUserForAdminApi();
  if (authErr === "config") {
    return NextResponse.json({ error: "Supabase is not configured" }, { status: 500 });
  }
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as { storeId?: string; castId?: string } | null;
  const storeId = body?.storeId?.trim() ?? "";
  const castId = body?.castId?.trim() ?? "";
  if (!storeId) return NextResponse.json({ error: "storeId is required" }, { status: 400 });
  if (castId && !isValidStoreId(castId)) {
    return NextResponse.json({ error: "castId is invalid" }, { status: 400 });
  }
  if (!canUserEditStore(user, storeId)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const admin = createServiceRoleClient();
  const sendDateYmd = getTodayJst();

  if (castId) {
    const { data: cast } = await admin
      .from("casts")
      .select("id, name, line_user_id")
      .eq("id", castId)
      .eq("store_id", storeId)
      .eq("is_active", true)
      .maybeSingle();
    if (!cast?.id) return NextResponse.json({ error: "Cast not found" }, { status: 404 });
    if (!cast.line_user_id) {
      return NextResponse.json({ error: "選択したキャストはLINE未連携です" }, { status: 400 });
    }

    const tokenPack = await fetchResolvedLineChannelAccessTokenForStore(
      admin,
      storeId,
      "[admin/weekly-report-test-individual]"
    );
    if (!tokenPack?.token) {
      return NextResponse.json({ error: "LINEチャネルトークンが未設定です" }, { status: 400 });
    }

    const loaded = await loadWeeklyReportBuildInput(admin, { storeId, sendDateYmd });
    if (!loaded.ok) {
      return NextResponse.json({ ok: false, error: loaded.error }, { status: 500 });
    }
    const chunks = chunkWeeklyReportBody(buildWeeklyReportBody(loaded.input));
    try {
      for (const chunk of chunks) {
        await sendPushMessage(cast.line_user_id, tokenPack.token, [{ type: "text", text: chunk }]);
      }
    } catch (e) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : "LINE送信に失敗しました" },
        { status: 502 }
      );
    }

    return NextResponse.json({
      ok: true,
      sendDateYmd,
      chunkCount: chunks.length,
      castName: cast.name,
      skipped: null,
    });
  }

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
