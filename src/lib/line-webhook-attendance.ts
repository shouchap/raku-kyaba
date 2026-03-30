/**
 * LINE Webhook の出勤回答・来客予定フロー・理由入力（遅刻/欠勤/半休/公休）
 */
import { sendMulticastMessage, sendReply, type LineReplyMessage } from "@/lib/line-reply";
import { createSupabaseClient } from "@/lib/supabase";
import { getTodayJst } from "@/lib/date-utils";
import { getDefaultStoreIdOrNull } from "@/lib/current-store";
import { fetchAttendanceFlexHolidayOptions } from "@/lib/reminder-config";
import { isUndefinedColumnError } from "@/lib/postgrest-error";
import type { AttendancePostbackData, ReservationPostbackData } from "@/types/line-webhook";

const ERROR_REPLY = "申し訳ございません。エラーが発生しました。しばらく経ってから再度お試しください。";
const CAST_NOT_FOUND_REPLY = "キャストが登録されていません。管理者にご連絡ください。";
const NO_SCHEDULE_FOR_TODAY_REPLY =
  "本日の出勤予定がシステムに登録されていません。管理者にご連絡ください。";

const LATE_POSTBACK_REPLY =
  "到着予定時間、またその理由をこのトークにそのまま返信してください";
const ABSENT_POSTBACK_REPLY =
  "欠勤の理由（体調不良など）をこのトークにそのまま返信してください";
const PUBLIC_HOLIDAY_POSTBACK_REPLY =
  "公休の理由をこのトークにそのまま返信してください";
const HALF_HOLIDAY_POSTBACK_REPLY =
  "半休の理由をこのトークにそのまま返信してください";

/** Quick Reply 付きの案内文（出勤確定直後） */
const RESERVATION_ASK_TEXT =
  "出勤ですね、承知しました！\n本日の同伴や来客（予約）予定はありますか？\n下のボタンからお選びください。";
const RESERVATION_DETAIL_PROMPT =
  "お客様のお名前と予定時間を入力してください（例：21時 田中様）";
const RESERVATION_ASK_REMIND_TEXT =
  "「はい」「いいえ」からお選びください。";
const RESERVATION_DETAIL_EMPTY_TEXT =
  "内容を入力してください。";

const ATTENDING_ALREADY_DONE_REPLY =
  "既に出勤連絡を受け付けています。本日もよろしくお願い致します。";

/** 出勤コマンド等はフォールバックで消費せず後段の Postback 相当処理へ */
function isAttendanceCommandText(text: string): boolean {
  const t = String(text ?? "").trim();
  return t === "出勤" || t === "欠勤" || t === "遅刻" || t === "半休" || t === "公休";
}

export const PENDING_RESERVATION_ASK = "reservation_ask";
export const PENDING_RESERVATION_DETAIL = "reservation_detail";

const DEFAULT_REPLY_MESSAGES: Record<AttendancePostbackData, string> = {
  attending: "出勤を記録しました。本日もよろしくお願い致します。",
  late: "遅刻の連絡を受け付けました。差し支えなければ、このチャットで『理由』と『到着予定時刻』を教えていただけますか？",
  absent: "欠勤の連絡を受け付けました。この後、管理者から直接ご連絡させていただきます。",
  public_holiday: "公休の連絡を受け付けました。理由を入力してください。",
  half_holiday: "半休の連絡を受け付けました。理由を入力してください。",
};

const DEFAULT_ADMIN_NOTIFY_LATE =
  "【遅刻連絡】\n{name} さんから遅刻の連絡がありました。理由と到着予定時刻を確認してください。";
const DEFAULT_ADMIN_NOTIFY_ABSENT =
  "【欠勤連絡】\n{name} さんから欠勤の連絡がありました。至急、連絡・シフト調整をお願いします。";
const DEFAULT_ADMIN_NOTIFY_PRESENT =
  "【出勤連絡】{name}さんから本日の出勤（予定通り）の連絡がありました。";
const DEFAULT_ADMIN_NOTIFY_PUBLIC_HOLIDAY =
  "【公休連絡】\n{name} さんから公休の連絡がありました。理由を確認してください。";
const DEFAULT_ADMIN_NOTIFY_HALF_HOLIDAY =
  "【半休連絡】\n{name} さんから半休の連絡がありました。理由を確認してください。";

type ReminderConfigValue = {
  reply_present?: string;
  reply_late?: string;
  reply_absent?: string;
  reply_public_holiday?: string;
  reply_half_holiday?: string;
  admin_notify_late?: string;
  admin_notify_absent?: string;
  admin_notify_present?: string;
  admin_notify_public_holiday?: string;
  admin_notify_half_holiday?: string;
};

async function getReminderReplyConfig(
  supabase: ReturnType<typeof createSupabaseClient>,
  storeId: string
): Promise<{
  replyMessages: Record<AttendancePostbackData, string>;
  adminNotifyTemplates: Record<AttendancePostbackData, string>;
}> {
  const { data } = await supabase
    .from("system_settings")
    .select("value")
    .eq("store_id", storeId)
    .eq("key", "reminder_config")
    .maybeSingle();

  const config = (data?.value ?? {}) as ReminderConfigValue;

  return {
    replyMessages: {
      attending: config.reply_present?.trim() || DEFAULT_REPLY_MESSAGES.attending,
      late: config.reply_late?.trim() || DEFAULT_REPLY_MESSAGES.late,
      absent: config.reply_absent?.trim() || DEFAULT_REPLY_MESSAGES.absent,
      public_holiday:
        config.reply_public_holiday?.trim() || DEFAULT_REPLY_MESSAGES.public_holiday,
      half_holiday:
        config.reply_half_holiday?.trim() || DEFAULT_REPLY_MESSAGES.half_holiday,
    },
    adminNotifyTemplates: {
      attending: config.admin_notify_present?.trim() || DEFAULT_ADMIN_NOTIFY_PRESENT,
      late: config.admin_notify_late?.trim() || DEFAULT_ADMIN_NOTIFY_LATE,
      absent: config.admin_notify_absent?.trim() || DEFAULT_ADMIN_NOTIFY_ABSENT,
      public_holiday:
        config.admin_notify_public_holiday?.trim() || DEFAULT_ADMIN_NOTIFY_PUBLIC_HOLIDAY,
      half_holiday:
        config.admin_notify_half_holiday?.trim() || DEFAULT_ADMIN_NOTIFY_HALF_HOLIDAY,
    },
  };
}

async function getAdminLineUserIds(
  supabase: ReturnType<typeof createSupabaseClient>,
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

export function buildReservationAskMessage(): LineReplyMessage {
  return {
    type: "text",
    text: RESERVATION_ASK_TEXT,
    quickReply: {
      items: [
        {
          type: "action",
          action: {
            type: "postback",
            label: "はい",
            data: "reservation_yes",
            displayText: "はい",
          },
        },
        {
          type: "action",
          action: {
            type: "postback",
            label: "いいえ",
            data: "reservation_no",
            displayText: "いいえ",
          },
        },
      ],
    },
  };
}

type ScheduleReasonRow = {
  id: string;
  is_absent: boolean | null;
  is_late: boolean | null;
  response_status: AttendancePostbackData | null;
  late_reason: string | null;
  absent_reason: string | null;
  public_holiday_reason: string | null;
  half_holiday_reason: string | null;
  pending_line_flow?: string | null;
  is_action_completed?: boolean | null;
  updated_at: string | null;
  created_at: string | null;
};

function rowNeedsReasonInput(row: ScheduleReasonRow): boolean {
  const rs = row.response_status;
  if (rs === "late" || row.is_late === true) {
    return !String(row.late_reason ?? "").trim();
  }
  if (rs === "absent" || (row.is_absent === true && rs !== "public_holiday" && rs !== "half_holiday")) {
    return !String(row.absent_reason ?? "").trim();
  }
  if (rs === "public_holiday") return !String(row.public_holiday_reason ?? "").trim();
  if (rs === "half_holiday") return !String(row.half_holiday_reason ?? "").trim();
  return false;
}

function pickReasonKind(
  row: ScheduleReasonRow
): "absent" | "late" | "public_holiday" | "half_holiday" {
  const rs = row.response_status;
  if (rs === "absent" || (row.is_absent === true && rs !== "public_holiday" && rs !== "half_holiday")) {
    return "absent";
  }
  if (rs === "late" || row.is_late === true) return "late";
  if (rs === "public_holiday") return "public_holiday";
  if (rs === "half_holiday") return "half_holiday";
  return "late";
}

/**
 * 来客予定の詳細入力待ち状態で送られたテキストを処理し、出勤を確定する。
 */
export async function tryHandleReservationDetailText(
  lineUserId: string,
  rawText: string,
  supabase: ReturnType<typeof createSupabaseClient>,
  replyToken: string | undefined,
  channelAccessToken: string | undefined
): Promise<boolean> {
  const tenantStoreId = getDefaultStoreIdOrNull();
  if (!tenantStoreId || !replyToken || !channelAccessToken) return false;

  const { data: cast } = await supabase
    .from("casts")
    .select("id, store_id, name")
    .eq("line_user_id", lineUserId)
    .eq("store_id", tenantStoreId)
    .eq("is_active", true)
    .maybeSingle();

  if (!cast) return false;

  const todayJst = getTodayJst();
  const { data: schedule } = await supabase
    .from("attendance_schedules")
    .select("id, pending_line_flow")
    .eq("store_id", cast.store_id)
    .eq("cast_id", cast.id)
    .eq("scheduled_date", todayJst)
    .maybeSingle();

  if (!schedule?.id || schedule.pending_line_flow !== PENDING_RESERVATION_DETAIL) {
    return false;
  }

  const text = String(rawText ?? "").trim();
  if (!text) {
    await sendReply(replyToken, channelAccessToken, [
      { type: "text", text: RESERVATION_DETAIL_EMPTY_TEXT },
      { type: "text", text: RESERVATION_DETAIL_PROMPT },
    ]);
    return true;
  }

  if (text.length > 5000) {
    await sendReply(replyToken, channelAccessToken, [
      { type: "text", text: "文字数が長すぎます。短く入力してください。" },
    ]);
    return true;
  }

  const { replyMessages } = await getReminderReplyConfig(supabase, cast.store_id);
  await finalizeAttendingAttendance({
    supabase,
    cast,
    scheduleId: schedule.id,
    today: todayJst,
    hasReservation: true,
    reservationDetails: text,
    replyToken,
    channelAccessToken,
    replyMessageText: replyMessages.attending,
  });

  return true;
}

/**
 * 来客の有無を聞く段階で自由テキストが来た場合、クイックリプライを再提示する。
 */
/**
 * 本日分の受付が完了済み（理由・予約ヒアリングも終了）のあと送られた追記テキスト。
 * キャストへは返信しない（無言）。DB の理由カラムは更新しない。管理者へ Push で受信を通知する。
 */
export async function tryHandleCompletedFollowupText(
  lineUserId: string,
  rawText: string,
  supabase: ReturnType<typeof createSupabaseClient>,
  _replyToken: string | undefined,
  channelAccessToken: string | undefined
): Promise<boolean> {
  const t = String(rawText ?? "").trim();
  if (!t) return false;
  if (isAttendanceCommandText(t)) return false;

  const tenantStoreId = getDefaultStoreIdOrNull();
  if (!tenantStoreId || !channelAccessToken?.trim()) return false;

  const { data: cast } = await supabase
    .from("casts")
    .select("id, store_id, name")
    .eq("line_user_id", lineUserId)
    .eq("store_id", tenantStoreId)
    .eq("is_active", true)
    .maybeSingle();

  if (!cast) return false;

  const todayJst = getTodayJst();
  const { data: row } = await supabase
    .from("attendance_schedules")
    .select(
      "id, is_absent, is_late, response_status, late_reason, absent_reason, public_holiday_reason, half_holiday_reason, pending_line_flow, is_action_completed"
    )
    .eq("store_id", cast.store_id)
    .eq("cast_id", cast.id)
    .eq("scheduled_date", todayJst)
    .maybeSingle();

  if (!row?.id) return false;

  const sched = row as ScheduleReasonRow;

  if (sched.pending_line_flow) return false;
  if (!sched.response_status) return false;
  if (rowNeedsReasonInput(sched)) return false;
  if (sched.is_action_completed !== true) return false;

  const displayName = (cast.name ?? "キャスト").trim() || "キャスト";
  const excerpt = t.length > 3000 ? `${t.slice(0, 3000)}…` : t;
  const adminMessage =
    `📩 【公式LINE受信】\n` +
    `${displayName}さんから追加のメッセージが届きました。\n` +
    `LINE公式アカウントのチャット画面から確認・手動返信をお願いします。\n\n` +
    `内容：『${excerpt}』`;

  const adminIds = await getAdminLineUserIds(supabase, cast.store_id);
  if (adminIds.length > 0) {
    try {
      await sendMulticastMessage(adminIds, channelAccessToken, [{ type: "text", text: adminMessage }]);
    } catch (e) {
      console.error("[CompletedFollowup] 管理者 Push 失敗:", e);
    }
  } else {
    console.warn("[CompletedFollowup] 管理者宛 line_user_id なし store_id=", cast.store_id);
  }

  return true;
}

export async function tryHandleReservationAskInvalidText(
  lineUserId: string,
  rawText: string,
  supabase: ReturnType<typeof createSupabaseClient>,
  replyToken: string | undefined,
  channelAccessToken: string | undefined
): Promise<boolean> {
  const tenantStoreId = getDefaultStoreIdOrNull();
  if (!tenantStoreId || !replyToken || !channelAccessToken) return false;

  const { data: cast } = await supabase
    .from("casts")
    .select("id, store_id")
    .eq("line_user_id", lineUserId)
    .eq("store_id", tenantStoreId)
    .eq("is_active", true)
    .maybeSingle();

  if (!cast) return false;

  const todayJst = getTodayJst();
  const { data: schedule } = await supabase
    .from("attendance_schedules")
    .select("id, pending_line_flow")
    .eq("store_id", cast.store_id)
    .eq("cast_id", cast.id)
    .eq("scheduled_date", todayJst)
    .maybeSingle();

  if (!schedule?.id || schedule.pending_line_flow !== PENDING_RESERVATION_ASK) {
    return false;
  }

  const t = String(rawText ?? "").trim();
  if (!t) return true;

  await sendReply(replyToken, channelAccessToken, [
    { type: "text", text: RESERVATION_ASK_REMIND_TEXT },
    buildReservationAskMessage(),
  ]);
  return true;
}

export async function tryHandleLateAbsentReasonText(
  lineUserId: string,
  rawText: string,
  supabase: ReturnType<typeof createSupabaseClient>,
  channelAccessToken?: string
): Promise<boolean> {
  const todayJst = getTodayJst();

  try {
    const tenantStoreId = getDefaultStoreIdOrNull();
    if (!tenantStoreId) return false;

    const { data: cast, error: castError } = await supabase
      .from("casts")
      .select("id, store_id, name")
      .eq("line_user_id", lineUserId)
      .eq("store_id", tenantStoreId)
      .eq("is_active", true)
      .maybeSingle();

    if (castError || !cast) return false;

    const { data: scheduleRows, error: schedErr } = await supabase
      .from("attendance_schedules")
      .select(
        "id, is_absent, is_late, response_status, late_reason, absent_reason, public_holiday_reason, half_holiday_reason, pending_line_flow, is_action_completed, updated_at, created_at"
      )
      .eq("store_id", cast.store_id)
      .eq("cast_id", cast.id)
      .eq("scheduled_date", todayJst);

    if (schedErr) {
      console.error("[Reason] スケジュール取得エラー:", schedErr);
      return false;
    }

    const rows = (scheduleRows ?? []) as ScheduleReasonRow[];
    const candidates = rows.filter(rowNeedsReasonInput);
    if (candidates.length === 0) return false;

    candidates.sort((a, b) => {
      const ta = new Date(a.updated_at ?? a.created_at ?? 0).getTime();
      const tb = new Date(b.updated_at ?? b.created_at ?? 0).getTime();
      if (tb !== ta) return tb - ta;
      const ca = new Date(a.created_at ?? 0).getTime();
      const cb = new Date(b.created_at ?? 0).getTime();
      if (cb !== ca) return cb - ca;
      return String(b.id).localeCompare(String(a.id));
    });

    const schedule = candidates[0];
    if (!rowNeedsReasonInput(schedule)) {
      return false;
    }

    const reasonKind = pickReasonKind(schedule);
    const text = String(rawText ?? "").trim();
    if (!text) return true;

    if (text.length > 5000) {
      console.warn("[Reason] 長すぎるため保存スキップ length=", text.length);
      return true;
    }

    const updates: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
      pending_line_flow: null,
      pending_line_updated_at: null,
      is_action_completed: true,
    };

    if (reasonKind === "absent") updates.absent_reason = text;
    else if (reasonKind === "late") updates.late_reason = text;
    else if (reasonKind === "public_holiday") updates.public_holiday_reason = text;
    else updates.half_holiday_reason = text;

    const { data: updatedRows, error: updateErr } = await supabase
      .from("attendance_schedules")
      .update(updates)
      .eq("id", schedule.id)
      .select("id");

    if (updateErr || !updatedRows?.length) {
      console.error("[Reason] DB UPDATE 失敗:", updateErr);
      return true;
    }

    if (!channelAccessToken) return true;

    const adminIds = await getAdminLineUserIds(supabase, cast.store_id);
    if (adminIds.length === 0) return true;

    const kindLabel =
      reasonKind === "absent"
        ? "欠勤"
        : reasonKind === "late"
          ? "遅刻"
          : reasonKind === "public_holiday"
            ? "公休"
            : "半休";
    const displayName = cast.name ?? "キャスト";
    const adminMessage = `${displayName}さんの${kindLabel}理由：『${text}』`;

    try {
      await sendMulticastMessage(adminIds, channelAccessToken, [
        { type: "text", text: adminMessage },
      ]);
    } catch (adminErr) {
      console.error("[Reason] 管理者通知失敗:", adminErr);
    }

    return true;
  } catch (err) {
    console.error("[Reason] 未捕捉エラー:", err);
    return true;
  }
}

type FinalizeParams = {
  supabase: ReturnType<typeof createSupabaseClient>;
  cast: { id: string; store_id: string; name: string | null };
  scheduleId: string;
  today: string;
  hasReservation: boolean;
  reservationDetails: string | null;
  replyToken: string;
  channelAccessToken: string;
  replyMessageText: string;
};

async function finalizeAttendingAttendance(p: FinalizeParams): Promise<void> {
  const {
    supabase,
    cast,
    scheduleId,
    today,
    hasReservation,
    reservationDetails,
    replyToken,
    channelAccessToken,
    replyMessageText,
  } = p;

  const upsertResult = await supabase.from("attendance_logs").upsert(
    {
      store_id: cast.store_id,
      cast_id: cast.id,
      attendance_schedule_id: scheduleId,
      attended_date: today,
      status: "attending",
      has_reservation: hasReservation,
      reservation_details: reservationDetails,
      responded_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    } as Record<string, unknown>,
    {
      onConflict: "store_id,cast_id,attended_date",
      ignoreDuplicates: false,
    }
  );

  if (upsertResult.error) {
    console.error("[Attendance] finalize attendance_logs upsert エラー:", upsertResult.error);
    await sendReply(replyToken, channelAccessToken, [{ type: "text", text: ERROR_REPLY }]);
    return;
  }

  const { data: updatedRows, error: scheduleUpdateError } = await supabase
    .from("attendance_schedules")
    .update({
      is_action_completed: true,
      response_status: "attending",
      is_absent: false,
      is_late: false,
      has_reservation: hasReservation,
      reservation_details: reservationDetails,
      pending_line_flow: null,
      pending_line_updated_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", scheduleId)
    .select("id");

  if (scheduleUpdateError || !updatedRows?.length) {
    console.error("[Attendance] finalize schedule 更新エラー:", scheduleUpdateError);
    await sendReply(replyToken, channelAccessToken, [{ type: "text", text: ERROR_REPLY }]);
    return;
  }

  await sendReply(replyToken, channelAccessToken, [{ type: "text", text: replyMessageText }]);
}

/**
 * 出勤 Postback 初回（または他ステータスから変更）:
 * attendance_logs / response_status を即時 attending で確定し、予約ヒアリングは pending_line_flow で継続する。
 */
async function handleAttendingReservationFlowStart(
  cast: { id: string; store_id: string; name: string | null },
  scheduleId: string,
  supabase: ReturnType<typeof createSupabaseClient>,
  replyToken: string | undefined,
  channelAccessToken: string | undefined
): Promise<void> {
  const safeReply = async (messages: LineReplyMessage[]) => {
    if (replyToken && channelAccessToken) {
      await sendReply(replyToken, channelAccessToken, messages);
    }
  };

  const today = getTodayJst();
  const nowIso = new Date().toISOString();

  const upsertLog = await supabase.from("attendance_logs").upsert(
    {
      store_id: cast.store_id,
      cast_id: cast.id,
      attendance_schedule_id: scheduleId,
      attended_date: today,
      status: "attending",
      responded_at: nowIso,
      updated_at: nowIso,
    } as Record<string, unknown>,
    {
      onConflict: "store_id,cast_id,attended_date",
      ignoreDuplicates: false,
    }
  );

  if (upsertLog.error) {
    console.error("[Attendance] attending 初回 attendance_logs upsert エラー:", upsertLog.error);
    await safeReply([{ type: "text", text: ERROR_REPLY }]);
    return;
  }

  const { data: updatedRows, error } = await supabase
    .from("attendance_schedules")
    .update({
      response_status: "attending",
      is_absent: false,
      is_late: false,
      is_action_completed: false,
      pending_line_flow: PENDING_RESERVATION_ASK,
      pending_line_updated_at: nowIso,
      updated_at: nowIso,
    })
    .eq("id", scheduleId)
    .select("id");

  if (error || !updatedRows?.length) {
    console.error("[Attendance] attending 初回 schedule 更新エラー:", error);
    await safeReply([{ type: "text", text: ERROR_REPLY }]);
    return;
  }

  await safeReply([buildReservationAskMessage()]);
}

export async function handleReservationPostback(
  lineUserId: string,
  choice: ReservationPostbackData,
  supabase: ReturnType<typeof createSupabaseClient>,
  replyToken: string | undefined,
  channelAccessToken: string | undefined
): Promise<void> {
  const safeReply = async (messages: LineReplyMessage[]) => {
    if (replyToken && channelAccessToken) {
      await sendReply(replyToken, channelAccessToken, messages);
    }
  };

  const tenantStoreId = getDefaultStoreIdOrNull();
  if (!tenantStoreId) {
    await safeReply([{ type: "text", text: ERROR_REPLY }]);
    return;
  }

  const { data: cast } = await supabase
    .from("casts")
    .select("id, store_id, name")
    .eq("line_user_id", lineUserId)
    .eq("store_id", tenantStoreId)
    .eq("is_active", true)
    .maybeSingle();

  if (!cast) {
    await safeReply([{ type: "text", text: CAST_NOT_FOUND_REPLY }]);
    return;
  }

  const today = getTodayJst();
  const { data: schedule } = await supabase
    .from("attendance_schedules")
    .select("id, pending_line_flow")
    .eq("store_id", cast.store_id)
    .eq("cast_id", cast.id)
    .eq("scheduled_date", today)
    .maybeSingle();

  if (!schedule?.id) {
    await safeReply([{ type: "text", text: NO_SCHEDULE_FOR_TODAY_REPLY }]);
    return;
  }

  if (schedule.pending_line_flow !== PENDING_RESERVATION_ASK) {
    await safeReply([
      {
        type: "text",
        text: "先に出勤確認のボタンから「出勤」を選んでください。",
      },
    ]);
    return;
  }

  const { replyMessages } = await getReminderReplyConfig(supabase, cast.store_id);

  if (choice === "reservation_no") {
    if (!replyToken || !channelAccessToken) return;
    await finalizeAttendingAttendance({
      supabase,
      cast,
      scheduleId: schedule.id,
      today,
      hasReservation: false,
      reservationDetails: null,
      replyToken,
      channelAccessToken,
      replyMessageText: replyMessages.attending,
    });
    return;
  }

  const { error: updErr } = await supabase
    .from("attendance_schedules")
    .update({
      pending_line_flow: PENDING_RESERVATION_DETAIL,
      pending_line_updated_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", schedule.id);

  if (updErr) {
    console.error("[Attendance] reservation_yes 更新エラー:", updErr);
    await safeReply([{ type: "text", text: ERROR_REPLY }]);
    return;
  }

  await safeReply([{ type: "text", text: RESERVATION_DETAIL_PROMPT }]);
}

export async function handleAttendanceResponse(
  lineUserId: string,
  statusData: AttendancePostbackData,
  supabase: ReturnType<typeof createSupabaseClient>,
  replyToken?: string,
  channelAccessToken?: string
): Promise<void> {
  const safeReply = async (text: string) => {
    if (replyToken && channelAccessToken) {
      await sendReply(replyToken, channelAccessToken, [{ type: "text", text }]);
    }
  };

  try {
    const tenantStoreId = getDefaultStoreIdOrNull();
    if (!tenantStoreId) {
      await safeReply(ERROR_REPLY);
      return;
    }

    const { data: cast, error: castError } = await supabase
      .from("casts")
      .select("id, store_id, name")
      .eq("line_user_id", lineUserId)
      .eq("store_id", tenantStoreId)
      .eq("is_active", true)
      .maybeSingle();

    if (castError || !cast) {
      await safeReply(castError ? ERROR_REPLY : CAST_NOT_FOUND_REPLY);
      return;
    }

    const today = getTodayJst();

    const { data: schedule, error: scheduleFetchError } = await supabase
      .from("attendance_schedules")
      .select("id, pending_line_flow, response_status, is_action_completed")
      .eq("store_id", cast.store_id)
      .eq("cast_id", cast.id)
      .eq("scheduled_date", today)
      .maybeSingle();

    if (scheduleFetchError) {
      await safeReply(ERROR_REPLY);
      return;
    }

    if (!schedule?.id) {
      await safeReply(NO_SCHEDULE_FOR_TODAY_REPLY);
      return;
    }

    const scheduleId = schedule.id;

    if (statusData === "attending") {
      const pending = schedule.pending_line_flow ?? null;
      const rs = schedule.response_status ?? null;
      const done = schedule.is_action_completed === true;

      if (pending === PENDING_RESERVATION_DETAIL) {
        await safeReply(RESERVATION_DETAIL_PROMPT);
        return;
      }
      if (pending === PENDING_RESERVATION_ASK) {
        if (replyToken && channelAccessToken) {
          await sendReply(replyToken, channelAccessToken, [buildReservationAskMessage()]);
        }
        return;
      }
      if (rs === "attending" && !pending && done) {
        await safeReply(ATTENDING_ALREADY_DONE_REPLY);
        return;
      }

      const storeFlags = await supabase
        .from("stores")
        .select("enable_reservation_check")
        .eq("id", cast.store_id)
        .maybeSingle();

      let reservationAskEnabled = false;
      if (!storeFlags.error && storeFlags.data) {
        reservationAskEnabled =
          (storeFlags.data as { enable_reservation_check?: boolean | null }).enable_reservation_check ===
          true;
      } else if (
        storeFlags.error &&
        isUndefinedColumnError(storeFlags.error, "enable_reservation_check")
      ) {
        const cfg = await supabase
          .from("system_settings")
          .select("value")
          .eq("store_id", cast.store_id)
          .eq("key", "reminder_config")
          .maybeSingle();
        const row = cfg.data?.value as Record<string, unknown> | null;
        if (row && typeof row === "object") {
          reservationAskEnabled = row.enable_reservation_check === true;
        }
      } else if (storeFlags.error) {
        console.warn(
          "[Attendance] stores.enable_reservation_check 取得失敗（予約ヒアリングはスキップ）:",
          storeFlags.error.message
        );
      }

      if (!reservationAskEnabled) {
        if (!replyToken || !channelAccessToken) return;
        const { replyMessages } = await getReminderReplyConfig(supabase, cast.store_id);
        await finalizeAttendingAttendance({
          supabase,
          cast,
          scheduleId,
          today,
          hasReservation: false,
          reservationDetails: null,
          replyToken,
          channelAccessToken,
          replyMessageText: replyMessages.attending,
        });
        return;
      }

      await handleAttendingReservationFlowStart(
        cast,
        scheduleId,
        supabase,
        replyToken,
        channelAccessToken
      );
      return;
    }

    if (statusData === "half_holiday" || statusData === "public_holiday") {
      const flags = await fetchAttendanceFlexHolidayOptions(supabase, cast.store_id);
      if (statusData === "half_holiday" && !flags.enableHalfHoliday) {
        await safeReply(
          "この店舗では半休の連絡は受け付けていません。出勤・遅刻・欠勤から選ぶか、管理者にご連絡ください。"
        );
        return;
      }
      if (statusData === "public_holiday" && !flags.enablePublicHoliday) {
        await safeReply(
          "この店舗では公休の連絡は受け付けていません。出勤・遅刻・欠勤から選ぶか、管理者にご連絡ください。"
        );
        return;
      }
    }

    const status = statusData;

    const upsertResult = await supabase.from("attendance_logs").upsert(
      {
        store_id: cast.store_id,
        cast_id: cast.id,
        attendance_schedule_id: scheduleId,
        attended_date: today,
        status,
        responded_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      } as Record<string, unknown>,
      {
        onConflict: "store_id,cast_id,attended_date",
        ignoreDuplicates: false,
      }
    );

    if (upsertResult.error) {
      console.error("[Attendance] attendance_logs upsert エラー:", upsertResult.error);
      await safeReply(ERROR_REPLY);
      return;
    }

    const { data: updatedRows, error: scheduleUpdateError } = await supabase
      .from("attendance_schedules")
      .update({
        is_action_completed: true,
        response_status: status,
        is_absent: status === "absent",
        is_late: status === "late",
        pending_line_flow: null,
        pending_line_updated_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", scheduleId)
      .select("id");

    if (scheduleUpdateError || !updatedRows?.length) {
      await safeReply(ERROR_REPLY);
      return;
    }

    const replyAfterSave =
      statusData === "late"
        ? LATE_POSTBACK_REPLY
        : statusData === "absent"
          ? ABSENT_POSTBACK_REPLY
          : statusData === "half_holiday"
            ? HALF_HOLIDAY_POSTBACK_REPLY
            : PUBLIC_HOLIDAY_POSTBACK_REPLY;

    const needsReasonPing =
      statusData === "late" ||
      statusData === "absent" ||
      statusData === "half_holiday" ||
      statusData === "public_holiday";

    if (channelAccessToken && needsReasonPing) {
      const adminIds = await getAdminLineUserIds(supabase, cast.store_id);
      if (adminIds.length > 0) {
        const kind =
          statusData === "late"
            ? "遅刻"
            : statusData === "absent"
              ? "欠勤"
              : statusData === "half_holiday"
                ? "半休"
                : "公休";
        const adminMessage = `${cast.name ?? "キャスト"}さんが${kind}の連絡をしました。理由確認中です。`;
        try {
          await sendMulticastMessage(adminIds, channelAccessToken, [
            { type: "text", text: adminMessage },
          ]);
        } catch (adminErr) {
          console.error("[Attendance] 管理者初回通知失敗:", adminErr);
        }
      }
    }

    await safeReply(replyAfterSave);
  } catch (err) {
    console.error("[Attendance] 処理エラー:", err);
    await safeReply(ERROR_REPLY);
  }
}
