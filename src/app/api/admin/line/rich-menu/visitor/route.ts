/**
 * Club GOLD 等向け: 「来客」リッチメニューを作成し、チャネルのデフォルトに適用する。
 * POST /api/admin/line/rich-menu/visitor
 * body: { storeId }
 */

import { NextResponse } from "next/server";
import type { User } from "@supabase/supabase-js";
import { createServiceRoleClient } from "@/lib/supabase-service";
import { canUserEditStore, getAuthedUserForAdminApi } from "@/lib/admin-store-auth";
import { isValidStoreId, parseActiveStoreIdFromCookieHeader } from "@/lib/current-store";
import { isSuperAdminUser } from "@/lib/super-admin";
import { fetchResolvedLineChannelAccessTokenForStore } from "@/lib/line-channel-token";
import { createAndLinkVisitorArrivalRichMenu } from "@/lib/line-rich-menu-visitor";

function rejectStoreMismatch(
  request: Request,
  user: User,
  storeId: string
): NextResponse | null {
  if (isSuperAdminUser(user)) return null;
  const cookieStoreId = parseActiveStoreIdFromCookieHeader(request.headers.get("cookie"));
  if (cookieStoreId && cookieStoreId !== storeId) {
    return NextResponse.json(
      { error: "storeId must match active store (cookie)" },
      { status: 403 }
    );
  }
  return null;
}

export async function POST(request: Request) {
  const { user, error } = await getAuthedUserForAdminApi();
  if (error === "config") {
    return NextResponse.json({ error: "Supabase is not configured" }, { status: 500 });
  }
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as { storeId?: string } | null;
  const storeId = body?.storeId?.trim() ?? "";
  if (!isValidStoreId(storeId)) {
    return NextResponse.json({ error: "Valid storeId is required" }, { status: 400 });
  }
  if (!canUserEditStore(user, storeId)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const mismatch = rejectStoreMismatch(request, user, storeId);
  if (mismatch) return mismatch;

  const admin = createServiceRoleClient();
  const { data: store } = await admin
    .from("stores")
    .select("id, name, business_type")
    .eq("id", storeId)
    .maybeSingle();

  if (!store?.id) {
    return NextResponse.json({ error: "Store not found" }, { status: 404 });
  }
  if (store.business_type === "welfare_b") {
    return NextResponse.json(
      { error: "来客リッチメニューはキャバクラ・BAR・風俗店舗向けです" },
      { status: 400 }
    );
  }

  const token = await fetchResolvedLineChannelAccessTokenForStore(
    admin,
    storeId,
    "[RichMenuVisitor]"
  );
  if (!token?.token) {
    return NextResponse.json(
      { error: "LINEチャネルトークンが未設定です（店舗または環境変数）" },
      { status: 400 }
    );
  }

  try {
    const result = await createAndLinkVisitorArrivalRichMenu(token.token);
    return NextResponse.json({
      ok: true,
      storeId,
      storeName: store.name,
      richMenuId: result.richMenuId,
      linkedDefault: result.linkedDefault,
      message:
        "来客リッチメニューを作成し、この公式LINEのデフォルトメニューに適用しました。トーク画面を開き直すと表示されます。",
    });
  } catch (e) {
    console.error("[RichMenuVisitor]", e);
    return NextResponse.json(
      {
        error: e instanceof Error ? e.message : "リッチメニューの作成に失敗しました",
      },
      { status: 502 }
    );
  }
}
