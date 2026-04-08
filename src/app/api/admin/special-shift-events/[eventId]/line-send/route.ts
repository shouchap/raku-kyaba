import { NextResponse } from "next/server";
import { canUserEditStore, getAuthedUserForAdminApi } from "@/lib/admin-store-auth";
import { resolveActiveStoreIdFromRequest } from "@/lib/current-store";
import { fetchResolvedLineChannelAccessTokenForStore } from "@/lib/line-channel-token";
import { sendPushMessage } from "@/lib/line-reply";
import { buildSpecialShiftRequestFlex } from "@/lib/special-shift-line-flex";
import { createServiceRoleClient } from "@/lib/supabase-service";

type RouteContext = { params: Promise<{ eventId: string }> };

/**
 * POST: LINE 送信
 * Body: { mode: "test" | "bulk", castId?: string }  test 時は castId 必須
 */
export async function POST(request: Request, context: RouteContext) {
  const { eventId } = await context.params;
  if (!eventId) {
    return NextResponse.json({ error: "eventId is required" }, { status: 400 });
  }

  let admin: ReturnType<typeof createServiceRoleClient>;
  try {
    admin = createServiceRoleClient();
  } catch {
    return NextResponse.json({ error: "Server configuration error (service role)" }, { status: 500 });
  }

  let body: { mode?: string; castId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const mode = body.mode === "bulk" ? "bulk" : body.mode === "test" ? "test" : null;
  if (!mode) {
    return NextResponse.json({ error: 'mode must be "test" or "bulk"' }, { status: 400 });
  }

  let expectedStoreId: string;
  try {
    expectedStoreId = resolveActiveStoreIdFromRequest(request);
  } catch (e) {
    return NextResponse.json(
      { error: "Tenant not configured", details: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }

  const { user, error: authErr } = await getAuthedUserForAdminApi();
  if (authErr === "config") {
    return NextResponse.json({ error: "Supabase is not configured" }, { status: 500 });
  }
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!canUserEditStore(user, expectedStoreId)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { data: event, error: evErr } = await admin
    .from("special_shift_events")
    .select("id, store_id")
    .eq("id", eventId)
    .single();

  if (evErr || !event) {
    return NextResponse.json({ error: "Event not found" }, { status: 404 });
  }
  if (event.store_id !== expectedStoreId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const tokenResult = await fetchResolvedLineChannelAccessTokenForStore(
    admin,
    expectedStoreId,
    "[SpecialShiftLineSend]"
  );
  if (!tokenResult) {
    return NextResponse.json(
      {
        error:
          "LINE チャネルアクセストークンがありません。stores.line_channel_access_token または環境変数を設定してください。",
      },
      { status: 500 }
    );
  }
  const channelAccessToken = tokenResult.token;

  const flexFor = (castId: string) => buildSpecialShiftRequestFlex(eventId, castId);

  if (mode === "test") {
    const castId = body.castId;
    if (!castId || typeof castId !== "string") {
      return NextResponse.json({ error: "castId is required for test mode" }, { status: 400 });
    }

    const { data: cast, error: cErr } = await admin
      .from("casts")
      .select("id, store_id, line_user_id, name")
      .eq("id", castId)
      .eq("is_active", true)
      .single();

    if (cErr || !cast) {
      return NextResponse.json({ error: "Cast not found or inactive" }, { status: 404 });
    }
    if (cast.store_id !== expectedStoreId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const lineUserId = cast.line_user_id?.trim();
    if (!lineUserId) {
      return NextResponse.json({ error: "Cast has no LINE account linked" }, { status: 400 });
    }

    try {
      await sendPushMessage(lineUserId, channelAccessToken, [flexFor(cast.id)]);
    } catch (err) {
      console.error("[SpecialShiftLineSend] test push failed:", err);
      return NextResponse.json({ error: "Failed to send LINE message" }, { status: 500 });
    }

    return NextResponse.json({ ok: true, successCount: 1, failCount: 0 });
  }

  // bulk: アクティブかつ LINE 連携済みのキャストへ個別 Push（URL が cast ごとに異なるため）
  const { data: casts, error: listErr } = await admin
    .from("casts")
    .select("id, line_user_id")
    .eq("store_id", expectedStoreId)
    .eq("is_active", true);

  if (listErr) {
    console.error("[SpecialShiftLineSend] list casts", listErr);
    return NextResponse.json({ error: listErr.message }, { status: 500 });
  }

  let successCount = 0;
  let failCount = 0;
  const errors: string[] = [];

  for (const c of casts ?? []) {
    const lineUserId = c.line_user_id?.trim();
    if (!lineUserId) {
      failCount += 1;
      errors.push(`skip ${c.id} (no line_user_id)`);
      continue;
    }
    try {
      await sendPushMessage(lineUserId, channelAccessToken, [flexFor(c.id)]);
      successCount += 1;
    } catch (err) {
      console.error("[SpecialShiftLineSend] push failed for cast", c.id, err);
      failCount += 1;
      errors.push(`cast ${c.id}`);
    }
  }

  return NextResponse.json({
    ok: true,
    successCount,
    failCount,
    ...(errors.length > 0 ? { errors: errors.slice(0, 20) } : {}),
  });
}
