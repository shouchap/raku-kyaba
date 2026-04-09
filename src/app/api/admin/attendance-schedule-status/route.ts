import { NextResponse } from "next/server";
import { canUserEditStore, getAuthedUserForAdminApi } from "@/lib/admin-store-auth";
import { assertStoreIdMatchesRequest } from "@/lib/current-store";
import { createServiceRoleClient } from "@/lib/supabase-service";

export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

type Body = {
  storeId?: string;
  castId?: string;
  scheduledDate?: string;
  /** 集計・表示用。null で未回答扱いに戻す（理由はクリア） */
  responseStatus?:
    | "attending"
    | "absent"
    | "late"
    | "public_holiday"
    | "half_holiday"
    | null;
  public_holiday_reason?: string | null;
  half_holiday_reason?: string | null;
  late_reason?: string | null;
  absent_reason?: string | null;
};

/**
 * 管理者が過去日の勤怠ステータスを手動で上書き（リカバリー用）
 * POST /api/admin/attendance-schedule-status
 */
export async function POST(request: Request) {
  const { user, error: authErr } = await getAuthedUserForAdminApi();
  if (authErr === "config") {
    return NextResponse.json({ error: "Supabase is not configured" }, { status: 500 });
  }
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: Body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const storeId = body.storeId?.trim() ?? "";
  const castId = body.castId?.trim() ?? "";
  const scheduledDate = body.scheduledDate?.trim() ?? "";
  if (!storeId || !castId || !DATE_RE.test(scheduledDate)) {
    return NextResponse.json(
      { error: "storeId, castId, scheduledDate (YYYY-MM-DD) are required" },
      { status: 400 }
    );
  }

  try {
    assertStoreIdMatchesRequest(request, storeId);
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (!canUserEditStore(user, storeId)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let admin: ReturnType<typeof createServiceRoleClient>;
  try {
    admin = createServiceRoleClient();
  } catch {
    return NextResponse.json({ error: "Server configuration error" }, { status: 500 });
  }

  const rs = body.responseStatus ?? null;

  const patch: Record<string, unknown> = {
    response_status: rs,
    is_absent: rs === "absent",
    is_late: rs === "late",
    is_action_completed: rs != null,
    pending_line_flow: null,
    pending_line_updated_at: null,
    updated_at: new Date().toISOString(),
  };

  if (rs === "public_holiday") {
    patch.public_holiday_reason = body.public_holiday_reason ?? null;
    patch.half_holiday_reason = null;
    patch.late_reason = null;
    patch.absent_reason = null;
  } else if (rs === "half_holiday") {
    patch.half_holiday_reason = body.half_holiday_reason ?? null;
    patch.public_holiday_reason = null;
    patch.late_reason = null;
    patch.absent_reason = null;
  } else if (rs === "late") {
    patch.late_reason = body.late_reason ?? null;
    patch.public_holiday_reason = null;
    patch.half_holiday_reason = null;
    patch.absent_reason = null;
  } else if (rs === "absent") {
    patch.absent_reason = body.absent_reason ?? null;
    patch.public_holiday_reason = null;
    patch.half_holiday_reason = null;
    patch.late_reason = null;
  } else {
    patch.public_holiday_reason = null;
    patch.half_holiday_reason = null;
    patch.late_reason = null;
    patch.absent_reason = null;
  }

  const { data: updated, error: upErr } = await admin.from("attendance_schedules").update(patch)
    .eq("store_id", storeId)
    .eq("cast_id", castId)
    .eq("scheduled_date", scheduledDate)
    .select("id")
    .maybeSingle();

  if (upErr) {
    console.error("[attendance-schedule-status]", upErr);
    return NextResponse.json({ error: upErr.message }, { status: 500 });
  }

  if (!updated?.id) {
    return NextResponse.json(
      { error: "該当する出勤予定行がありません。単日登録でシフトを先に作成してください。" },
      { status: 404 }
    );
  }

  return NextResponse.json({ ok: true, scheduleId: updated.id });
}
