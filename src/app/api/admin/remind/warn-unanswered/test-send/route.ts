import { NextResponse } from "next/server";
import type { User } from "@supabase/supabase-js";
import { createServiceRoleClient } from "@/lib/supabase-service";
import { canUserEditStore, getAuthedUserForAdminApi } from "@/lib/admin-store-auth";
import { isValidStoreId, parseActiveStoreIdFromCookieHeader } from "@/lib/current-store";
import { isSuperAdminUser } from "@/lib/super-admin";
import { sendPushMessage } from "@/lib/line-reply";
import { fetchResolvedLineChannelAccessTokenForStore } from "@/lib/line-channel-token";

type TestRow = { cast_name: string; timeDisplay: string };

function rejectStoreMismatch(request: Request, user: User, storeId: string): NextResponse | null {
  if (isSuperAdminUser(user)) return null;
  const cookieStoreId = parseActiveStoreIdFromCookieHeader(request.headers.get("cookie"));
  if (cookieStoreId && cookieStoreId !== storeId) {
    return NextResponse.json({ error: "storeId must match active store (cookie)" }, { status: 403 });
  }
  return null;
}

function buildUnansweredAlertMessage(
  items: TestRow[],
  cfg?: Record<string, unknown>
): string {
  const customHeader =
    typeof cfg?.warn_unanswered_header === "string" ? cfg.warn_unanswered_header.trim() : "";
  const lineTemplate =
    typeof cfg?.warn_unanswered_line_template === "string"
      ? cfg.warn_unanswered_line_template
      : "・{name} ({time})";

  const header = (customHeader || "【未返信アラート】") + "\n" + "以下のキャストから返信がありません。\n";
  const lines = items
    .map((i) => lineTemplate.replace(/\{name\}/g, i.cast_name).replace(/\{time\}/g, i.timeDisplay))
    .join("\n");
  return header + lines;
}

export async function POST(request: Request) {
  const { user, error } = await getAuthedUserForAdminApi();
  if (error === "config") return NextResponse.json({ error: "Supabase is not configured" }, { status: 500 });
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as { storeId?: string; castId?: string } | null;
  if (!body) return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  const storeId = body.storeId?.trim() ?? "";
  const castId = body.castId?.trim() ?? "";
  if (!isValidStoreId(storeId) || !isValidStoreId(castId)) {
    return NextResponse.json({ error: "Valid storeId and castId are required" }, { status: 400 });
  }
  if (!canUserEditStore(user, storeId)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const mismatch = rejectStoreMismatch(request, user, storeId);
  if (mismatch) return mismatch;

  const admin = createServiceRoleClient();
  const { data: cast } = await admin
    .from("casts")
    .select("id, name, line_user_id")
    .eq("id", castId)
    .eq("store_id", storeId)
    .eq("is_active", true)
    .maybeSingle();
  if (!cast?.id) return NextResponse.json({ error: "Cast not found" }, { status: 404 });
  if (!cast.line_user_id) return NextResponse.json({ error: "選択したキャストはLINE未連携です" }, { status: 400 });

  const token = await fetchResolvedLineChannelAccessTokenForStore(
    admin,
    storeId,
    "[WarnUnansweredTestSend]"
  );
  if (!token?.token) return NextResponse.json({ error: "LINEチャネルトークンが未設定です" }, { status: 400 });

  const { data: settingsRow } = await admin
    .from("system_settings")
    .select("value")
    .eq("store_id", storeId)
    .eq("key", "reminder_config")
    .maybeSingle();
  const cfg = (settingsRow?.value ?? {}) as Record<string, unknown>;

  const text = buildUnansweredAlertMessage(
    [{ cast_name: cast.name ?? "キャスト", timeDisplay: "21:00" }],
    cfg
  );

  try {
    await sendPushMessage(cast.line_user_id, token.token, [{ type: "text", text }]);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "LINE送信に失敗しました" },
      { status: 502 }
    );
  }

  return NextResponse.json({ ok: true, castName: cast.name, tokenSource: token.source });
}

