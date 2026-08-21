/**
 * 「作業開始 未打刻アラート」の手動テスト（設定画面から実行）
 *
 * 定期実行と同じ判定で当日の未打刻者を抽出し、管理者へ 1 通送信する。
 * 定期実行側の当日重複ガードには影響しない（テスト後も 12:00 の自動送信は動く）。
 */

import { NextResponse } from "next/server";
import type { User } from "@supabase/supabase-js";
import { createServiceRoleClient } from "@/lib/supabase-service";
import { canUserEditStore, getAuthedUserForAdminApi } from "@/lib/admin-store-auth";
import { isValidStoreId, parseActiveStoreIdFromCookieHeader } from "@/lib/current-store";
import { isSuperAdminUser } from "@/lib/super-admin";
import { getTodayJst } from "@/lib/date-utils";
import {
  fetchUnstartedCastNames,
  sendUnstartedAlertToAdmins,
} from "@/lib/welfare-unstarted-alert";

const LOG_PREFIX = "[WelfareWarnUnstartedTest]";

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
    .select("id, business_type")
    .eq("id", storeId)
    .maybeSingle();

  if (!store?.id) return NextResponse.json({ error: "Store not found" }, { status: 404 });
  if (store.business_type !== "welfare_b") {
    return NextResponse.json(
      { error: "このテストはB型事業所（welfare_b）専用です" },
      { status: 400 }
    );
  }

  const today = getTodayJst();

  let names: string[];
  try {
    names = await fetchUnstartedCastNames(admin, storeId, today);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "未打刻者の抽出に失敗しました" },
      { status: 500 }
    );
  }

  if (names.length === 0) {
    return NextResponse.json({
      ok: true,
      sent: false,
      date: today,
      unstartedCount: 0,
      names: [],
      message: "現時点で未打刻の利用者はいません（送信なし）",
    });
  }

  const result = await sendUnstartedAlertToAdmins(admin, storeId, names, LOG_PREFIX);
  if (!result.ok) {
    const message =
      result.reason === "no_admin_recipient"
        ? "送信先の管理者がLINE未連携です（店舗のLINE管理者IDか、管理者キャストのLINE連携を設定してください）"
        : result.reason === "no_line_token"
          ? "LINEチャネルトークンが未設定です"
          : `LINE送信に失敗しました: ${result.detail ?? ""}`;
    return NextResponse.json({ error: message }, { status: 502 });
  }

  return NextResponse.json({
    ok: true,
    sent: true,
    date: today,
    unstartedCount: names.length,
    names,
    recipients: result.recipients,
  });
}
