import { NextResponse } from "next/server";
import { canUserEditStore, getAuthedUserForAdminApi } from "@/lib/admin-store-auth";
import { createServiceRoleClient } from "@/lib/supabase-service";
import { fetchResolvedLineChannelAccessTokenForStore } from "@/lib/line-channel-token";
import {
  applyReminderMessageTemplate,
  buildAttendanceRemindFlexMessage,
  buildSabakiRemindLines,
  formatRemindScheduledTime,
} from "@/lib/attendance-remind-flex";
import { getTodayJst } from "@/lib/date-utils";
import { normalizeDbTimeToShiftOption } from "@/lib/time-options";
import { fetchAttendanceFlexHolidayOptions, fetchReminderMessageTemplate } from "@/lib/reminder-config";
import {
  buildRegularRemindMessageLine,
  employmentUsesRegularRemindMessage,
  shouldSkipRemindForCast,
} from "@/lib/remind-employment";
import { sendPushMessage } from "@/lib/line-reply";

type CastJoinRow = {
  name?: string | null;
  line_user_id?: string | null;
  employment_type?: string | null;
  is_admin?: boolean | null;
};

type ScheduleRow = {
  id: string;
  cast_id: string;
  scheduled_time: string | null;
  is_dohan: boolean | null;
  is_sabaki: boolean | null;
  casts: CastJoinRow | CastJoinRow[] | null;
};

function parseCastJoin(schedule: ScheduleRow): CastJoinRow | null {
  const raw = schedule.casts;
  const cast = Array.isArray(raw) ? raw[0] : raw;
  if (!cast?.line_user_id || String(cast.line_user_id).trim() === "") return null;
  return cast;
}

function buildScheduleMessageParts(params: {
  template: string;
  castName: string;
  scheduledTime: string | null;
  isDohan: boolean | null;
  isSabaki: boolean | null;
  employmentType: string | null | undefined;
  regularBody: string | null | undefined;
  regularFallbackHm: string | null | undefined;
}): { reminderMessageLine: string; scheduledTimeDisplay: string } {
  const scheduledTimeDisplay = formatRemindScheduledTime(
    params.scheduledTime,
    params.isDohan,
    params.regularFallbackHm
  );
  if (params.isSabaki === true) return buildSabakiRemindLines(params.castName);
  if (employmentUsesRegularRemindMessage(params.employmentType)) {
    return {
      reminderMessageLine: buildRegularRemindMessageLine(params.castName, params.regularBody),
      scheduledTimeDisplay,
    };
  }
  return {
    reminderMessageLine: applyReminderMessageTemplate(
      params.template,
      params.castName,
      scheduledTimeDisplay
    ),
    scheduledTimeDisplay,
  };
}

/**
 * 管理画面から当日分の出勤確認を即時一斉送信する（manual=true 相当）
 */
export async function POST(request: Request) {
  const { user, error: authErr } = await getAuthedUserForAdminApi();
  if (authErr === "config") return NextResponse.json({ error: "Supabase is not configured" }, { status: 500 });
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as { storeId?: string } | null;
  const storeId = body?.storeId?.trim() ?? "";
  if (!storeId) return NextResponse.json({ error: "storeId is required" }, { status: 400 });
  if (!canUserEditStore(user, storeId)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const admin = createServiceRoleClient();
  const todayJst = getTodayJst();

  const { data: store } = await admin
    .from("stores")
    .select("id, name, regular_remind_message, regular_start_time")
    .eq("id", storeId)
    .maybeSingle();
  if (!store?.id) return NextResponse.json({ error: "Store not found" }, { status: 404 });

  const token = await fetchResolvedLineChannelAccessTokenForStore(admin, storeId, "[AdminRemindBroadcast]");
  if (!token?.token) {
    return NextResponse.json(
      {
        ok: false,
        skipped: "no_line_token",
        successCount: 0,
        failureCount: 0,
        totalCandidates: 0,
        failedCastNames: [],
      },
      { status: 400 }
    );
  }

  const [template, holidayFlags] = await Promise.all([
    fetchReminderMessageTemplate(admin, storeId),
    fetchAttendanceFlexHolidayOptions(admin, storeId),
  ]);
  const regularFallbackHm = normalizeDbTimeToShiftOption(store.regular_start_time ?? null) || null;

  const { data: schedulesRaw, error: schedulesErr } = await admin
    .from("attendance_schedules")
    .select(
      "id, cast_id, scheduled_time, is_dohan, is_sabaki, casts(name, line_user_id, employment_type, is_admin)"
    )
    .eq("store_id", storeId)
    .eq("scheduled_date", todayJst)
    .or("scheduled_time.not.is.null,is_sabaki.eq.true");
  if (schedulesErr) {
    return NextResponse.json({ error: schedulesErr.message }, { status: 500 });
  }

  const schedules = ((schedulesRaw ?? []) as ScheduleRow[]).filter((schedule) => {
    const cast = parseCastJoin(schedule);
    if (!cast) return false;
    if (shouldSkipRemindForCast(cast.employment_type, cast.is_admin)) return false;
    return true;
  });

  const { data: existingTodaySched } = await admin
    .from("attendance_schedules")
    .select("cast_id")
    .eq("store_id", storeId)
    .eq("scheduled_date", todayJst);
  const castIdsWithAnyScheduleToday = new Set((existingTodaySched ?? []).map((r) => r.cast_id));

  const { data: regularRaw, error: regularErr } = await admin
    .from("casts")
    .select("id, name, line_user_id, employment_type, is_admin")
    .eq("store_id", storeId)
    .eq("is_active", true)
    .eq("employment_type", "regular")
    .not("line_user_id", "is", null);
  if (regularErr) return NextResponse.json({ error: regularErr.message }, { status: 500 });

  const regularNoSchedule = (regularRaw ?? [])
    .filter((c) => {
      if (castIdsWithAnyScheduleToday.has(c.id)) return false;
      if (shouldSkipRemindForCast(c.employment_type, c.is_admin)) return false;
      return true;
    })
    .map((c) => ({
      id: c.id,
      name: c.name ?? "キャスト",
      line_user_id: String(c.line_user_id),
    }));

  const totalCandidates = schedules.length + regularNoSchedule.length;
  if (totalCandidates === 0) {
    return NextResponse.json({
      ok: true,
      skipped: "no_targets",
      successCount: 0,
      failureCount: 0,
      totalCandidates: 0,
      failedCastNames: [],
    });
  }

  const lineResults = await Promise.allSettled([
    ...schedules.map(async (schedule) => {
      const cast = parseCastJoin(schedule);
      if (!cast?.line_user_id) throw new Error(`No line_user_id for schedule ${schedule.id}`);
      const castName = cast.name ?? "キャスト";
      const { reminderMessageLine, scheduledTimeDisplay } = buildScheduleMessageParts({
        template,
        castName,
        scheduledTime: schedule.scheduled_time,
        isDohan: schedule.is_dohan,
        isSabaki: schedule.is_sabaki,
        employmentType: cast.employment_type,
        regularBody: store.regular_remind_message,
        regularFallbackHm,
      });
      const message = buildAttendanceRemindFlexMessage({
        castName,
        scheduledTimeDisplay,
        todayJst,
        storeName: store.name,
        reminderMessageLine,
        showSabakiTimePicker: schedule.is_sabaki === true,
        flexOptions: {
          enablePublicHoliday: holidayFlags.enablePublicHoliday,
          enableHalfHoliday: holidayFlags.enableHalfHoliday,
        },
      });
      await sendPushMessage(cast.line_user_id, token.token, [message]);
      return { kind: "schedule" as const, scheduleId: schedule.id };
    }),
    ...regularNoSchedule.map(async (cast) => {
      const reminderMessageLine = buildRegularRemindMessageLine(
        cast.name,
        store.regular_remind_message
      );
      const scheduledTimeDisplay = formatRemindScheduledTime(null, false, regularFallbackHm);
      const message = buildAttendanceRemindFlexMessage({
        castName: cast.name,
        scheduledTimeDisplay,
        todayJst,
        storeName: store.name,
        reminderMessageLine,
        flexOptions: {
          enablePublicHoliday: holidayFlags.enablePublicHoliday,
          enableHalfHoliday: holidayFlags.enableHalfHoliday,
        },
      });
      await sendPushMessage(cast.line_user_id, token.token, [message]);
      return { kind: "regular" as const, castId: cast.id };
    }),
  ]);

  const nowIso = new Date().toISOString();
  const okSchedules: string[] = [];
  const okRegulars: string[] = [];
  lineResults.forEach((r) => {
    if (r.status !== "fulfilled") return;
    if (r.value.kind === "schedule") okSchedules.push(r.value.scheduleId);
    if (r.value.kind === "regular") okRegulars.push(r.value.castId);
  });

  if (okSchedules.length > 0) {
    await Promise.all(
      okSchedules.map(async (scheduleId) => {
        await admin
          .from("attendance_schedules")
          .update({ last_reminded_at: nowIso })
          .eq("id", scheduleId);
      })
    );
  }
  if (okRegulars.length > 0) {
    await Promise.all(
      okRegulars.map(async (castId) => {
        await admin
          .from("casts")
          .update({ last_reminder_sent_date: todayJst, updated_at: nowIso })
          .eq("id", castId);
      })
    );
  }

  const successCount = lineResults.filter((r) => r.status === "fulfilled").length;
  const failureCount = lineResults.filter((r) => r.status === "rejected").length;
  const failedCastNames = Array.from(
    new Set(
      lineResults
        .map((result, idx) => {
          if (result.status !== "rejected") return null;
          if (idx < schedules.length) {
            const cast = parseCastJoin(schedules[idx]);
            return cast?.name ?? "キャスト";
          }
          const regularIdx = idx - schedules.length;
          return regularNoSchedule[regularIdx]?.name ?? "キャスト";
        })
        .filter((name): name is string => Boolean(name))
    )
  );

  return NextResponse.json({
    ok: true,
    storeId,
    todayJst,
    successCount,
    failureCount,
    totalCandidates,
    skipped: null,
    failedCastNames,
  });
}
