import { NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { sendPushMessage, sendMulticastMessage } from "@/lib/line-reply";
import {
  applyReminderMessageTemplate,
  buildAttendanceRemindFlexMessage,
  buildSabakiRemindLines,
  formatCastNameAttendanceSuffix,
  formatRemindScheduledTime,
} from "@/lib/attendance-remind-flex";
import { getCurrentTimeJst, getTodayJst, getWeekdayJst } from "@/lib/date-utils";
import {
  buildRegularRemindMessageLine,
  employmentUsesRegularRemindMessage,
  shouldSkipRemindForCast,
} from "@/lib/remind-employment";
import { resolveActiveStoreIdFromRequest } from "@/lib/current-store";
import {
  logResolvedLineToken,
  resolveLineChannelAccessToken,
} from "@/lib/line-channel-token";
import type { HolidayFlexFlags } from "@/lib/reminder-config";
import { isUndefinedColumnError } from "@/lib/postgrest-error";

/** キャッシュ無効化: 毎回最新のDB値を取得する */
export const dynamic = "force-dynamic";

/** バッチ処理はサービスロール必須（全店舗走査・RLS バイパス） */
function getSupabaseKeys(): { url: string | null; key: string | null; isServiceRole: boolean } {
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL)?.trim() ?? null;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (service) return { url, key: service, isServiceRole: true };
  return { url, key: anon ?? null, isServiceRole: false };
}

/** 管理者の line_user_id 一覧を取得（warn-unanswered と同様のロジック） */
async function getAdminLineUserIds(
  supabase: SupabaseClient,
  storeId: string
): Promise<string[]> {
  const { data: adminCasts } = await supabase
    .from("casts")
    .select("line_user_id")
    .eq("store_id", storeId)
    .eq("is_admin", true)
    .eq("is_active", true)
    .not("line_user_id", "is", null);

  const fromCasts = (adminCasts ?? [])
    .map((r: { line_user_id?: string }) => r.line_user_id)
    .filter((id): id is string => !!id && id.trim() !== "");

  if (fromCasts.length > 0) return fromCasts;

  const { data: store } = await supabase
    .from("stores")
    .select("admin_line_user_id")
    .eq("id", storeId)
    .single();

  const legacyId = (store as { admin_line_user_id?: string | null })?.admin_line_user_id;
  if (legacyId && String(legacyId).trim() !== "") return [legacyId];

  return [];
}

type ReminderConfig = {
  enabled?: boolean;
  sendTime?: string;
  send_time?: string;
  messageTemplate?: string;
  template?: string;
  reply_present?: string;
  reply_late?: string;
  reply_absent?: string;
  admin_notify_late?: string;
  admin_notify_absent?: string;
  admin_notify_new_cast?: string;
  welcome_message?: string;
};

/** reminder_config の文字列フィールドを undefined なら "" に正規化（JSONエラー防止） */
function sanitizeReminderConfig(raw: Record<string, unknown>): Record<string, string | boolean> {
  const stringKeys = [
    "sendTime",
    "messageTemplate",
    "reply_present",
    "reply_late",
    "reply_absent",
    "admin_notify_late",
    "admin_notify_absent",
    "admin_notify_new_cast",
    "welcome_message",
  ] as const;
  const out: Record<string, string | boolean> = { ...raw } as Record<string, string | boolean>;
  for (const k of stringKeys) {
    const v = raw[k];
    out[k] = typeof v === "string" ? v : "";
  }
  if (!out.sendTime && typeof raw.send_time === "string") out.sendTime = raw.send_time;
  if (!out.messageTemplate && typeof raw.template === "string") out.messageTemplate = raw.template;
  return out;
}

/** DBに未設定の場合のフォールバック（空文字時のみ使用） */
const DEFAULT_TEMPLATE =
  "{name}さん、本日は {time} 出勤予定です。出勤確認をお願いいたします。";

/** reminder_config が空・未設定時のデフォルト値 */
const DEFAULT_REMINDER_CONFIG: ReminderConfig = {
  enabled: true,
  sendTime: "12:00",
  messageTemplate: DEFAULT_TEMPLATE,
};

function logError(context: string, err: unknown): void {
  const msg = err instanceof Error ? err.message : String(err);
  const stack = err instanceof Error ? err.stack : undefined;
  const extra =
    err && typeof err === "object" && !(err instanceof Error)
      ? JSON.stringify(err, null, 2)
      : "";
  console.error(`[Remind] ${context}:`, msg);
  if (stack) console.error(`[Remind] ${context} stack:`, stack);
  if (extra) console.error(`[Remind] ${context} details:`, extra);
}

/** stores.remind_time（HH:00）から時（0〜23）を取得 */
function parseRemindHourJst(remindTime: string | null | undefined): number | null {
  const s = String(remindTime ?? "").trim();
  const m = s.match(/^(\d{1,2}):00$/);
  if (!m) return null;
  const h = parseInt(m[1], 10);
  if (Number.isNaN(h) || h < 0 || h > 23) return null;
  return h;
}

type StoreRow = {
  id: string;
  name: string | null;
  remind_time: string | null;
  last_reminded_date: string | null;
  line_channel_access_token: string | null;
  /** 定休日（0=日〜6=土）。未マイグレーション時は null */
  regular_holidays?: number[] | null;
  /** レギュラー向け本文。未マイグレーション時は null */
  regular_remind_message?: string | null;
};

async function loadReminderConfig(
  supabase: SupabaseClient,
  storeId: string
): Promise<{
  config: ReminderConfig;
  rawConfig: Record<string, unknown>;
  messageTemplate: string;
  holidayFlex: HolidayFlexFlags;
} | null> {
  const fullSelect = await supabase
    .from("system_settings")
    .select("value, enable_public_holiday, enable_half_holiday")
    .eq("store_id", storeId)
    .eq("key", "reminder_config")
    .maybeSingle();

  let settingsRow: {
    value: unknown;
    enable_public_holiday?: boolean | null;
    enable_half_holiday?: boolean | null;
  } | null = null;

  if (fullSelect.error) {
    if (isUndefinedColumnError(fullSelect.error, "enable_public_holiday")) {
      const fallback = await supabase
        .from("system_settings")
        .select("value")
        .eq("store_id", storeId)
        .eq("key", "reminder_config")
        .maybeSingle();
      if (fallback.error) {
        logError(`reminder_config 取得失敗 store=${storeId}`, fallback.error);
        return null;
      }
      settingsRow = {
        value: fallback.data?.value,
        enable_public_holiday: false,
        enable_half_holiday: false,
      };
    } else {
      logError(`reminder_config 取得失敗 store=${storeId}`, fullSelect.error);
      return null;
    }
  } else {
    settingsRow = fullSelect.data as typeof settingsRow;
  }

  const holidayFlex: HolidayFlexFlags = {
    enablePublicHoliday: settingsRow?.enable_public_holiday === true,
    enableHalfHoliday: settingsRow?.enable_half_holiday === true,
  };

  const rawConfig = (settingsRow?.value ?? {}) as Record<string, unknown>;
  const sanitized = sanitizeReminderConfig(rawConfig);

  const config: ReminderConfig = {
    ...DEFAULT_REMINDER_CONFIG,
    ...sanitized,
    enabled: rawConfig.enabled === false ? false : DEFAULT_REMINDER_CONFIG.enabled,
    sendTime:
      (sanitized.sendTime && String(sanitized.sendTime).trim()) ||
      (typeof rawConfig.send_time === "string" && rawConfig.send_time.trim()) ||
      DEFAULT_REMINDER_CONFIG.sendTime,
    messageTemplate:
      (sanitized.messageTemplate && String(sanitized.messageTemplate).trim()) ||
      (typeof rawConfig.template === "string" && rawConfig.template.trim()) ||
      DEFAULT_REMINDER_CONFIG.messageTemplate,
  };

  const rawTemplate =
    (config.messageTemplate && String(config.messageTemplate).trim()) ||
    (config.template && String(config.template).trim()) ||
    (typeof rawConfig.messageTemplate === "string" && rawConfig.messageTemplate.trim()) ||
    (typeof rawConfig.template === "string" && rawConfig.template.trim()) ||
    "本日は {time} 出勤予定です。";
  const messageTemplate = rawTemplate.trim() || "本日は {time} 出勤予定です。";

  return { config, rawConfig, messageTemplate, holidayFlex };
}

const minutesFromScheduledTime = (time: string | null | undefined): number => {
  if (!time) return Number.MAX_SAFE_INTEGER;
  const m = String(time).match(/^(\d{1,2}):(\d{2})/);
  if (!m) return Number.MAX_SAFE_INTEGER;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
};

type CastJoinRow = {
  name?: string | null;
  line_user_id?: string | null;
  employment_type?: string | null;
  is_admin?: boolean | null;
};

function parseCastJoinFromSchedule(schedule: { casts: unknown }): CastJoinRow | null {
  const raw = schedule.casts as CastJoinRow | CastJoinRow[] | null;
  const c = Array.isArray(raw) ? raw[0] : raw;
  if (!c?.line_user_id || String(c.line_user_id).trim() === "") return null;
  return c;
}

/** シフト行があるキャスト向け: 捌きは専用文／レギュラーは店舗設定本文／バイトはテンプレ＋時刻 */
function buildScheduleRemindParts(
  messageTemplate: string,
  castName: string,
  schedule: {
    scheduled_time: string | null;
    is_dohan: boolean | null;
    is_sabaki?: boolean | null;
  },
  employmentType: string | null | undefined,
  regularRemindMessageFromStore: string | null | undefined
): { reminderMessageLine: string; scheduledTimeDisplay: string } {
  if (schedule.is_sabaki === true) {
    return buildSabakiRemindLines(castName);
  }
  const scheduledTime = formatRemindScheduledTime(schedule.scheduled_time, schedule.is_dohan);
  if (employmentUsesRegularRemindMessage(employmentType)) {
    return {
      reminderMessageLine: buildRegularRemindMessageLine(
        castName,
        regularRemindMessageFromStore
      ),
      scheduledTimeDisplay: scheduledTime,
    };
  }
  return {
    reminderMessageLine: applyReminderMessageTemplate(messageTemplate, castName, scheduledTime),
    scheduledTimeDisplay: scheduledTime,
  };
}

/**
 * 1店舗分のリマインド送信。
 * isManual: 設定画面のテスト用。時刻・店舗の last_reminded_date ゲートを無視し、送信枠 RPC も使わない（上書き更新）。
 */
async function runRemindForStore(
  supabase: SupabaseClient,
  store: StoreRow,
  opts: { isManual: boolean; todayJst: string; hourJst: number }
): Promise<{
  storeId: string;
  skipped?: string;
  successCount: number;
  failureCount: number;
  totalCandidates: number;
}> {
  const { isManual, todayJst, hourJst } = opts;
  const storeId = store.id;
  const storeLabel = (store.name ?? "").trim() || "（店舗名未設定）";

  const remindHour = parseRemindHourJst(store.remind_time ?? "07:00");
  if (remindHour === null) {
    return { storeId, skipped: "invalid_remind_time", successCount: 0, failureCount: 0, totalCandidates: 0 };
  }

  const dowJst = getWeekdayJst(todayJst);
  const closedDays = store.regular_holidays;
  if (Array.isArray(closedDays) && closedDays.includes(dowJst)) {
    console.info(
      `[Remind] 定休日のためスキップ ${storeLabel} (ID: ${storeId}) weekday=${dowJst}`
    );
    return { storeId, skipped: "regular_holiday", successCount: 0, failureCount: 0, totalCandidates: 0 };
  }

  if (!isManual) {
    if (remindHour !== hourJst) {
      console.info(
        `[Remind] Skipping ${storeLabel} (ID: ${storeId}) - remind_time_hour (${remindHour}) does not match current_hour (${hourJst})`
      );
      return { storeId, skipped: "hour_mismatch", successCount: 0, failureCount: 0, totalCandidates: 0 };
    }
    const sentDate = store.last_reminded_date?.trim() ?? null;
    if (sentDate === todayJst) {
      return { storeId, skipped: "already_reminded_today", successCount: 0, failureCount: 0, totalCandidates: 0 };
    }
  }

  const resolvedToken = resolveLineChannelAccessToken(store.line_channel_access_token);
  logResolvedLineToken(storeId, resolvedToken, "[Remind]");
  const channelAccessToken = resolvedToken.token;
  if (!channelAccessToken) {
    logError(
      `LINE チャネルアクセストークンなし store=${storeId}`,
      new Error(
        "stores.line_channel_access_token が空か未設定で、環境変数 LINE_CHANNEL_ACCESS_TOKEN も未設定です"
      )
    );
    return { storeId, skipped: "no_line_token", successCount: 0, failureCount: 0, totalCandidates: 0 };
  }

  const loaded = await loadReminderConfig(supabase, storeId);
  if (!loaded) {
    return { storeId, skipped: "settings_error", successCount: 0, failureCount: 0, totalCandidates: 0 };
  }
  const { config, messageTemplate, holidayFlex } = loaded;
  const regularRemindMessageFromStore = store.regular_remind_message;

  if (config.enabled === false) {
    console.info(
      `[Remind] Skipping ${storeLabel} (ID: ${storeId}) - is_remind_active is false`
    );
    return { storeId, skipped: "reminder_disabled", successCount: 0, failureCount: 0, totalCandidates: 0 };
  }

  const { data: rawSchedules, error } = await supabase
    .from("attendance_schedules")
    .select(
      "id, cast_id, store_id, scheduled_date, scheduled_time, is_dohan, is_sabaki, last_reminded_at, casts(name, line_user_id, employment_type, is_admin)"
    )
    .eq("store_id", storeId)
    .eq("scheduled_date", todayJst)
    .or("scheduled_time.not.is.null,is_sabaki.eq.true");

  if (error) {
    logError(`出勤予定取得失敗 store=${storeId}`, error);
    return { storeId, skipped: "fetch_error", successCount: 0, failureCount: 0, totalCandidates: 0 };
  }

  let schedules = (rawSchedules ?? []).filter((s) => {
    const t = s.scheduled_time;
    const hasTime = t != null && String(t).trim() !== "";
    const isSabaki = s.is_sabaki === true;
    if (!hasTime && !isSabaki) return false;
    const c = parseCastJoinFromSchedule(s);
    if (!c) return false;
    if (shouldSkipRemindForCast(c.employment_type, c.is_admin)) return false;
    if (isManual) return true;
    const lastReminded = s.last_reminded_at;
    if (!lastReminded) return true;
    const lastRemindedDate = new Date(lastReminded).toLocaleDateString("en-CA", {
      timeZone: "Asia/Tokyo",
    });
    if (lastRemindedDate === todayJst) return false;
    return true;
  });

  const { data: existingTodaySched } = await supabase
    .from("attendance_schedules")
    .select("cast_id")
    .eq("store_id", storeId)
    .eq("scheduled_date", todayJst);

  const castIdsWithAnyScheduleToday = new Set((existingTodaySched ?? []).map((r) => r.cast_id));

  const { data: regularCastsRaw, error: regErr } = await supabase
    .from("casts")
    .select("id, name, line_user_id, employment_type, is_admin")
    .eq("store_id", storeId)
    .eq("is_active", true)
    .eq("employment_type", "regular")
    .not("line_user_id", "is", null);

  if (regErr) {
    logError(`レギュラーキャスト取得失敗 store=${storeId}`, regErr);
  }

  const regularNoSchedule = (regularCastsRaw ?? [])
    .filter((c) => {
      if (castIdsWithAnyScheduleToday.has(c.id)) return false;
      if (shouldSkipRemindForCast(c.employment_type, c.is_admin)) return false;
      return true;
    })
    .map((c) => ({
      id: c.id,
      name: c.name ?? "キャスト",
      line_user_id: c.line_user_id as string,
    }));

  const totalCandidates = schedules.length + regularNoSchedule.length;

  if (totalCandidates === 0) {
    return { storeId, skipped: "no_targets", successCount: 0, failureCount: 0, totalCandidates: 0 };
  }

  const nowIso = new Date().toISOString();
  type ScheduleRow = (typeof schedules)[number];

  type SentItem = { name: string; sortMinutes: number };

  const buildSentItemFromSchedule = (s: ScheduleRow): SentItem => {
    const c = parseCastJoinFromSchedule(s);
    const baseName = c?.name ?? "キャスト";
    const name = `${baseName}${formatCastNameAttendanceSuffix(s.is_dohan, s.is_sabaki)}`;
    if (s.is_sabaki === true) {
      return {
        name,
        sortMinutes: minutesFromScheduledTime(s.scheduled_time),
      };
    }
    if (employmentUsesRegularRemindMessage(c?.employment_type)) {
      return {
        name,
        sortMinutes: minutesFromScheduledTime(s.scheduled_time),
      };
    }
    return {
      name,
      sortMinutes: minutesFromScheduledTime(s.scheduled_time),
    };
  };

  const notifyAdmins = async (sentItems: SentItem[]) => {
    if (sentItems.length === 0) return;
    try {
      const adminIds = await getAdminLineUserIds(supabase, storeId);
      if (adminIds.length > 0) {
        const sorted = [...sentItems].sort((a, b) => a.sortMinutes - b.sortMinutes);
        const nameList = sorted.map(({ name }) => `・${name}`).join("\n");
        const adminMessage = `【システム通知】本日、以下の${sentItems.length}名に出勤確認のリマインドを送信しました。\n${nameList}`;
        await sendMulticastMessage(adminIds, channelAccessToken, [
          { type: "text", text: adminMessage },
        ]);
      }
    } catch (adminErr) {
      logError("管理者への送信完了報告失敗", adminErr);
    }
  };

  if (isManual) {
    const lineResults = await Promise.allSettled([
      ...schedules.map(async (schedule) => {
        const c = parseCastJoinFromSchedule(schedule);
        if (!c) throw new Error(`No cast for schedule ${schedule.id}`);
        const name = c.name ?? "キャスト";
        const { reminderMessageLine, scheduledTimeDisplay } = buildScheduleRemindParts(
          messageTemplate,
          name,
          schedule,
          c.employment_type,
          regularRemindMessageFromStore
        );
        const message = buildAttendanceRemindFlexMessage({
          castName: name,
          scheduledTimeDisplay,
          todayJst,
          storeName: store.name,
          flexOptions: {
            enablePublicHoliday: holidayFlex.enablePublicHoliday,
            enableHalfHoliday: holidayFlex.enableHalfHoliday,
          },
          reminderMessageLine,
          showSabakiTimePicker: schedule.is_sabaki === true,
        });
        await sendPushMessage(c.line_user_id as string, channelAccessToken, [message]);
        return { kind: "schedule" as const, schedule };
      }),
      ...regularNoSchedule.map(async (rc) => {
        const reminderMessageLine = buildRegularRemindMessageLine(
          rc.name,
          regularRemindMessageFromStore
        );
        const message = buildAttendanceRemindFlexMessage({
          castName: rc.name,
          scheduledTimeDisplay: "—",
          todayJst,
          storeName: store.name,
          flexOptions: {
            enablePublicHoliday: holidayFlex.enablePublicHoliday,
            enableHalfHoliday: holidayFlex.enableHalfHoliday,
          },
          reminderMessageLine,
        });
        await sendPushMessage(rc.line_user_id, channelAccessToken, [message]);
        return { kind: "regular" as const, castId: rc.id };
      }),
    ]);

    const fulfilled = lineResults.filter((r) => r.status === "fulfilled") as PromiseFulfilledResult<
      | { kind: "schedule"; schedule: ScheduleRow }
      | { kind: "regular"; castId: string }
    >[];

    const okSchedules = fulfilled
      .map((r) => r.value)
      .filter((v): v is { kind: "schedule"; schedule: ScheduleRow } => v.kind === "schedule")
      .map((v) => v.schedule);

    const okRegularIds = fulfilled
      .map((r) => r.value)
      .filter((v): v is { kind: "regular"; castId: string } => v.kind === "regular")
      .map((v) => v.castId);

    if (okSchedules.length > 0) {
      await Promise.all(
        okSchedules.map(async (schedule) => {
          const { error: updateError } = await supabase
            .from("attendance_schedules")
            .update({ last_reminded_at: nowIso })
            .eq("id", schedule.id);
          if (updateError) {
            logError(`last_reminded_at 更新失敗 scheduleId=${schedule.id}`, updateError);
          }
        })
      );
    }

    if (okRegularIds.length > 0) {
      await Promise.all(
        okRegularIds.map(async (castId) => {
          const { error: updErr } = await supabase
            .from("casts")
            .update({ last_reminder_sent_date: todayJst, updated_at: nowIso })
            .eq("id", castId);
          if (updErr) {
            logError(`last_reminder_sent_date 更新失敗 castId=${castId}`, updErr);
          }
        })
      );
    }

    const successCount = fulfilled.length;
    const failureCount = lineResults.filter((r) => r.status === "rejected").length;

    if (successCount > 0) {
      const sentItems: SentItem[] = [
        ...okSchedules.map(buildSentItemFromSchedule),
        ...regularNoSchedule
          .filter((r) => okRegularIds.includes(r.id))
          .map(
            (r): SentItem => ({
              name: r.name,
              sortMinutes: Number.MAX_SAFE_INTEGER,
            })
          ),
      ];
      await notifyAdmins(sentItems);
    }

    return {
      storeId,
      successCount,
      failureCount,
      totalCandidates,
    };
  }

  /** 本番: シフト行は RPC、シフトなしレギュラーは claim_reminder_cast_send */
  const lineResults = await Promise.allSettled([
    ...schedules.map(async (schedule) => {
      const { data: claimRows, error: claimErr } = await supabase.rpc(
        "claim_reminder_schedule_send",
        { p_schedule_id: schedule.id, p_today: todayJst }
      );

      if (claimErr) {
        throw claimErr;
      }

      const row = Array.isArray(claimRows) ? claimRows[0] : claimRows;
      const claimed =
        row && typeof row === "object" && (row as { claimed?: boolean }).claimed === true;
      const prior =
        row && typeof row === "object"
          ? (row as { prior_last_reminded_at: string | null }).prior_last_reminded_at ?? null
          : null;

      if (!claimed) {
        return { kind: "schedule" as const, schedule, skipped: true as const, prior };
      }

      const c = parseCastJoinFromSchedule(schedule);
      if (!c?.line_user_id) {
        await supabase.rpc("restore_reminder_schedule_last_reminded_at", {
          p_schedule_id: schedule.id,
          p_prior_last_reminded_at: prior,
        });
        throw new Error(`No line_user_id for schedule ${schedule.id}`);
      }

      const name = c.name ?? "キャスト";
      const { reminderMessageLine, scheduledTimeDisplay } = buildScheduleRemindParts(
        messageTemplate,
        name,
        schedule,
        c.employment_type,
        regularRemindMessageFromStore
      );
      const message = buildAttendanceRemindFlexMessage({
        castName: name,
        scheduledTimeDisplay,
        todayJst,
        storeName: store.name,
        flexOptions: {
          enablePublicHoliday: holidayFlex.enablePublicHoliday,
          enableHalfHoliday: holidayFlex.enableHalfHoliday,
        },
        reminderMessageLine,
        showSabakiTimePicker: schedule.is_sabaki === true,
      });

      try {
        await sendPushMessage(c.line_user_id, channelAccessToken, [message]);
      } catch (pushErr) {
        await supabase.rpc("restore_reminder_schedule_last_reminded_at", {
          p_schedule_id: schedule.id,
          p_prior_last_reminded_at: prior,
        });
        throw pushErr;
      }

      return { kind: "schedule" as const, schedule, skipped: false as const, prior };
    }),
    ...regularNoSchedule.map(async (rc) => {
      const { data: claimRows, error: claimErr } = await supabase.rpc("claim_reminder_cast_send", {
        p_cast_id: rc.id,
        p_today: todayJst,
      });

      if (claimErr) {
        logError(`claim_reminder_cast_send RPC 未適用または失敗 castId=${rc.id}`, claimErr);
        throw claimErr;
      }

      const row = Array.isArray(claimRows) ? claimRows[0] : claimRows;
      const claimed =
        row && typeof row === "object" && (row as { claimed?: boolean }).claimed === true;
      const priorDate =
        row && typeof row === "object"
          ? (row as { prior_last_reminder_sent_date: string | null }).prior_last_reminder_sent_date ??
            null
          : null;

      if (!claimed) {
        return { kind: "regular" as const, castId: rc.id, skipped: true as const, priorDate };
      }

      const reminderMessageLine = buildRegularRemindMessageLine(
        rc.name,
        regularRemindMessageFromStore
      );
      const message = buildAttendanceRemindFlexMessage({
        castName: rc.name,
        scheduledTimeDisplay: "—",
        todayJst,
        storeName: store.name,
        flexOptions: {
          enablePublicHoliday: holidayFlex.enablePublicHoliday,
          enableHalfHoliday: holidayFlex.enableHalfHoliday,
        },
        reminderMessageLine,
      });

      try {
        await sendPushMessage(rc.line_user_id, channelAccessToken, [message]);
      } catch (pushErr) {
        await supabase.rpc("restore_reminder_cast_last_reminder_sent_date", {
          p_cast_id: rc.id,
          p_prior: priorDate,
        });
        throw pushErr;
      }

      return { kind: "regular" as const, castId: rc.id, skipped: false as const, priorDate };
    }),
  ]);

  const sentSchedules: ScheduleRow[] = [];
  const sentRegularIds: string[] = [];

  for (let i = 0; i < lineResults.length; i++) {
    const r = lineResults[i];
    if (r.status !== "fulfilled") {
      const idx = i;
      if (idx < schedules.length) {
        logError(`LINE Push 失敗 scheduleId=${schedules[idx]?.id}`, r.reason);
      } else {
        const rIdx = idx - schedules.length;
        logError(`LINE Push 失敗 regular castId=${regularNoSchedule[rIdx]?.id}`, r.reason);
      }
      continue;
    }
    const v = r.value;
    if (v.kind === "schedule" && !v.skipped) {
      sentSchedules.push(v.schedule);
    }
    if (v.kind === "regular" && !v.skipped) {
      sentRegularIds.push(v.castId);
    }
  }

  const successCount = sentSchedules.length + sentRegularIds.length;
  const failureCount = lineResults.filter((r) => r.status === "rejected").length;

  if (successCount > 0) {
    const { error: storeUpdErr } = await supabase
      .from("stores")
      .update({ last_reminded_date: todayJst, updated_at: nowIso })
      .eq("id", storeId);

    if (storeUpdErr) {
      logError(`last_reminded_date 更新失敗 store=${storeId}`, storeUpdErr);
    }

    const sentItems: SentItem[] = [
      ...sentSchedules.map(buildSentItemFromSchedule),
      ...regularNoSchedule
        .filter((r) => sentRegularIds.includes(r.id))
        .map(
          (r): SentItem => ({
            name: r.name,
            sortMinutes: Number.MAX_SAFE_INTEGER,
          })
        ),
    ];
    await notifyAdmins(sentItems);
  }

  return {
    storeId,
    successCount,
    failureCount,
    totalCandidates,
  };
}

/**
 * 本日出勤予定のキャストへリマインド（Flex Message）を送信するAPI
 *
 * - 本番（manual なし）: JST の現在時刻の「時」と一致する remind_time の店舗のみ、
 *   かつ last_reminded_date が本日でない店舗のみ処理。送信成功後に last_reminded_date を更新。
 * - テスト（manual=true）: Cookie/環境の1店舗のみ、時刻・店舗日付ゲートなし。
 */
export async function GET(request: Request) {
  try {
    return await handleRemind(request);
  } catch (err) {
    console.error("[Remind] Full Error details:", err);
    logError("予期しないエラー", err);
    return NextResponse.json(
      {
        error: "Internal server error",
        details: err instanceof Error ? err.message : String(err),
      },
      { status: 500 }
    );
  }
}

async function handleRemind(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && cronSecret.trim() !== "") {
    const authHeader = request.headers.get("authorization");
    const expected = `Bearer ${cronSecret.trim()}`;
    if (authHeader?.trim() !== expected) {
      return NextResponse.json(
        { error: "Unauthorized", message: "Invalid or missing Authorization header" },
        { status: 401 }
      );
    }
  }

  const { url, key, isServiceRole } = getSupabaseKeys();
  if (!url || !key) {
    return NextResponse.json(
      { error: "Supabase URL or key is not configured" },
      { status: 500 }
    );
  }

  const urlObj = new URL(request.url);
  const isManual = urlObj.searchParams.get("manual") === "true";

  if (!isManual && !isServiceRole) {
    return NextResponse.json(
      {
        error: "Configuration error",
        message:
          "Multi-store cron requires SUPABASE_SERVICE_ROLE_KEY. Set the service role key for server-side batch jobs.",
      },
      { status: 500 }
    );
  }

  const supabase = createClient(url, key);
  const todayJst = getTodayJst();
  const hourJst = getCurrentTimeJst().hour;

  console.log(
    `[Remind] JST today=${todayJst} hour=${hourJst} manual=${isManual} serviceRole=${isServiceRole} utc=${new Date().toISOString()}`
  );

  if (isManual) {
    let storeId: string;
    try {
      storeId = resolveActiveStoreIdFromRequest(request);
    } catch (e) {
      return NextResponse.json(
        {
          error: "Tenant not configured",
          details: e instanceof Error ? e.message : String(e),
        },
        { status: 500 }
      );
    }

    const { data: store, error: storeErr } = await supabase
      .from("stores")
      .select(
        "id, name, remind_time, last_reminded_date, line_channel_access_token, regular_holidays, regular_remind_message"
      )
      .eq("id", storeId)
      .single();

    if (storeErr || !store) {
      return NextResponse.json(
        { error: "Failed to fetch store", details: storeErr?.message },
        { status: 500 }
      );
    }

    const result = await runRemindForStore(supabase, store as StoreRow, {
      isManual: true,
      todayJst,
      hourJst,
    });

    return NextResponse.json({
      ok: true,
      manual: true,
      ...result,
    });
  }

  const { data: stores, error: storesErr } = await supabase
    .from("stores")
    .select(
      "id, name, remind_time, last_reminded_date, line_channel_access_token, regular_holidays, regular_remind_message"
    );

  if (storesErr) {
    logError("店舗一覧取得失敗", storesErr);
    return NextResponse.json(
      { error: "Failed to fetch stores", details: storesErr.message },
      { status: 500 }
    );
  }

  const results: Awaited<ReturnType<typeof runRemindForStore>>[] = [];
  for (const s of stores ?? []) {
    const r = await runRemindForStore(supabase, s as StoreRow, {
      isManual: false,
      todayJst,
      hourJst,
    });
    results.push(r);
  }

  const totalSuccess = results.reduce((a, b) => a + b.successCount, 0);
  const totalFailure = results.reduce((a, b) => a + b.failureCount, 0);

  return NextResponse.json({
    ok: true,
    manual: false,
    todayJst,
    hourJst,
    totalSuccess,
    totalFailure,
    stores: results,
  });
}
