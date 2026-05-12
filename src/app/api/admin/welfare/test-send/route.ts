import { NextResponse } from "next/server";
import type { User } from "@supabase/supabase-js";
import { createServiceRoleClient } from "@/lib/supabase-service";
import { canUserEditStore, getAuthedUserForAdminApi } from "@/lib/admin-store-auth";
import { isValidStoreId, parseActiveStoreIdFromCookieHeader } from "@/lib/current-store";
import { isSuperAdminUser } from "@/lib/super-admin";
import { sendPushMessage } from "@/lib/line-reply";
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

export async function POST(request: Request) {
  const { user, error } = await getAuthedUserForAdminApi();
  if (error === "config") return NextResponse.json({ error: "Supabase is not configured" }, { status: 500 });
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as
    | { storeId?: string; castId?: string; segment?: WelfareSegment }
    | null;
  if (!body) return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });

  const storeId = body.storeId?.trim() ?? "";
  const castId = body.castId?.trim() ?? "";
  const segment = body.segment;
  if (!isValidStoreId(storeId) || !isValidStoreId(castId)) {
    return NextResponse.json({ error: "Valid storeId and castId are required" }, { status: 400 });
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
    return NextResponse.json({ error: "This test endpoint is for welfare_b stores" }, { status: 400 });
  }

  const { data: cast } = await admin
    .from("casts")
    .select("id, name, line_user_id")
    .eq("id", castId)
    .eq("store_id", storeId)
    .eq("is_active", true)
    .maybeSingle();
  if (!cast?.id) return NextResponse.json({ error: "Cast not found" }, { status: 404 });
  if (!cast.line_user_id) return NextResponse.json({ error: "選択した利用者はLINE未連携です" }, { status: 400 });

  const token = await fetchResolvedLineChannelAccessTokenForStore(admin, storeId, "[WelfareTestSend]");
  if (!token?.token) return NextResponse.json({ error: "LINEチャネルトークンが未設定です" }, { status: 400 });

  const custom = (await fetchLineCustomizationForStore(admin, storeId)).welfare;
  const msg =
    segment === "morning"
      ? buildWelfareMorningStartFlexMessage(store.welfare_message_morning, custom)
      : segment === "midday"
        ? buildWelfareMiddayHealthFlexMessage(store.welfare_message_midday, custom)
        : buildWelfareEveningEndFlexMessage(store.welfare_message_evening, custom);

  try {
    await sendPushMessage(cast.line_user_id, token.token, [msg]);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "LINE送信に失敗しました" },
      { status: 502 }
    );
  }

  return NextResponse.json({
    ok: true,
    castName: cast.name,
    segment,
    tokenSource: token.source,
  });
}

