import { NextResponse } from "next/server";
import type { User } from "@supabase/supabase-js";
import { createServiceRoleClient } from "@/lib/supabase-service";
import { canUserEditStore, getAuthedUserForAdminApi } from "@/lib/admin-store-auth";
import { isValidStoreId, parseActiveStoreIdFromCookieHeader } from "@/lib/current-store";
import { isSuperAdminUser } from "@/lib/super-admin";
import { isUndefinedColumnError } from "@/lib/postgrest-error";
import { sendPushMessage } from "@/lib/line-reply";
import { fetchResolvedLineChannelAccessTokenForStore } from "@/lib/line-channel-token";
import {
  buildGuideTargetSelectMessage,
  canonicalGuideHearingTime,
  resolveGuideHearingScheduleSlot,
} from "@/lib/guide-hearing";

export const dynamic = "force-dynamic";

function badRequest(reason: string): NextResponse {
  console.error("[api/admin/guide-hearing] 400:", reason);
  return NextResponse.json({ error: reason }, { status: 400 });
}

function serviceRoleEnvOk(): boolean {
  return Boolean(
    (process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL)?.trim() &&
      process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  );
}

function rejectStoreMismatch(
  request: Request,
  user: User,
  storeId: string
): NextResponse | null {
  if (isSuperAdminUser(user)) return null;
  const cookieStoreId = parseActiveStoreIdFromCookieHeader(request.headers.get("cookie"));
  if (cookieStoreId && cookieStoreId !== storeId) {
    return NextResponse.json({ error: "storeId must match active store (cookie)" }, { status: 403 });
  }
  return null;
}

export async function GET(request: Request) {
  const { user, error } = await getAuthedUserForAdminApi();
  if (error === "config") return NextResponse.json({ error: "Supabase is not configured" }, { status: 500 });
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!serviceRoleEnvOk()) return NextResponse.json({ error: "Server configuration error" }, { status: 500 });

  const storeId = new URL(request.url).searchParams.get("storeId")?.trim() ?? "";
  if (!isValidStoreId(storeId)) {
    return NextResponse.json({ error: "Valid storeId is required" }, { status: 400 });
  }
  if (!canUserEditStore(user, storeId)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const mismatch = rejectStoreMismatch(request, user, storeId);
  if (mismatch) return mismatch;

  const admin = createServiceRoleClient();
  let storeRes = await admin
    .from("stores")
    .select(
      "guide_hearing_enabled, guidance_request_time, guide_hearing_time, guide_hearing_reporter_id, guide_staff_names"
    )
    .eq("id", storeId)
    .maybeSingle();
  if (storeRes.error && isUndefinedColumnError(storeRes.error, "guidance_request_time")) {
    storeRes = await admin
      .from("stores")
      .select("guide_hearing_enabled, guide_hearing_time, guide_hearing_reporter_id, guide_staff_names")
      .eq("id", storeId)
      .maybeSingle();
  }
  if (storeRes.error) {
    if (isUndefinedColumnError(storeRes.error, "guide_hearing_enabled")) {
      return NextResponse.json({
        enabled: false,
        sendTime: "02:00",
        warning:
          "stores.guide_hearing_* columns are missing. Apply migration 035_guide_hearing_staffs_daily_results.sql",
      });
    }
    return NextResponse.json({ error: storeRes.error.message }, { status: 500 });
  }
  const { data: candidates, error: candidateErr } = await admin
    .from("casts")
    .select("id, name, line_user_id")
    .eq("store_id", storeId)
    .eq("is_active", true)
    .order("name");
  if (candidateErr) {
    console.error("[api/admin/guide-hearing] reporter candidates fetch failed:", candidateErr.message);
  }

  const row = storeRes.data as {
    guidance_request_time?: string | null;
    guide_hearing_time?: string | null;
  } | null;
  const sendTime =
    resolveGuideHearingScheduleSlot(row?.guidance_request_time ?? null, row?.guide_hearing_time ?? null) ??
    "02:00";

  return NextResponse.json({
    enabled: storeRes.data?.guide_hearing_enabled === true,
    sendTime,
    reporterCastId:
      typeof storeRes.data?.guide_hearing_reporter_id === "string"
        ? storeRes.data.guide_hearing_reporter_id
        : null,
    guideStaffNames: Array.isArray(storeRes.data?.guide_staff_names)
      ? storeRes.data.guide_staff_names.map((v: unknown) => String(v ?? "").trim()).filter(Boolean)
      : [],
    reporterCandidates: (candidates ?? []).map((c) => ({
      id: c.id,
      name: c.name,
      line_user_id: c.line_user_id,
    })),
  });
}

type PatchBody = {
  storeId?: string;
  enabled?: boolean;
  sendTime?: string;
  reporterCastId?: string | null;
  guideStaffNames?: string[];
};

export async function PATCH(request: Request) {
  const { user, error } = await getAuthedUserForAdminApi();
  if (error === "config") return NextResponse.json({ error: "Supabase is not configured" }, { status: 500 });
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!serviceRoleEnvOk()) return NextResponse.json({ error: "Server configuration error" }, { status: 500 });

  const body = (await request.json().catch(() => null)) as PatchBody | null;
  if (!body) return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  const storeId = body.storeId?.trim() ?? "";
  if (!isValidStoreId(storeId)) {
    return NextResponse.json({ error: "Valid storeId is required" }, { status: 400 });
  }
  if (!canUserEditStore(user, storeId)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const mismatch = rejectStoreMismatch(request, user, storeId);
  if (mismatch) return mismatch;

  if (typeof body.enabled !== "boolean") {
    return NextResponse.json({ error: "enabled must be boolean" }, { status: 400 });
  }
  const sendTimeCanonical = canonicalGuideHearingTime(
    typeof body.sendTime === "string" ? body.sendTime : null
  );
  if (!sendTimeCanonical) {
    return NextResponse.json({ error: "sendTime must be HH:00 (00-23)" }, { status: 400 });
  }
  if (!Array.isArray(body.guideStaffNames)) {
    return NextResponse.json({ error: "guideStaffNames must be string[]" }, { status: 400 });
  }
  const guideStaffNames = [...new Set(body.guideStaffNames.map((v) => String(v ?? "").trim()).filter(Boolean))];
  if (guideStaffNames.length > 13) {
    return NextResponse.json({ error: "guideStaffNames can contain up to 13 names" }, { status: 400 });
  }
  const reporterCastIdRaw = body.reporterCastId;
  let reporterCastId: string | null = null;
  if (reporterCastIdRaw === null || reporterCastIdRaw === undefined || reporterCastIdRaw === "") {
    reporterCastId = null;
  } else if (typeof reporterCastIdRaw === "string" && isValidStoreId(reporterCastIdRaw.trim())) {
    reporterCastId = reporterCastIdRaw.trim();
  } else {
    return NextResponse.json({ error: "reporterCastId must be uuid or null" }, { status: 400 });
  }
  const admin = createServiceRoleClient();
  const nowIso = new Date().toISOString();

  if (reporterCastId) {
    const { data: reporterCast, error: reporterErr } = await admin
      .from("casts")
      .select("id, line_user_id")
      .eq("id", reporterCastId)
      .eq("store_id", storeId)
      .eq("is_active", true)
      .maybeSingle();
    if (reporterErr) {
      return NextResponse.json({ error: reporterErr.message }, { status: 500 });
    }
    if (!reporterCast?.id) {
      return NextResponse.json({ error: "選択した担当者が店舗に存在しません" }, { status: 400 });
    }
    if (!reporterCast.line_user_id) {
      return NextResponse.json({ error: "選択した担当者はLINE未連携です" }, { status: 400 });
    }
  }

  const timeForPg = `${sendTimeCanonical}:00`;
  let storeUpd = await admin
    .from("stores")
    .update({
      guide_hearing_enabled: body.enabled,
      guide_hearing_time: sendTimeCanonical,
      guidance_request_time: timeForPg,
      guide_hearing_reporter_id: reporterCastId,
      guide_staff_names: guideStaffNames,
      updated_at: nowIso,
    })
    .eq("id", storeId);
  if (storeUpd.error && isUndefinedColumnError(storeUpd.error, "guidance_request_time")) {
    storeUpd = await admin
      .from("stores")
      .update({
        guide_hearing_enabled: body.enabled,
        guide_hearing_time: sendTimeCanonical,
        guide_hearing_reporter_id: reporterCastId,
        guide_staff_names: guideStaffNames,
        updated_at: nowIso,
      })
      .eq("id", storeId);
  }
  if (storeUpd.error) {
    return NextResponse.json(
      {
        error: isUndefinedColumnError(storeUpd.error, "guide_hearing_enabled")
          ? "stores.guide_hearing_* columns are missing. Apply migration 035_guide_hearing_staffs_daily_results.sql"
          : storeUpd.error.message,
      },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true });
}

type PostBody = {
  storeId?: string;
  /** 指定時はそのキャストの LINE 宛に起点メッセージを送る（本番の担当者以外のテスト用） */
  targetCastId?: string | null;
  /** true のとき stores.line_group_id 宛に送信 */
  sendToLineGroup?: boolean;
};

/**
 * 管理画面のテスト送信用（案内数ヒアリング専用）。
 * 通常の /api/remind とは分離し、この機能だけを即時送信する。
 */
export async function POST(request: Request) {
  const { user, error } = await getAuthedUserForAdminApi();
  if (error === "config") return NextResponse.json({ error: "Supabase is not configured" }, { status: 500 });
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!serviceRoleEnvOk()) return NextResponse.json({ error: "Server configuration error" }, { status: 500 });

  const body = (await request.json().catch(() => null)) as PostBody | null;
  if (!body) return badRequest("Invalid JSON");

  const storeId = body.storeId?.trim() ?? "";
  if (!isValidStoreId(storeId)) {
    return badRequest("Valid storeId is required");
  }
  if (!canUserEditStore(user, storeId)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const mismatch = rejectStoreMismatch(request, user, storeId);
  if (mismatch) return mismatch;

  const targetCastIdRaw = body.targetCastId?.trim() ?? "";
  const sendToLineGroup = body.sendToLineGroup === true;
  const hasDirectedTarget = sendToLineGroup || !!targetCastIdRaw;

  const admin = createServiceRoleClient();

  const { data: store, error: storeErr } = await admin
    .from("stores")
    .select(
      "id, name, business_type, guide_hearing_enabled, guide_hearing_reporter_id, guide_staff_names, is_guide_enabled, line_group_id"
    )
    .eq("id", storeId)
    .maybeSingle();
  if (storeErr) return NextResponse.json({ error: storeErr.message }, { status: 500 });
  if (!store?.id) return NextResponse.json({ error: "Store not found" }, { status: 404 });

  const businessType = String((store as { business_type?: string | null }).business_type ?? "cabaret").trim();
  if (businessType !== "cabaret") {
    return badRequest("案内数入力のテスト送信はキャバクラ店舗のみ利用できます。");
  }
  if ((store as { is_guide_enabled?: boolean | null }).is_guide_enabled === false) {
    return badRequest("案内数機能がOFFです。業態別設定で案内ヒアリングを有効にしてください。");
  }

  if (!hasDirectedTarget) {
    if (store.guide_hearing_enabled !== true) {
      return badRequest("案内数ヒアリングがOFFです。LINE設定で自動送信をONにしてから実行してください。");
    }
    if (!store.guide_hearing_reporter_id) {
      return badRequest("LINE受取担当者が未設定です。LINE設定で選択してください。");
    }
  }

  const token = await fetchResolvedLineChannelAccessTokenForStore(admin, storeId, "[GuideTest]");
  if (!token?.token) {
    return badRequest("LINEチャネルトークンが未設定です。");
  }

  const staffNames = Array.isArray(store.guide_staff_names)
    ? store.guide_staff_names.map((v: unknown) => String(v ?? "").trim()).filter(Boolean)
    : [];
  if (staffNames.length === 0) {
    return badRequest("入力対象スタッフ名が未設定です。LINE設定または案内数レポートで登録してください。");
  }

  const message = buildGuideTargetSelectMessage({
    storeName: store.name,
    staffNames,
  });

  let pushToId: string;
  let recipientLabel: { kind: "reporter" | "cast" | "group"; id?: string; name?: string | null };

  if (sendToLineGroup) {
    const gid = String((store as { line_group_id?: string | null }).line_group_id ?? "").trim();
    if (!gid) {
      return badRequest("公式LINEグループが未登録です。グループでボットを友だち追加すると保存されます。");
    }
    pushToId = gid;
    recipientLabel = { kind: "group" };
  } else if (targetCastIdRaw) {
    if (!isValidStoreId(targetCastIdRaw)) {
      return badRequest("targetCastId が不正です");
    }
    const { data: targetCast, error: targetErr } = await admin
      .from("casts")
      .select("id, name, line_user_id")
      .eq("id", targetCastIdRaw)
      .eq("store_id", storeId)
      .eq("is_active", true)
      .maybeSingle();
    if (targetErr) {
      console.error("[api/admin/guide-hearing] target cast fetch error:", targetErr.message);
      return NextResponse.json({ error: targetErr.message }, { status: 500 });
    }
    if (!targetCast?.id || !targetCast.line_user_id) {
      return badRequest("選択したキャストが無効か、LINE未連携です。");
    }
    pushToId = targetCast.line_user_id;
    recipientLabel = { kind: "cast", id: targetCast.id, name: targetCast.name };
  } else {
    const { data: reporterCast, error: reporterErr } = await admin
      .from("casts")
      .select("id, name, line_user_id")
      .eq("id", store.guide_hearing_reporter_id as string)
      .eq("store_id", storeId)
      .eq("is_active", true)
      .maybeSingle();
    if (reporterErr) {
      console.error("[api/admin/guide-hearing] reporter fetch error:", reporterErr.message);
      return NextResponse.json({ error: reporterErr.message }, { status: 500 });
    }
    if (!reporterCast?.id || !reporterCast.line_user_id) {
      return badRequest("LINE受取担当者が無効です（在籍/LINE連携を確認してください）。");
    }
    pushToId = reporterCast.line_user_id;
    recipientLabel = { kind: "reporter", id: reporterCast.id, name: reporterCast.name };
  }

  console.log(
    `[api/admin/guide-hearing] test push storeId=${storeId} recipient=${recipientLabel.kind} staffNameCount=${staffNames.length}`
  );

  try {
    await sendPushMessage(pushToId, token.token, [message]);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.error(`[api/admin/guide-hearing] push failed storeId=${storeId}:`, reason);
    return badRequest("LINE送信に失敗しました。LINE連携状態とチャンネル設定を確認してください。");
  }

  return NextResponse.json({
    ok: true,
    sent: 1,
    targetCount: staffNames.length,
    recipient: recipientLabel,
    tokenSource: token.source,
  });
}
