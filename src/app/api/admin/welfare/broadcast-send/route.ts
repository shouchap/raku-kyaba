import { NextResponse } from "next/server";
import type { User } from "@supabase/supabase-js";
import { createServiceRoleClient } from "@/lib/supabase-service";
import { canUserEditStore, getAuthedUserForAdminApi } from "@/lib/admin-store-auth";
import { isValidStoreId, parseActiveStoreIdFromCookieHeader } from "@/lib/current-store";
import { isSuperAdminUser } from "@/lib/super-admin";
import { sendMulticastMessage } from "@/lib/line-reply";
import { fetchResolvedLineChannelAccessTokenForStore } from "@/lib/line-channel-token";
import {
  buildWelfareEveningEndFlexMessage,
  buildWelfareMiddayHealthFlexMessage,
  buildWelfareMorningStartFlexMessage,
} from "@/lib/welfare-line-flex";
import { fetchLineCustomizationForStore } from "@/lib/line-customization";

type WelfareSegment = "morning" | "midday" | "evening";

function rejectStoreMismatch(request: Request, user: User, storeId: string): NextResponse | null {
  if (isSuperAdminUser(user)) return null;
  const cookieStoreId = parseActiveStoreIdFromCookieHeader(request.headers.get("cookie"));
  if (cookieStoreId && cookieStoreId !== storeId) {
    return NextResponse.json({ error: "storeId must match active store (cookie)" }, { status: 403 });
  }
  return null;
}

/**
 * 福祉定期配信の手動一斉送信（設定画面から）
 * POST /api/admin/welfare/broadcast-send
 * body: { storeId, segment: morning|midday|evening }
 *
 * 対象: 当該店舗の is_active=true かつ line_user_id ありの利用者すべて
 * （cron の morning/midday/evening と同じ配信。定休日スキップはしない＝手動なので即送る）
 */
export async function POST(request: Request) {
  const { user, error } = await getAuthedUserForAdminApi();
  if (error === "config") return NextResponse.json({ error: "Supabase is not configured" }, { status: 500 });
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as
    | { storeId?: string; segment?: WelfareSegment }
    | null;
  if (!body) return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });

  const storeId = body.storeId?.trim() ?? "";
  const segment = body.segment;
  if (!isValidStoreId(storeId)) {
    return NextResponse.json({ error: "Valid storeId is required" }, { status: 400 });
  }
  if (segment !== "morning" && segment !== "midday" && segment !== "evening") {
    return NextResponse.json({ error: "segment must be morning | midday | evening" }, { status: 400 });
  }
  if (!canUserEditStore(user, storeId)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const mismatch = rejectStoreMismatch(request, user, storeId);
  if (mismatch) return mismatch;

  const admin = createServiceRoleClient();
  const { data: store } = await admin
    .from("stores")
    .select("id, business_type, welfare_message_morning, welfare_message_midday, welfare_message_evening")
    .eq("id", storeId)
    .maybeSingle();
  if (!store?.id) return NextResponse.json({ error: "Store not found" }, { status: 404 });
  if (store.business_type !== "welfare_b") {
    return NextResponse.json({ error: "This endpoint is for welfare_b stores" }, { status: 400 });
  }

  const { data: castRows, error: castErr } = await admin
    .from("casts")
    .select("id, name, line_user_id")
    .eq("store_id", storeId)
    .eq("is_active", true);
  if (castErr) {
    return NextResponse.json({ error: castErr.message }, { status: 500 });
  }

  const linked = (castRows ?? []).filter(
    (c): c is { id: string; name: string; line_user_id: string } =>
      !!c.line_user_id && c.line_user_id.trim() !== ""
  );
  if (linked.length === 0) {
    return NextResponse.json({
      ok: true,
      recipients: 0,
      activeCastCount: castRows?.length ?? 0,
      message: "LINE連携済みの利用者がいません",
    });
  }

  const token = await fetchResolvedLineChannelAccessTokenForStore(
    admin,
    storeId,
    "[WelfareBroadcastSend]"
  );
  if (!token?.token) {
    return NextResponse.json({ error: "LINEチャネルトークンが未設定です" }, { status: 400 });
  }

  const custom = (await fetchLineCustomizationForStore(admin, storeId)).welfare;
  const msg =
    segment === "morning"
      ? buildWelfareMorningStartFlexMessage(store.welfare_message_morning, custom)
      : segment === "midday"
        ? buildWelfareMiddayHealthFlexMessage(store.welfare_message_midday, custom)
        : buildWelfareEveningEndFlexMessage(store.welfare_message_evening, custom);

  const ids = linked.map((c) => c.line_user_id);
  const chunkSize = 500;
  let sentTotal = 0;
  const chunkErrors: string[] = [];

  for (let i = 0; i < ids.length; i += chunkSize) {
    const chunk = ids.slice(i, i + chunkSize);
    try {
      await sendMulticastMessage(chunk, token.token, [msg]);
      sentTotal += chunk.length;
    } catch (e) {
      chunkErrors.push(e instanceof Error ? e.message : String(e));
    }
  }

  if (sentTotal === 0) {
    return NextResponse.json(
      {
        error: chunkErrors[0] ?? "LINE一斉送信に失敗しました",
        recipients: 0,
        activeCastCount: castRows?.length ?? 0,
      },
      { status: 502 }
    );
  }

  return NextResponse.json({
    ok: true,
    segment,
    recipients: sentTotal,
    activeCastCount: castRows?.length ?? 0,
    skippedNoLine: (castRows?.length ?? 0) - linked.length,
    partialError: chunkErrors.length > 0 ? chunkErrors.join("; ") : undefined,
    tokenSource: token.source,
  });
}
