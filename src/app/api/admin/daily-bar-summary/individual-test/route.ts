import { NextResponse } from "next/server";
import type { User } from "@supabase/supabase-js";
import { createServiceRoleClient } from "@/lib/supabase-service";
import { canUserEditStore, getAuthedUserForAdminApi } from "@/lib/admin-store-auth";
import { isValidStoreId, parseActiveStoreIdFromCookieHeader } from "@/lib/current-store";
import { isSuperAdminUser } from "@/lib/super-admin";
import { sendPushMessage } from "@/lib/line-reply";
import { fetchResolvedLineChannelAccessTokenForStore } from "@/lib/line-channel-token";
import { getTodayJst } from "@/lib/date-utils";
import { generateDailyBarSummaryForStore } from "@/lib/daily-bar-summary";

export const dynamic = "force-dynamic";

function rejectStoreMismatch(request: Request, user: User, storeId: string): NextResponse | null {
  if (isSuperAdminUser(user)) return null;
  const cookieStoreId = parseActiveStoreIdFromCookieHeader(request.headers.get("cookie"));
  if (cookieStoreId && cookieStoreId !== storeId) {
    return NextResponse.json({ error: "storeId must match active store (cookie)" }, { status: 403 });
  }
  return null;
}

/**
 * POST /api/admin/daily-bar-summary/individual-test
 * body: { storeId, castId } — 本日分の営業前サマリー（日報）テキストを1名のLINEにテスト送信
 */
export async function POST(request: Request) {
  const { user, error } = await getAuthedUserForAdminApi();
  if (error === "config") {
    return NextResponse.json({ error: "Supabase is not configured" }, { status: 500 });
  }
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as { storeId?: string; castId?: string } | null;
  if (!body) {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const storeId = body.storeId?.trim() ?? "";
  const castId = body.castId?.trim() ?? "";
  if (!isValidStoreId(storeId) || !isValidStoreId(castId)) {
    return NextResponse.json({ error: "Valid storeId and castId are required" }, { status: 400 });
  }
  if (!canUserEditStore(user, storeId)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const mismatch = rejectStoreMismatch(request, user, storeId);
  if (mismatch) return mismatch;

  let admin;
  try {
    admin = createServiceRoleClient();
  } catch {
    return NextResponse.json({ error: "Server configuration error" }, { status: 500 });
  }

  const today = getTodayJst();

  const { data: cast, error: castErr } = await admin
    .from("casts")
    .select("id, name, line_user_id")
    .eq("id", castId)
    .eq("store_id", storeId)
    .eq("is_active", true)
    .maybeSingle();

  if (castErr) {
    return NextResponse.json({ error: "Failed to load cast", details: castErr.message }, { status: 500 });
  }
  if (!cast?.id) {
    return NextResponse.json({ error: "Cast not found" }, { status: 404 });
  }
  const lineUserId = String((cast as { line_user_id?: string | null }).line_user_id ?? "").trim();
  if (!lineUserId) {
    return NextResponse.json({ error: "選択したキャストはLINE未連携です" }, { status: 400 });
  }

  const generated = await generateDailyBarSummaryForStore(admin, storeId, today);
  if (!generated.ok) {
    return NextResponse.json({ error: "サマリー生成に失敗しました", details: generated.error }, { status: 500 });
  }

  const tokenPack = await fetchResolvedLineChannelAccessTokenForStore(
    admin,
    storeId,
    "[daily-bar-summary-individual-test]"
  );
  if (!tokenPack?.token) {
    return NextResponse.json({ error: "LINEチャネルトークンが未設定です" }, { status: 400 });
  }

  try {
    for (const chunk of generated.chunks) {
      await sendPushMessage(lineUserId, tokenPack.token, [{ type: "text", text: chunk }]);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: "LINE送信に失敗しました", details: msg }, { status: 502 });
  }

  const castName = String((cast as { name?: string | null }).name ?? "").trim() || "キャスト";

  return NextResponse.json({
    ok: true,
    castName,
    date: today,
    chunkCount: generated.chunks.length,
    tokenSource: tokenPack.source,
  });
}
