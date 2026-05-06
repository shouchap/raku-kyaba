import { NextResponse } from "next/server";
import type { User } from "@supabase/supabase-js";
import type { Database, Json } from "@/types/database";
import { createServiceRoleClient } from "@/lib/supabase-service";
import { isValidStoreId, parseActiveStoreIdFromCookieHeader } from "@/lib/current-store";
import { canUserEditStore, getAuthedUserForAdminApi } from "@/lib/admin-store-auth";
import { isSuperAdminUser } from "@/lib/super-admin";
import { logPostgrestError } from "@/lib/postgrest-error";

export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const VALID_STATUS = new Set([
  "attending",
  "absent",
  "late",
  "public_holiday",
  "half_holiday",
]);

function storeIdForbiddenUnlessMatchesCookie(
  request: Request,
  user: User,
  storeId: string
): NextResponse | null {
  if (isSuperAdminUser(user)) return null;
  const cookieStoreId = parseActiveStoreIdFromCookieHeader(request.headers.get("cookie"));
  if (cookieStoreId && storeId !== cookieStoreId) {
    return NextResponse.json(
      { error: "storeId must match active store (cookie)" },
      { status: 403 }
    );
  }
  return null;
}

function emptyOldDataForInsert(): Json {
  return {} as Json;
}

/**
 * POST /api/admin/attendance-logs?storeId=uuid
 * 管理画面からの手動新規打刻（同一日・キャストに既存ログがある場合は 409）
 */
export async function POST(request: Request) {
  const { user, error: authErr } = await getAuthedUserForAdminApi();
  if (authErr === "config") {
    return NextResponse.json({ error: "Supabase is not configured" }, { status: 500 });
  }
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const storeIdFromQuery = new URL(request.url).searchParams.get("storeId")?.trim() ?? "";

  let bodyRaw: unknown;
  try {
    bodyRaw = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (bodyRaw === null || typeof bodyRaw !== "object" || Array.isArray(bodyRaw)) {
    return NextResponse.json({ error: "JSON body required" }, { status: 400 });
  }
  const body = bodyRaw as Record<string, unknown>;

  const storeId = String(body.store_id ?? body.storeId ?? storeIdFromQuery ?? "").trim();
  const castId = String(body.cast_id ?? body.castId ?? "").trim();
  const attendedDate = String(body.attended_date ?? body.attendedDate ?? "").trim();
  const statusRaw = body.status;

  if (!isValidStoreId(storeId) || !isValidStoreId(castId) || !DATE_RE.test(attendedDate)) {
    return NextResponse.json(
      { error: "Valid storeId, castId, and attended_date (YYYY-MM-DD) are required" },
      { status: 400 }
    );
  }

  if (!canUserEditStore(user, storeId)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const cookieMismatch = storeIdForbiddenUnlessMatchesCookie(request, user, storeId);
  if (cookieMismatch) return cookieMismatch;

  if (typeof statusRaw !== "string" || !VALID_STATUS.has(statusRaw)) {
    return NextResponse.json({ error: "Invalid status" }, { status: 400 });
  }

  let planned_groups: number | null = null;
  if ("planned_groups" in body || "plannedGroups" in body) {
    const v = body.planned_groups ?? body.plannedGroups;
    if (v === null || v === undefined || v === "") {
      planned_groups = null;
    } else if (typeof v === "number" && Number.isFinite(v)) {
      planned_groups = v;
    } else if (typeof v === "string" && v.trim() !== "") {
      const n = Number(v);
      if (!Number.isFinite(n)) return NextResponse.json({ error: "Invalid planned_groups" }, { status: 400 });
      planned_groups = n;
    } else {
      return NextResponse.json({ error: "Invalid planned_groups" }, { status: 400 });
    }
  }

  let tentative_groups = 0;
  if ("tentative_groups" in body || "tentativeGroups" in body) {
    const v = body.tentative_groups ?? body.tentativeGroups;
    if (typeof v === "number" && Number.isFinite(v)) tentative_groups = Math.max(0, Math.trunc(v));
    else if (typeof v === "string" && v.trim() !== "") {
      const n = Number(v);
      if (!Number.isFinite(n)) return NextResponse.json({ error: "Invalid tentative_groups" }, { status: 400 });
      tentative_groups = Math.max(0, Math.trunc(n));
    }
  }

  const at = body.action_type ?? body.actionType;
  const action_type =
    at === null || at === undefined || at === ""
      ? null
      : String(at).trim().slice(0, 64) || null;

  const ad = body.action_detail ?? body.actionDetail;
  const action_detail =
    ad === null || ad === undefined || ad === ""
      ? null
      : String(ad).trim().slice(0, 255) || null;

  const is_sabaki = Boolean(body.is_sabaki ?? body.isSabaki);

  const ph = body.public_holiday_reason ?? body.publicHolidayReason;
  const public_holiday_reason =
    ph === null || ph === "" ? null : String(ph).trim().slice(0, 1024) || null;

  const hh = body.half_holiday_reason ?? body.halfHolidayReason;
  const half_holiday_reason =
    hh === null || hh === "" ? null : String(hh).trim().slice(0, 1024) || null;

  const hr = body.has_reservation ?? body.hasReservation;
  const has_reservation =
    hr === null || hr === undefined || hr === ""
      ? null
      : typeof hr === "boolean"
        ? hr
        : Boolean(hr);

  const rd = body.reservation_details ?? body.reservationDetails;
  const reservation_details =
    rd === null || rd === "" ? null : String(rd).trim().slice(0, 2048) || null;

  let admin;
  try {
    admin = createServiceRoleClient();
  } catch (e) {
    logPostgrestError("POST attendance-logs createServiceRoleClient", e);
    return NextResponse.json({ error: "Server configuration error" }, { status: 500 });
  }

  const { data: cast, error: castErr } = await admin
    .from("casts")
    .select("id")
    .eq("id", castId)
    .eq("store_id", storeId)
    .eq("is_active", true)
    .maybeSingle();

  if (castErr || !cast) {
    return NextResponse.json({ error: "Cast not found" }, { status: 404 });
  }

  const { data: existing } = await admin
    .from("attendance_logs")
    .select("id")
    .eq("store_id", storeId)
    .eq("cast_id", castId)
    .eq("attended_date", attendedDate)
    .maybeSingle();

  if (existing?.id) {
    return NextResponse.json(
      { error: "この日付には既に打刻があります。更新する場合は保存（PATCH）を使用してください。" },
      { status: 409 }
    );
  }

  const insertRow: Database["public"]["Tables"]["attendance_logs"]["Insert"] = {
    store_id: storeId,
    cast_id: castId,
    attended_date: attendedDate,
    status: statusRaw as Database["public"]["Tables"]["attendance_logs"]["Row"]["status"],
    is_sabaki,
    planned_groups,
    tentative_groups,
    action_type,
    action_detail,
    public_holiday_reason,
    half_holiday_reason,
    has_reservation,
    reservation_details,
    attendance_schedule_id: null,
    /** 手動作成時はサーバー時刻で記録（通常の LINE 回答と同様に必須） */
    responded_at: new Date().toISOString(),
  };

  const { data: inserted, error: insErr } = await admin
    .from("attendance_logs")
    .insert(insertRow)
    .select("*")
    .single();

  if (insErr || !inserted) {
    if (insErr?.code === "23505") {
      return NextResponse.json({ error: "この日付には既に打刻があります。" }, { status: 409 });
    }
    logPostgrestError("POST attendance-logs insert", insErr ?? new Error("no row"));
    return NextResponse.json(
      { error: "Failed to create attendance log", details: insErr?.message },
      { status: 500 }
    );
  }

  const newId = String((inserted as { id: string }).id);
  const newSnap = JSON.parse(JSON.stringify(inserted)) as Json;

  const { error: histErr } = await admin.from("attendance_edit_histories").insert({
    subject_attendance_log_id: newId,
    attendance_log_id: newId,
    edited_by_admin_id: user.id,
    action_type: "INSERT",
    old_data: emptyOldDataForInsert(),
    new_data: newSnap,
  });

  if (histErr) {
    logPostgrestError("POST attendance-logs insert history", histErr);
    await admin.from("attendance_logs").delete().eq("id", newId);
    return NextResponse.json(
      { error: "Created log but failed to record audit history", details: histErr.message },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true, attendance_log: inserted });
}
