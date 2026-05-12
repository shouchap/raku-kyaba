import { NextResponse } from "next/server";
import type { User } from "@supabase/supabase-js";
import { createServiceRoleClient } from "@/lib/supabase-service";
import { canUserEditStore, getAuthedUserForAdminApi } from "@/lib/admin-store-auth";
import { isValidStoreId, parseActiveStoreIdFromCookieHeader } from "@/lib/current-store";
import { isSuperAdminUser } from "@/lib/super-admin";
import { sendPushMessage } from "@/lib/line-reply";
import { fetchResolvedLineChannelAccessTokenForStore } from "@/lib/line-channel-token";
import {
  applyReminderMessageTemplate,
  buildAttendanceRemindFlexMessage,
  formatRemindScheduledTime,
} from "@/lib/attendance-remind-flex";
import { getTodayJst } from "@/lib/date-utils";
import { normalizeDbTimeToShiftOption, parseShiftTimeStepMinutes } from "@/lib/time-options";

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
  const today = getTodayJst();

  const { data: store } = await admin
    .from("stores")
    .select("id, name, attendance_flow_type, regular_start_time, shift_time_step_minutes")
    .eq("id", storeId)
    .maybeSingle();
  if (!store?.id) return NextResponse.json({ error: "Store not found" }, { status: 404 });

  const { data: cast } = await admin
    .from("casts")
    .select("id, name, line_user_id")
    .eq("id", castId)
    .eq("store_id", storeId)
    .eq("is_active", true)
    .maybeSingle();
  if (!cast?.id) return NextResponse.json({ error: "Cast not found" }, { status: 404 });
  if (!cast.line_user_id) return NextResponse.json({ error: "選択したキャストはLINE未連携です" }, { status: 400 });

  const { data: sched } = await admin
    .from("attendance_schedules")
    .select("scheduled_time, is_dohan, is_sabaki")
    .eq("store_id", storeId)
    .eq("cast_id", cast.id)
    .eq("scheduled_date", today)
    .maybeSingle();

  const { data: cfg } = await admin
    .from("system_settings")
    .select("value, enable_public_holiday, enable_half_holiday")
    .eq("store_id", storeId)
    .eq("key", "reminder_config")
    .maybeSingle();
  const cfgValue =
    cfg?.value && typeof cfg.value === "object" && !Array.isArray(cfg.value)
      ? (cfg.value as { messageTemplate?: string })
      : undefined;
  const template =
    (typeof cfgValue?.messageTemplate === "string" && cfgValue.messageTemplate.trim()) ||
    "{name}さん、本日は {time} 出勤予定です。出勤確認をお願いいたします。";
  const testShiftStep = parseShiftTimeStepMinutes(
    (store as { shift_time_step_minutes?: unknown }).shift_time_step_minutes
  );
  const regularHm =
    normalizeDbTimeToShiftOption(
      (store as { regular_start_time?: string | null }).regular_start_time ?? null,
      testShiftStep
    ) || null;
  const scheduledTime = formatRemindScheduledTime(
    sched?.scheduled_time ?? null,
    sched?.is_dohan ?? false,
    regularHm
  );

  const msg = buildAttendanceRemindFlexMessage({
    castName: cast.name ?? "キャスト",
    scheduledTimeDisplay: scheduledTime,
    todayJst: today,
    storeName: store.name ?? null,
    reminderMessageLine: applyReminderMessageTemplate(template, cast.name ?? "キャスト", scheduledTime),
    showSabakiTimePicker: sched?.is_sabaki === true,
    flexOptions: {
      enablePublicHoliday: cfg?.enable_public_holiday === true,
      enableHalfHoliday: cfg?.enable_half_holiday === true,
    },
  });

  const token = await fetchResolvedLineChannelAccessTokenForStore(admin, storeId, "[AttendanceIndividualTest]");
  if (!token?.token) return NextResponse.json({ error: "LINEチャネルトークンが未設定です" }, { status: 400 });

  try {
    await sendPushMessage(cast.line_user_id, token.token, [msg]);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "LINE送信に失敗しました" },
      { status: 502 }
    );
  }
  return NextResponse.json({ ok: true, castName: cast.name, tokenSource: token.source });
}
