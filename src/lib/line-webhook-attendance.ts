/**
 * LINE Webhook の出勤回答・来客予定フロー・理由入力（遅刻/欠勤/半休/公休）
 */
import {
  sendMulticastMessage,
  sendReply,
  type LineReplyMessage,
  type LineTextQuickReplyItem,
} from "@/lib/line-reply";
import { createSupabaseClient } from "@/lib/supabase";
import { getTodayJst } from "@/lib/date-utils";
import { getDefaultStoreIdOrNull } from "@/lib/current-store";
import { fetchAttendanceFlexHolidayOptions } from "@/lib/reminder-config";
import { isUndefinedColumnError } from "@/lib/postgrest-error";
import type { AttendancePostbackData, ReservationPostbackData } from "@/types/line-webhook";
import {
  formatBarGroupsOnlyMessage,
  formatBarGroupsOnlyStoredPlainText,
  formatReservationCompletionMessage,
  formatReservationStoredPlainText,
  getReservationPromptTargets,
  nextGroupIndexToFill,
  parseReservationGroupCountFromPostback,
  parseReservationProgress,
  RESERVATION_JSON_VERSION,
  serializeReservationProgress,
  type ReservationGuestButton,
  type ReservationProgressV2,
  type ReservationRecordEntry,
} from "@/lib/reservation-progress";

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
const RESERVATION_ASK_REMIND_TEXT =
  "「はい」「いいえ」からお選びください。";
const RESERVATION_TIME_PROMPT_TEXT = "お客様の来店予定時間を教えてください。";
const RESERVATION_GUESTS_PROMPT_TEXT = "何名様でのご来店ですか？";
const RESERVATION_GROUP_COUNT_PROMPT_TEXT = "何組のお客様の予定がありますか？";
const RESERVATION_TEXT_ONLY_REMIND =
  "文字入力は不要です。画面のボタンからお選びください。";

const ATTENDING_ALREADY_DONE_REPLY =
  "既に出勤連絡を受け付けています。本日もよろしくお願い致します。";

/**
 * 当日の attendance_schedules が無い場合に作成（レギュラー等・シフト未登録でもボタン回答可能にする）
 */
async function ensureTodayAttendanceSchedule(
  supabase: ReturnType<typeof createSupabaseClient>,
  cast: { id: string; store_id: string },
  todayJst: string
): Promise<{ id: string } | null> {
  const { data: existing } = await supabase
    .from("attendance_schedules")
    .select("id")
    .eq("store_id", cast.store_id)
    .eq("cast_id", cast.id)
    .eq("scheduled_date", todayJst)
    .maybeSingle();

  if (existing?.id) return { id: existing.id };

  const { data: inserted, error } = await supabase
    .from("attendance_schedules")
    .insert({
      store_id: cast.store_id,
      cast_id: cast.id,
      scheduled_date: todayJst,
    })
    .select("id")
    .maybeSingle();

  if (inserted?.id) return { id: inserted.id };

  if (error) {
    const { data: again } = await supabase
      .from("attendance_schedules")
      .select("id")
      .eq("store_id", cast.store_id)
      .eq("cast_id", cast.id)
      .eq("scheduled_date", todayJst)
      .maybeSingle();
    if (again?.id) return { id: again.id };
    console.error("[Attendance] ensureTodayAttendanceSchedule insert failed:", error);
  }
  return null;
}

/** 出勤コマンド等はフォールバックで消費せず後段の Postback 相当処理へ */
function isAttendanceCommandText(text: string): boolean {
  const t = String(text ?? "").trim();
  return t === "出勤" || t === "同伴" || t === "欠勤" || t === "遅刻" || t === "半休" || t === "公休";
}

export const PENDING_RESERVATION_ASK = "reservation_ask";
/** @deprecated 旧テキスト入力。互換のため残す */
export const PENDING_RESERVATION_DETAIL = "reservation_detail";
/** Datetimepicker で来店時間を選ぶ段階 */
export const PENDING_RESERVATION_TIME = "reservation_time";
/** Postback で人数を選ぶ段階 */
export const PENDING_RESERVATION_GUESTS = "reservation_guests";
/** 来客予定の組数を選ぶ段階 */
export const PENDING_RESERVATION_GROUP_COUNT = "reservation_group_count";
/** BAR: 組ごとのお客様名をテキストで聞く段階 */
export const PENDING_RESERVATION_GUEST_NAMES = "reservation_guest_names";
export const PENDING_BAR_PLANNED_GROUPS = "bar_planned_groups";
export const PENDING_BAR_TENTATIVE_GROUPS = "bar_tentative_groups";
export const PENDING_BAR_REASON = "bar_reason";
export const PENDING_BAR_ACTION = "bar_action";
export const PENDING_BAR_ACTION_DETAIL = "bar_action_detail";

/** reservation_details 内の BAR 行動ドラフト（来客予約の v2 JSON と独立） */
const BAR_EXT_JSON_KEY = "_bar_ext";

type BarExtDraftState = {
  v: 1;
  entries: { kind: string; detail: string }[];
  confirmed_groups?: number;
  tentative_groups?: number;
  /** 配信: 開始時刻ヒアリングで選ばれた値（終了ヒアリング待ちで保持） */
  distribution_pick_start?: string;
  pending_detail_kind?: string;
};

/** pending_detail_kind: 声かけ / SNS / 配信開始・終了 */
const BAR_DETAIL_KIND_VOICE = "声かけ" as const;
const BAR_DETAIL_KIND_SNS = "SNS" as const;
const BAR_DETAIL_KIND_DIST_START = "配信_start" as const;
const BAR_DETAIL_KIND_DIST_END = "配信_end" as const;

const BAR_REPORT_DONE_POSTBACK = "__report_done__";

/** Quick Reply は最大 13 項目 */
const BAR_PLANNED_GROUP_LABELS = [
  "0組",
  "1組",
  "2組",
  "3組",
  "4組",
  "5組",
  "6組",
  "7組",
  "8組",
  "9組",
  "10組",
] as const;

/** Quick Reply は最大13項目（配信の開始・終了で共通利用） */
const BAR_DISTRIBUTION_HOUR_LABELS = [
  "18:00",
  "19:00",
  "20:00",
  "21:00",
  "22:00",
  "23:00",
  "0:00",
  "1:00",
  "2:00",
  "3:00",
  "4:00",
  "5:00",
] as const;

const BAR_CONTACT_EXCHANGE_LABELS = [
  "0人",
  "1人",
  "2人",
  "3人",
  "4人",
  "5人",
  "6人",
  "7人",
  "8人",
  "9人",
  "10人以上",
] as const;

function emptyBarExtDraft(): BarExtDraftState {
  return { v: 1, entries: [] };
}

function parseBarExtDraft(raw: string | null | undefined): BarExtDraftState | null {
  const s = String(raw ?? "").trim();
  if (!s.startsWith("{")) return null;
  try {
    const o = JSON.parse(s) as Record<string, unknown>;
    const bx = o[BAR_EXT_JSON_KEY];
    if (!bx || typeof bx !== "object") return null;
    const box = bx as Record<string, unknown>;
    const entriesRaw = box.entries;
    const entries: { kind: string; detail: string }[] = [];
    if (Array.isArray(entriesRaw)) {
      for (const item of entriesRaw) {
        if (!item || typeof item !== "object") continue;
        const row = item as Record<string, unknown>;
        const kind = String(row.kind ?? "").trim();
        const detail = String(row.detail ?? "").trim();
        if (kind && detail) entries.push({ kind, detail });
      }
    }
    const pk = box.pending_detail_kind;
    const pending_detail_kind =
      typeof pk === "string" && pk.trim() ? pk.trim() : undefined;
    const cgRaw = box.confirmed_groups;
    const tgRaw = box.tentative_groups;
    const confirmed_groups =
      typeof cgRaw === "number" && Number.isInteger(cgRaw) && cgRaw >= 0 ? cgRaw : undefined;
    const tentative_groups =
      typeof tgRaw === "number" && Number.isInteger(tgRaw) && tgRaw >= 0 ? tgRaw : undefined;
    const dpsRaw = box.distribution_pick_start;
    const distribution_pick_start =
      typeof dpsRaw === "string" && dpsRaw.trim() ? dpsRaw.trim() : undefined;
    return {
      v: 1,
      entries,
      pending_detail_kind,
      confirmed_groups,
      tentative_groups,
      distribution_pick_start,
    };
  } catch {
    return null;
  }
}

function serializeBarExtReservationDetails(draft: BarExtDraftState): string {
  const payload: Record<string, unknown> = { v: draft.v, entries: draft.entries };
  if (typeof draft.confirmed_groups === "number") {
    payload.confirmed_groups = draft.confirmed_groups;
  }
  if (typeof draft.tentative_groups === "number") {
    payload.tentative_groups = draft.tentative_groups;
  }
  if (draft.distribution_pick_start) {
    payload.distribution_pick_start = draft.distribution_pick_start;
  }
  if (draft.pending_detail_kind) {
    payload.pending_detail_kind = draft.pending_detail_kind;
  }
  return JSON.stringify({ [BAR_EXT_JSON_KEY]: payload });
}

function formatBarActionCombinedDetail(entries: { kind: string; detail: string }[]): string {
  return entries.map((e) => `${e.kind}(${e.detail})`).join(", ");
}

function parseBarPlannedGroupsInput(raw: string): number | null {
  const compact = String(raw ?? "").trim().replace(/\s+/g, "").replace(/組$/, "");
  if (!compact) return null;
  if (!/^\d+$/.test(compact)) return null;
  const n = Number.parseInt(compact, 10);
  if (!Number.isInteger(n) || n < 0) return null;
  return n;
}

function messageQuickReplyItem(label: string, text: string): LineTextQuickReplyItem {
  return {
    type: "action",
    action: { type: "message", label, text },
  };
}

function buildBarPlannedGroupsPromptMessage(): LineReplyMessage {
  const items: LineTextQuickReplyItem[] = BAR_PLANNED_GROUP_LABELS.map((label) =>
    messageQuickReplyItem(label, label)
  );
  return {
    type: "text",
    text: "本日の【確定組数】を選んでください。",
    quickReply: { items },
  };
}

function buildBarTentativeGroupsPromptMessage(): LineReplyMessage {
  const items: LineTextQuickReplyItem[] = BAR_PLANNED_GROUP_LABELS.map((label) =>
    messageQuickReplyItem(label, label)
  );
  return {
    type: "text",
    text: "【仮予定組数】を選んでください。（無い場合は0組）",
    quickReply: { items },
  };
}

function padHm(h: number, min: number): string {
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

/** 配信開始・終了の Quick Reply と同一形式（例: 18:00 / 0:00）のみ受理 */
function parseBarDistributionHourMessage(raw: string): string | null {
  const t = String(raw ?? "").trim().replace(/\s+/g, "");
  const allowed = new Set<string>(
    BAR_DISTRIBUTION_HOUR_LABELS as unknown as readonly string[]
  );
  if (!allowed.has(t)) return null;
  const m = t.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const hh = Number.parseInt(m[1], 10);
  const mm = Number.parseInt(m[2], 10);
  if (
    Number.isNaN(hh) ||
    Number.isNaN(mm) ||
    hh < 0 ||
    hh > 23 ||
    mm < 0 ||
    mm > 59
  ) {
    return null;
  }
  return padHm(hh, mm);
}

function buildBarDistributionStartPromptMessage(): LineReplyMessage {
  const items: LineTextQuickReplyItem[] = BAR_DISTRIBUTION_HOUR_LABELS.map((label) =>
    messageQuickReplyItem(label, label)
  );
  return {
    type: "text",
    text: "配信の【開始時間】を選んでください。",
    quickReply: { items },
  };
}

function buildBarDistributionEndPromptMessage(): LineReplyMessage {
  const items: LineTextQuickReplyItem[] = BAR_DISTRIBUTION_HOUR_LABELS.map((label) =>
    messageQuickReplyItem(label, label)
  );
  return {
    type: "text",
    text: "配信の【終了時間】を選んでください。",
    quickReply: { items },
  };
}

function buildBarContactExchangePromptMessage(actionKind: typeof BAR_DETAIL_KIND_VOICE | typeof BAR_DETAIL_KIND_SNS): LineReplyMessage {
  const items: LineTextQuickReplyItem[] = BAR_CONTACT_EXCHANGE_LABELS.map((label) =>
    messageQuickReplyItem(label, label)
  );
  return {
    type: "text",
    text: `${actionKind}の【連絡先交換人数】を選んでください。（例: 3人）`,
    quickReply: { items },
  };
}

function getBarActionQuickReplyItems(): LineTextQuickReplyItem[] {
  const post = (label: string, value: string): LineTextQuickReplyItem => ({
    type: "action",
    action: {
      type: "postback",
      label,
      data: `bar_action:${value}`,
      displayText: label,
    },
  });
  return [
    post("配信", "配信"),
    post("声かけ", "声かけ"),
    post("SNS", "SNS"),
    post("できていない", "できていない"),
    post("✅ 報告完了", BAR_REPORT_DONE_POSTBACK),
  ];
}

function buildBarActionPromptMessage(options?: { followUp?: boolean }): LineReplyMessage {
  const text = options?.followUp
    ? "記録しました。他にも行動があれば下から選択してください。終わる場合は「✅ 報告完了」を押してください。"
    : "行動確認を選択してください。\n複数ある場合は順に選び、終わったら「✅ 報告完了」を押してください。";
  return {
    type: "text",
    text,
    quickReply: { items: getBarActionQuickReplyItems() },
  };
}

function parseBarContactExchangeDetailFromMessage(raw: string): string | null {
  const t = String(raw ?? "").trim();
  if (!t) return null;
  if (t === "10人以上") return "10人以上";
  const m = /^(\d{1,2})人$/.exec(t.replace(/\s+/g, ""));
  if (!m) return null;
  const n = Number.parseInt(m[1], 10);
  if (!Number.isInteger(n) || n < 0 || n > 9) return null;
  return `${n}人`;
}

async function notifyAdminsBarAttendanceCompleted(params: {
  supabase: ReturnType<typeof createSupabaseClient>;
  storeId: string;
  castName: string | null;
  channelAccessToken: string;
  plannedGroups: number | null;
  tentativeGroups: number | null;
  attendanceScheduleId: string;
}): Promise<void> {
  const {
    supabase,
    storeId,
    castName,
    channelAccessToken,
    plannedGroups,
    tentativeGroups,
    attendanceScheduleId,
  } = params;
  const adminIds = await getAdminLineUserIds(supabase, storeId);
  if (adminIds.length === 0) return;
  const displayName = (castName ?? "キャスト").trim() || "キャスト";
  const fixed = typeof plannedGroups === "number" ? plannedGroups : 0;
  const tentative = typeof tentativeGroups === "number" ? tentativeGroups : 0;

  let reasonSuffix = "";
  const { data: schedRow } = await supabase
    .from("attendance_schedules")
    .select(
      "response_status, late_reason, absent_reason, public_holiday_reason, half_holiday_reason"
    )
    .eq("id", attendanceScheduleId)
    .maybeSingle();
  const s = schedRow as {
    response_status?: string | null;
    late_reason?: string | null;
    absent_reason?: string | null;
    public_holiday_reason?: string | null;
    half_holiday_reason?: string | null;
  } | null;
  if (s?.response_status) {
    const label =
      s.response_status === "late"
        ? "遅刻"
        : s.response_status === "absent"
          ? "欠勤"
          : s.response_status === "public_holiday"
            ? "公休"
            : s.response_status === "half_holiday"
              ? "半休"
              : null;
    const body =
      s.response_status === "late"
        ? s.late_reason
        : s.response_status === "absent"
          ? s.absent_reason
          : s.response_status === "public_holiday"
            ? s.public_holiday_reason
            : s.response_status === "half_holiday"
              ? s.half_holiday_reason
              : null;
    if (label && String(body ?? "").trim()) {
      reasonSuffix = `\n${label}理由: ${String(body).trim()}`;
    }
  }

  const adminMessage =
    `【出勤連絡】${displayName}さんが出勤報告を完了しました。\n` +
    `確定組数: ${fixed}組\n` +
    `仮予定組数: ${tentative}組` +
    reasonSuffix;
  try {
    await sendMulticastMessage(adminIds, channelAccessToken, [{ type: "text", text: adminMessage }]);
  } catch (e) {
    console.error("[BAR Attendance] 管理者通知失敗:", e);
  }
}

async function fetchTodayAttendanceLogBasics(
  supabase: ReturnType<typeof createSupabaseClient>,
  storeId: string,
  castId: string,
  attendedDate: string
): Promise<{ status: string; planned_groups: number | null; tentative_groups: number | null } | null> {
  const { data } = await supabase
    .from("attendance_logs")
    .select("status, planned_groups, tentative_groups")
    .eq("store_id", storeId)
    .eq("cast_id", castId)
    .eq("attended_date", attendedDate)
    .maybeSingle();
  if (!data) return null;
  const row = data as {
    status?: string | null;
    planned_groups?: number | null;
    tentative_groups?: number | null;
  };
  const status = String(row.status ?? "attending");
  const pg = row.planned_groups;
  const planned_groups =
    typeof pg === "number" && Number.isFinite(pg) ? pg : null;
  const tg = row.tentative_groups;
  const tentative_groups =
    typeof tg === "number" && Number.isFinite(tg) ? tg : null;
  return { status, planned_groups, tentative_groups };
}

async function loadStoreBarReservationFlags(
  supabase: ReturnType<typeof createSupabaseClient>,
  storeId: string
): Promise<{ business_type: string; ask_guest_name: boolean; ask_guest_time: boolean }> {
  const { data, error } = await supabase
    .from("stores")
    .select("business_type, ask_guest_name, ask_guest_time")
    .eq("id", storeId)
    .maybeSingle();

  if (error && !isUndefinedColumnError(error, "ask_guest_name")) {
    console.warn("[Reservation] stores BAR flags:", error.message);
  }

  const row = data as {
    business_type?: string | null;
    ask_guest_name?: boolean | null;
    ask_guest_time?: boolean | null;
  } | null;

  return {
    business_type: String(row?.business_type ?? "cabaret"),
    ask_guest_name: row?.ask_guest_name !== false,
    ask_guest_time: row?.ask_guest_time === true,
  };
}

async function fetchAttendanceFlowType(
  supabase: ReturnType<typeof createSupabaseClient>,
  storeId: string
): Promise<"default" | "bar_extended"> {
  const { data } = await supabase
    .from("stores")
    .select("attendance_flow_type")
    .eq("id", storeId)
    .maybeSingle();
  return data?.attendance_flow_type === "bar_extended" ? "bar_extended" : "default";
}

function buildBarGuestNamePrompt(groupIndex: number, totalGroups: number): string {
  return `${groupIndex}組目のお客様のお名前を教えてください`;
}

const DEFAULT_REPLY_MESSAGES: Record<AttendancePostbackData, string> = {
  attending: "出勤を記録しました。本日もよろしくお願い致します。",
  dohan: "同伴での出勤連絡を受け付けました。",
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
      dohan: config.reply_present?.trim() || DEFAULT_REPLY_MESSAGES.dohan,
      late: config.reply_late?.trim() || DEFAULT_REPLY_MESSAGES.late,
      absent: config.reply_absent?.trim() || DEFAULT_REPLY_MESSAGES.absent,
      public_holiday:
        config.reply_public_holiday?.trim() || DEFAULT_REPLY_MESSAGES.public_holiday,
      half_holiday:
        config.reply_half_holiday?.trim() || DEFAULT_REPLY_MESSAGES.half_holiday,
    },
    adminNotifyTemplates: {
      attending: config.admin_notify_present?.trim() || DEFAULT_ADMIN_NOTIFY_PRESENT,
      dohan: config.admin_notify_present?.trim() || DEFAULT_ADMIN_NOTIFY_PRESENT,
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

const RESERVATION_FLEX_BODY = "#263238";
const RESERVATION_FLEX_BTN_PRIMARY = "#C2185B";
const RESERVATION_FLEX_BTN_MUTED = "#90A4AE";

function reservationTimePromptBody(opts: { groupIndex: number; totalGroups: number }): string {
  if (opts.totalGroups <= 1) return RESERVATION_TIME_PROMPT_TEXT;
  return `${opts.groupIndex}組目の来店時間を教えてください。`;
}

function reservationGuestsPromptBody(opts: { groupIndex: number; totalGroups: number }): string {
  if (opts.totalGroups <= 1) return RESERVATION_GUESTS_PROMPT_TEXT;
  return `${opts.groupIndex}組目は何名様ですか？`;
}

/** 組数のみ（Postback） */
export function buildReservationGroupCountFlexMessage(): LineReplyMessage {
  const postback = (label: string, groups: number) =>
    ({
      type: "button" as const,
      style: "primary" as const,
      color: RESERVATION_FLEX_BTN_PRIMARY,
      height: "md" as const,
      action: {
        type: "postback" as const,
        label,
        data: `action=reservation_group_select&groups=${groups}`,
        displayText: label,
      },
    }) as const;

  return {
    type: "flex",
    altText: `${RESERVATION_GROUP_COUNT_PROMPT_TEXT}（ボタンから選択）`,
    contents: {
      type: "bubble",
      size: "mega" as const,
      body: {
        type: "box",
        layout: "vertical" as const,
        paddingAll: "20px",
        spacing: "md" as const,
        contents: [
          {
            type: "text",
            text: RESERVATION_GROUP_COUNT_PROMPT_TEXT,
            wrap: true,
            weight: "bold" as const,
            size: "md" as const,
            color: RESERVATION_FLEX_BODY,
          },
        ],
      },
      footer: {
        type: "box",
        layout: "vertical" as const,
        paddingAll: "20px",
        paddingTop: "12px",
        spacing: "sm" as const,
        contents: [postback("1組", 1), postback("2組", 2), postback("3組以上", 3)],
      },
    },
  };
}

/** 来店時間（Datetimepicker） */
export function buildReservationTimePickerFlexMessage(
  opts: { groupIndex: number; totalGroups: number } = { groupIndex: 1, totalGroups: 1 }
): LineReplyMessage {
  const bodyText = reservationTimePromptBody(opts);
  return {
    type: "flex",
    altText: `${bodyText}（時間を選択するか「未定」）`,
    contents: {
      type: "bubble",
      size: "mega" as const,
      body: {
        type: "box",
        layout: "vertical" as const,
        paddingAll: "20px",
        spacing: "md" as const,
        contents: [
          {
            type: "text",
            text: bodyText,
            wrap: true,
            weight: "bold" as const,
            size: "md" as const,
            color: RESERVATION_FLEX_BODY,
          },
        ],
      },
      footer: {
        type: "box",
        layout: "vertical" as const,
        paddingAll: "20px",
        paddingTop: "12px",
        spacing: "md" as const,
        contents: [
          {
            type: "button",
            style: "primary" as const,
            color: RESERVATION_FLEX_BTN_PRIMARY,
            height: "md" as const,
            action: {
              type: "datetimepicker" as const,
              label: "⏰ 時間を選択する",
              data: "action=reservation_time_select",
              mode: "time" as const,
              initial: "20:00",
            },
          },
          {
            type: "button",
            style: "primary" as const,
            color: RESERVATION_FLEX_BTN_MUTED,
            height: "md" as const,
            action: {
              type: "postback" as const,
              label: "未定",
              data: "action=set_reservation_time_unknown",
              displayText: "未定",
            },
          },
        ],
      },
    },
  };
}

function guestCountButton(label: string, guests: number): object {
  return {
    type: "button",
    style: "primary" as const,
    color: RESERVATION_FLEX_BTN_MUTED,
    height: "md" as const,
    action: {
      type: "postback" as const,
      label,
      data: `action=reservation_guests_select&guests=${guests}`,
      displayText: label,
    },
  };
}

/** 人数（Postback 4段階） */
export function buildReservationGuestsFlexMessage(
  opts: { groupIndex: number; totalGroups: number } = { groupIndex: 1, totalGroups: 1 }
): LineReplyMessage {
  const bodyText = reservationGuestsPromptBody(opts);
  return {
    type: "flex",
    altText: `${bodyText}（ボタンから選択）`,
    contents: {
      type: "bubble",
      size: "mega" as const,
      body: {
        type: "box",
        layout: "vertical" as const,
        paddingAll: "20px",
        spacing: "md" as const,
        contents: [
          {
            type: "text",
            text: bodyText,
            wrap: true,
            weight: "bold" as const,
            size: "md" as const,
            color: RESERVATION_FLEX_BODY,
          },
        ],
      },
      footer: {
        type: "box",
        layout: "vertical" as const,
        paddingAll: "20px",
        paddingTop: "12px",
        spacing: "sm" as const,
        contents: [
          guestCountButton("1名", 1),
          guestCountButton("2名", 2),
          guestCountButton("3名", 3),
          guestCountButton("4名以上", 4),
        ],
      },
    },
  };
}

function normalizeHmFromLineTime(time: string | null | undefined): string | null {
  const t = String(time ?? "").trim();
  const m = t.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  if (Number.isNaN(h) || Number.isNaN(min) || h < 0 || h > 23 || min < 0 || min > 59) {
    return null;
  }
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

/** 来店時間を選ぶ直前の状態（旧フロー互換で total_groups=1 を補う） */
function ensureProgressForTimeStep(
  details: string | null | undefined
): ReservationProgressV2 {
  const p = parseReservationProgress(details);
  if (p && p.total_groups >= 1) {
    return {
      ...p,
      pending_time: undefined,
      pending_time_unknown: undefined,
    };
  }
  return {
    v: RESERVATION_JSON_VERSION,
    total_groups: 1,
    current_group: 1,
    records: [],
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
 * BAR 業態: 組ごとのお客様名をテキストで順に受け取る。
 */
export async function tryHandleReservationGuestNameText(
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
  const ensured = await ensureTodayAttendanceSchedule(supabase, cast, todayJst);
  if (!ensured) return false;

  const { data: schedule } = await supabase
    .from("attendance_schedules")
    .select("id, pending_line_flow, reservation_details, is_sabaki")
    .eq("id", ensured.id)
    .maybeSingle();

  if (!schedule?.id || schedule.pending_line_flow !== PENDING_RESERVATION_GUEST_NAMES) {
    return false;
  }

  if (isAttendanceCommandText(rawText)) return false;

  const safeReply = async (messages: LineReplyMessage[]) => {
    await sendReply(replyToken, channelAccessToken, messages);
  };

  const t = String(rawText ?? "").trim();
  if (!t) {
    await safeReply([{ type: "text", text: "お名前を入力してください。" }]);
    return true;
  }

  const progress = parseReservationProgress(schedule.reservation_details);
  if (!progress || progress.total_groups < 1) {
    await safeReply([{ type: "text", text: ERROR_REPLY }]);
    return true;
  }

  const names = [...(progress.guest_names ?? []), t];
  const nowIso = new Date().toISOString();

  if (names.length < progress.total_groups) {
    const updated: ReservationProgressV2 = {
      ...progress,
      guest_names: names,
      current_group: names.length + 1,
    };
    const { error: uErr } = await supabase
      .from("attendance_schedules")
      .update({
        reservation_details: serializeReservationProgress(updated),
        pending_line_updated_at: nowIso,
        updated_at: nowIso,
      })
      .eq("id", schedule.id);
    if (uErr) {
      console.error("[Reservation] guest name step:", uErr);
      await safeReply([{ type: "text", text: ERROR_REPLY }]);
      return true;
    }
    await safeReply([
      { type: "text", text: buildBarGuestNamePrompt(names.length + 1, progress.total_groups) },
    ]);
    return true;
  }

  const fullNames = names.slice(0, progress.total_groups);
  const flags = await loadStoreBarReservationFlags(supabase, cast.store_id);

  if (flags.ask_guest_time) {
    const updated: ReservationProgressV2 = {
      ...progress,
      guest_names: fullNames,
      records: [],
      current_group: 1,
      pending_time: undefined,
      pending_time_unknown: undefined,
    };
    const { error: uErr } = await supabase
      .from("attendance_schedules")
      .update({
        reservation_details: serializeReservationProgress(updated),
        pending_line_flow: PENDING_RESERVATION_TIME,
        pending_line_updated_at: nowIso,
        updated_at: nowIso,
      })
      .eq("id", schedule.id);
    if (uErr) {
      console.error("[Reservation] names→time:", uErr);
      await safeReply([{ type: "text", text: ERROR_REPLY }]);
      return true;
    }
    await safeReply([
      buildReservationTimePickerFlexMessage({
        groupIndex: 1,
        totalGroups: progress.total_groups,
      }),
    ]);
    return true;
  }

  const records: ReservationRecordEntry[] = fullNames.map((name) => ({
    time: null,
    guests: 1 as ReservationGuestButton,
    guest_name: name,
  }));
  const finalProgress: ReservationProgressV2 = {
    v: RESERVATION_JSON_VERSION,
    total_groups: progress.total_groups,
    current_group: progress.total_groups,
    records,
    guest_names: fullNames,
  };
  const detailStr = formatReservationStoredPlainText(finalProgress);
  const completionMsg = formatReservationCompletionMessage(finalProgress);

  await finalizeAttendingAttendance({
    supabase,
    cast,
    scheduleId: schedule.id,
    today: todayJst,
    isSabaki: schedule.is_sabaki === true,
    hasReservation: true,
    reservationDetails: detailStr,
    replyToken,
    channelAccessToken,
    replyMessageText: completionMsg,
  });

  return true;
}

/**
 * 予約ヒアリング中にテキストが送られた場合は、文字入力を使わずボタン操作を促す。
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
  const ensured = await ensureTodayAttendanceSchedule(supabase, cast, todayJst);
  if (!ensured) return false;

  const { data: schedule } = await supabase
    .from("attendance_schedules")
    .select("id, pending_line_flow, reservation_details")
    .eq("id", ensured.id)
    .maybeSingle();

  const flow = schedule?.pending_line_flow ?? null;
  if (!schedule?.id || !flow) return false;

  const reservationFlows = new Set([
    PENDING_RESERVATION_ASK,
    PENDING_RESERVATION_DETAIL,
    PENDING_RESERVATION_GROUP_COUNT,
    PENDING_RESERVATION_GUEST_NAMES,
    PENDING_RESERVATION_TIME,
    PENDING_RESERVATION_GUESTS,
  ]);
  if (!reservationFlows.has(flow)) return false;

  if (flow === PENDING_RESERVATION_GUEST_NAMES && isAttendanceCommandText(rawText)) {
    return false;
  }

  const t = String(rawText ?? "").trim();
  if (!t) return false;

  if (flow === PENDING_RESERVATION_ASK) {
    await sendReply(replyToken, channelAccessToken, [
      { type: "text", text: RESERVATION_ASK_REMIND_TEXT },
      buildReservationAskMessage(),
    ]);
    return true;
  }

  if (flow === PENDING_RESERVATION_DETAIL) {
    const { error: migErr } = await supabase
      .from("attendance_schedules")
      .update({
        pending_line_flow: PENDING_RESERVATION_GROUP_COUNT,
        reservation_details: null,
        pending_line_updated_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", schedule.id);
    if (migErr) {
      console.error("[Reservation] migrate detail→group_count:", migErr);
      await sendReply(replyToken, channelAccessToken, [{ type: "text", text: ERROR_REPLY }]);
      return true;
    }
    await sendReply(replyToken, channelAccessToken, [
      { type: "text", text: RESERVATION_TEXT_ONLY_REMIND },
      buildReservationGroupCountFlexMessage(),
    ]);
    return true;
  }

  if (flow === PENDING_RESERVATION_GROUP_COUNT) {
    await sendReply(replyToken, channelAccessToken, [
      { type: "text", text: RESERVATION_TEXT_ONLY_REMIND },
      buildReservationGroupCountFlexMessage(),
    ]);
    return true;
  }

  if (flow === PENDING_RESERVATION_TIME) {
    const opts = getReservationPromptTargets(schedule.reservation_details);
    await sendReply(replyToken, channelAccessToken, [
      { type: "text", text: RESERVATION_TEXT_ONLY_REMIND },
      buildReservationTimePickerFlexMessage(opts),
    ]);
    return true;
  }

  if (flow === PENDING_RESERVATION_GUESTS) {
    const opts = getReservationPromptTargets(schedule.reservation_details);
    await sendReply(replyToken, channelAccessToken, [
      { type: "text", text: RESERVATION_TEXT_ONLY_REMIND },
      buildReservationGuestsFlexMessage(opts),
    ]);
    return true;
  }

  return false;
}

export async function tryHandleBarExtendedText(
  lineUserId: string,
  rawText: string,
  supabase: ReturnType<typeof createSupabaseClient>,
  replyToken: string | undefined,
  channelAccessToken: string | undefined
): Promise<boolean> {
  const tenantStoreId = getDefaultStoreIdOrNull();
  if (!tenantStoreId || !replyToken || !channelAccessToken) return false;
  const text = String(rawText ?? "").trim();
  if (!text) return false;

  const { data: cast } = await supabase
    .from("casts")
    .select("id, store_id, name")
    .eq("line_user_id", lineUserId)
    .eq("store_id", tenantStoreId)
    .eq("is_active", true)
    .maybeSingle();
  if (!cast) return false;

  const flowType = await fetchAttendanceFlowType(supabase, cast.store_id);
  if (flowType !== "bar_extended") return false;

  const today = getTodayJst();
  const { data: schedule } = await supabase
    .from("attendance_schedules")
    .select("id, pending_line_flow, response_status, is_dohan, reservation_details")
    .eq("store_id", cast.store_id)
    .eq("cast_id", cast.id)
    .eq("scheduled_date", today)
    .maybeSingle();
  if (!schedule?.id) return false;

  if (schedule.pending_line_flow === PENDING_BAR_PLANNED_GROUPS) {
    const n = parseBarPlannedGroupsInput(text);
    if (n === null) {
      await sendReply(replyToken, channelAccessToken, [
        { type: "text", text: "確定組数は整数で入力してください（例: 0 / 1 / 2）。" },
        buildBarPlannedGroupsPromptMessage(),
      ]);
      return true;
    }
    const draftJson = serializeBarExtReservationDetails({
      ...emptyBarExtDraft(),
      confirmed_groups: n,
    });
    await supabase
      .from("attendance_schedules")
      .update({
        pending_line_flow: PENDING_BAR_TENTATIVE_GROUPS,
        pending_line_updated_at: new Date().toISOString(),
        reservation_details: draftJson,
      })
      .eq("id", schedule.id);
    await sendReply(replyToken, channelAccessToken, [buildBarTentativeGroupsPromptMessage()]);
    return true;
  }

  if (schedule.pending_line_flow === PENDING_BAR_TENTATIVE_GROUPS) {
    const n = parseBarPlannedGroupsInput(text);
    if (n === null) {
      await sendReply(replyToken, channelAccessToken, [
        { type: "text", text: "仮予定組数は整数で入力してください（例: 0 / 1 / 2）。" },
        buildBarTentativeGroupsPromptMessage(),
      ]);
      return true;
    }
    const draft = parseBarExtDraft(schedule.reservation_details) ?? emptyBarExtDraft();
    const confirmed = typeof draft.confirmed_groups === "number" ? draft.confirmed_groups : 0;
    await supabase.from("attendance_logs").upsert(
      {
        store_id: cast.store_id,
        cast_id: cast.id,
        attendance_schedule_id: schedule.id,
        attended_date: today,
        status: "attending",
        planned_groups: confirmed,
        tentative_groups: n,
        is_sabaki: false,
        responded_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      } as Record<string, unknown>,
      { onConflict: "store_id,cast_id,attended_date", ignoreDuplicates: false }
    );
    const nextDraftJson = serializeBarExtReservationDetails({
      ...draft,
      tentative_groups: n,
    });
    await supabase
      .from("attendance_schedules")
      .update({
        pending_line_flow: PENDING_BAR_ACTION,
        pending_line_updated_at: new Date().toISOString(),
        reservation_details: nextDraftJson,
      })
      .eq("id", schedule.id);
    await sendReply(replyToken, channelAccessToken, [buildBarActionPromptMessage()]);
    return true;
  }

  if (schedule.pending_line_flow === PENDING_BAR_REASON) {
    const reasonKind =
      schedule.response_status === "late"
        ? "late_reason"
        : schedule.response_status === "half_holiday"
          ? "half_holiday_reason"
          : schedule.response_status === "public_holiday"
            ? "public_holiday_reason"
            : "absent_reason";
    const draftJson = serializeBarExtReservationDetails(emptyBarExtDraft());
    await supabase
      .from("attendance_schedules")
      .update({
        [reasonKind]: text,
        pending_line_flow: PENDING_BAR_ACTION,
        pending_line_updated_at: new Date().toISOString(),
        reservation_details: draftJson,
      })
      .eq("id", schedule.id);

    await sendReply(replyToken, channelAccessToken, [buildBarActionPromptMessage()]);
    return true;
  }

  if (schedule.pending_line_flow === PENDING_BAR_ACTION_DETAIL) {
    const draft =
      parseBarExtDraft(schedule.reservation_details) ?? emptyBarExtDraft();
    const kind = draft.pending_detail_kind;
    if (!kind) {
      await supabase
        .from("attendance_schedules")
        .update({
          pending_line_flow: PENDING_BAR_ACTION,
          pending_line_updated_at: new Date().toISOString(),
        })
        .eq("id", schedule.id);
      await sendReply(replyToken, channelAccessToken, [buildBarActionPromptMessage()]);
      return true;
    }

    /** 旧バージョンの pending（"配信" のみ）が残っている場合は開始ステップへ移行 */
    if (kind === "配信") {
      const migrated = serializeBarExtReservationDetails({
        v: 1,
        entries: draft.entries,
        confirmed_groups: draft.confirmed_groups,
        tentative_groups: draft.tentative_groups,
        pending_detail_kind: BAR_DETAIL_KIND_DIST_START,
      });
      await supabase
        .from("attendance_schedules")
        .update({
          reservation_details: migrated,
          pending_line_updated_at: new Date().toISOString(),
        })
        .eq("id", schedule.id);
      await sendReply(replyToken, channelAccessToken, [
        buildBarDistributionStartPromptMessage(),
      ]);
      return true;
    }

    let actionKindForEntry: typeof BAR_DETAIL_KIND_VOICE | typeof BAR_DETAIL_KIND_SNS | "配信" | null =
      null;
    let detailStr: string | null = null;

    if (kind === BAR_DETAIL_KIND_DIST_START) {
      const hm = parseBarDistributionHourMessage(text);
      if (!hm) {
        await sendReply(replyToken, channelAccessToken, [
          {
            type: "text",
            text: "下のボタンから開始時間を選んでください。",
          },
          buildBarDistributionStartPromptMessage(),
        ]);
        return true;
      }
      const kept: BarExtDraftState = {
        v: 1,
        entries: draft.entries,
        confirmed_groups: draft.confirmed_groups,
        tentative_groups: draft.tentative_groups,
        distribution_pick_start: hm,
        pending_detail_kind: BAR_DETAIL_KIND_DIST_END,
      };
      await supabase
        .from("attendance_schedules")
        .update({
          reservation_details: serializeBarExtReservationDetails(kept),
          pending_line_updated_at: new Date().toISOString(),
        })
        .eq("id", schedule.id);
      await sendReply(replyToken, channelAccessToken, [buildBarDistributionEndPromptMessage()]);
      return true;
    }

    if (kind === BAR_DETAIL_KIND_DIST_END) {
      const endHm = parseBarDistributionHourMessage(text);
      const startHm =
        draft.distribution_pick_start && draft.distribution_pick_start.trim().length > 0
          ? draft.distribution_pick_start.trim()
          : null;
      if (!endHm || !startHm) {
        await sendReply(replyToken, channelAccessToken, [
          buildBarDistributionStartPromptMessage(),
        ]);
        return true;
      }
      detailStr = `${startHm}-${endHm}`;
      actionKindForEntry = "配信";
    } else if (kind === BAR_DETAIL_KIND_VOICE || kind === BAR_DETAIL_KIND_SNS) {
      detailStr = parseBarContactExchangeDetailFromMessage(text);
      actionKindForEntry = kind;
    }

    if (!detailStr || !actionKindForEntry) {
      const hint =
        kind === BAR_DETAIL_KIND_DIST_END
          ? "下のボタンから終了時間を選んでください。"
          : "人数は下のボタンから選択してください。";
      if (
        kind === BAR_DETAIL_KIND_DIST_END ||
        kind === BAR_DETAIL_KIND_DIST_START
      ) {
        await sendReply(replyToken, channelAccessToken, [
          { type: "text", text: hint },
          kind === BAR_DETAIL_KIND_DIST_START
            ? buildBarDistributionStartPromptMessage()
            : buildBarDistributionEndPromptMessage(),
        ]);
      } else if (kind === BAR_DETAIL_KIND_VOICE || kind === BAR_DETAIL_KIND_SNS) {
        await sendReply(replyToken, channelAccessToken, [
          { type: "text", text: hint },
          buildBarContactExchangePromptMessage(kind),
        ]);
      } else {
        await sendReply(replyToken, channelAccessToken, [{ type: "text", text: hint }]);
      }
      return true;
    }

    const nextEntries = [...draft.entries, { kind: actionKindForEntry, detail: detailStr }];
    const nextDraftJson = serializeBarExtReservationDetails({
      v: 1,
      entries: nextEntries,
      confirmed_groups: draft.confirmed_groups,
      tentative_groups: draft.tentative_groups,
    });

    await supabase
      .from("attendance_schedules")
      .update({
        pending_line_flow: PENDING_BAR_ACTION,
        pending_line_updated_at: new Date().toISOString(),
        reservation_details: nextDraftJson,
      })
      .eq("id", schedule.id);

    await sendReply(replyToken, channelAccessToken, [buildBarActionPromptMessage({ followUp: true })]);
    return true;
  }

  if (schedule.pending_line_flow === PENDING_BAR_ACTION) {
    await sendReply(replyToken, channelAccessToken, [
      {
        type: "text",
        text: "画面のボタンから行動を選ぶか、「✅ 報告完了」を押してください。",
        quickReply: { items: getBarActionQuickReplyItems() },
      },
    ]);
    return true;
  }

  return false;
}

export async function handleBarActionPostback(
  lineUserId: string,
  rawData: string,
  supabase: ReturnType<typeof createSupabaseClient>,
  replyToken: string | undefined,
  channelAccessToken: string | undefined
): Promise<boolean> {
  const payload = String(rawData ?? "").trim();
  if (!payload.startsWith("bar_action:")) return false;
  if (!replyToken || !channelAccessToken) return false;

  const actionType = payload.replace("bar_action:", "");
  const tenantStoreId = getDefaultStoreIdOrNull();
  if (!tenantStoreId) return true;

  const { data: cast } = await supabase
    .from("casts")
    .select("id, store_id, name")
    .eq("line_user_id", lineUserId)
    .eq("store_id", tenantStoreId)
    .eq("is_active", true)
    .maybeSingle();
  if (!cast) return true;

  const today = getTodayJst();
  const { data: schedule } = await supabase
    .from("attendance_schedules")
    .select("id, pending_line_flow, response_status, reservation_details")
    .eq("store_id", cast.store_id)
    .eq("cast_id", cast.id)
    .eq("scheduled_date", today)
    .maybeSingle();
  if (!schedule?.id || schedule.pending_line_flow !== PENDING_BAR_ACTION) return true;

  const logBasics = await fetchTodayAttendanceLogBasics(
    supabase,
    cast.store_id,
    cast.id,
    today
  );
  const draft = parseBarExtDraft(schedule.reservation_details) ?? emptyBarExtDraft();

  const attendanceStatus =
    schedule.response_status === "late"
      ? "late"
      : schedule.response_status === "absent"
        ? "absent"
        : "attending";

  const nowIso = new Date().toISOString();

  const finalizeSchedule = async () => {
    await supabase
      .from("attendance_schedules")
      .update({
        pending_line_flow: null,
        is_action_completed: true,
        pending_line_updated_at: null,
        reservation_details: null,
      })
      .eq("id", schedule.id);
  };

  if (actionType === BAR_REPORT_DONE_POSTBACK) {
    if (draft.entries.length === 0) {
      await sendReply(replyToken, channelAccessToken, [
        {
          type: "text",
          text: "まだ行動が登録されていません。「配信」「声かけ」「SNS」から選ぶか、該当が無い場合は「できていない」を選んでください。",
          quickReply: { items: getBarActionQuickReplyItems() },
        },
      ]);
      return true;
    }

    const combined = formatBarActionCombinedDetail(draft.entries);
    await supabase.from("attendance_logs").upsert(
      {
        store_id: cast.store_id,
        cast_id: cast.id,
        attendance_schedule_id: schedule.id,
        attended_date: today,
        status: logBasics?.status ?? attendanceStatus,
        planned_groups: logBasics?.planned_groups ?? null,
        tentative_groups: logBasics?.tentative_groups ?? null,
        action_type: "複数",
        action_detail: combined,
        responded_at: nowIso,
        updated_at: nowIso,
      } as Record<string, unknown>,
      { onConflict: "store_id,cast_id,attended_date", ignoreDuplicates: false }
    );
    await finalizeSchedule();
    await notifyAdminsBarAttendanceCompleted({
      supabase,
      storeId: cast.store_id,
      castName: cast.name ?? null,
      channelAccessToken,
      plannedGroups: logBasics?.planned_groups ?? null,
      tentativeGroups: logBasics?.tentative_groups ?? null,
      attendanceScheduleId: schedule.id,
    });
    await sendReply(replyToken, channelAccessToken, [
      {
        type: "text",
        text: `行動確認を保存しました。\n${combined}`,
      },
    ]);
    return true;
  }

  if (actionType === "できていない") {
    await supabase.from("attendance_logs").upsert(
      {
        store_id: cast.store_id,
        cast_id: cast.id,
        attendance_schedule_id: schedule.id,
        attended_date: today,
        status: logBasics?.status ?? attendanceStatus,
        planned_groups: logBasics?.planned_groups ?? null,
        tentative_groups: logBasics?.tentative_groups ?? null,
        action_type: "できていない",
        action_detail: null,
        responded_at: nowIso,
        updated_at: nowIso,
      } as Record<string, unknown>,
      { onConflict: "store_id,cast_id,attended_date", ignoreDuplicates: false }
    );
    await finalizeSchedule();
    await notifyAdminsBarAttendanceCompleted({
      supabase,
      storeId: cast.store_id,
      castName: cast.name ?? null,
      channelAccessToken,
      plannedGroups: logBasics?.planned_groups ?? null,
      tentativeGroups: logBasics?.tentative_groups ?? null,
      attendanceScheduleId: schedule.id,
    });
    await sendReply(replyToken, channelAccessToken, [
      { type: "text", text: "出勤確認を保存しました。ありがとうございました。" },
    ]);
    return true;
  }

  const needsDetail =
    actionType === "配信" || actionType === BAR_DETAIL_KIND_VOICE || actionType === BAR_DETAIL_KIND_SNS;
  if (!needsDetail) {
    await sendReply(replyToken, channelAccessToken, [buildBarActionPromptMessage({ followUp: true })]);
    return true;
  }

  const barDraftBase = parseBarExtDraft(schedule.reservation_details) ?? emptyBarExtDraft();

  let nextReservationDetails: string;
  let replyMsgs: LineReplyMessage[];

  if (actionType === "配信") {
    nextReservationDetails = serializeBarExtReservationDetails({
      v: 1,
      entries: barDraftBase.entries,
      confirmed_groups: barDraftBase.confirmed_groups,
      tentative_groups: barDraftBase.tentative_groups,
      pending_detail_kind: BAR_DETAIL_KIND_DIST_START,
    });
    replyMsgs = [buildBarDistributionStartPromptMessage()];
  } else if (actionType === BAR_DETAIL_KIND_VOICE) {
    nextReservationDetails = serializeBarExtReservationDetails({
      v: 1,
      entries: barDraftBase.entries,
      confirmed_groups: barDraftBase.confirmed_groups,
      tentative_groups: barDraftBase.tentative_groups,
      pending_detail_kind: BAR_DETAIL_KIND_VOICE,
    });
    replyMsgs = [buildBarContactExchangePromptMessage(BAR_DETAIL_KIND_VOICE)];
  } else {
    nextReservationDetails = serializeBarExtReservationDetails({
      v: 1,
      entries: barDraftBase.entries,
      confirmed_groups: barDraftBase.confirmed_groups,
      tentative_groups: barDraftBase.tentative_groups,
      pending_detail_kind: BAR_DETAIL_KIND_SNS,
    });
    replyMsgs = [buildBarContactExchangePromptMessage(BAR_DETAIL_KIND_SNS)];
  }

  await supabase
    .from("attendance_schedules")
    .update({
      pending_line_flow: PENDING_BAR_ACTION_DETAIL,
      reservation_details: nextReservationDetails,
      pending_line_updated_at: nowIso,
    })
    .eq("id", schedule.id);

  await sendReply(replyToken, channelAccessToken, replyMsgs);
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

/** @deprecated tryHandleReservationDetailText に統合（はい/いいえ以外は同ファイルで処理） */
export async function tryHandleReservationAskInvalidText(
  _lineUserId: string,
  _rawText: string,
  _supabase: ReturnType<typeof createSupabaseClient>,
  _replyToken: string | undefined,
  _channelAccessToken: string | undefined
): Promise<boolean> {
  return false;
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

    /** BAR 詳細フローでは理由入力後に行動確認へ進むため、ここでは保存しない */
    if (schedule.pending_line_flow === PENDING_BAR_REASON) {
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

    if (reasonKind === "absent") {
      updates.absent_reason = text;
      updates.response_status = "absent";
      updates.is_absent = true;
      updates.is_late = false;
    } else if (reasonKind === "late") {
      updates.late_reason = text;
      updates.response_status = "late";
      updates.is_late = true;
      updates.is_absent = false;
    } else if (reasonKind === "public_holiday") {
      updates.public_holiday_reason = text;
      updates.response_status = "public_holiday";
      updates.is_absent = false;
      updates.is_late = false;
    } else {
      updates.half_holiday_reason = text;
      updates.response_status = "half_holiday";
      updates.is_absent = false;
      updates.is_late = false;
    }

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
  isSabaki: boolean;
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
    isSabaki,
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
      is_sabaki: isSabaki,
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
  isSabaki: boolean,
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
      is_sabaki: isSabaki,
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
  const ensured = await ensureTodayAttendanceSchedule(supabase, cast, today);
  if (!ensured) {
    await safeReply([{ type: "text", text: ERROR_REPLY }]);
    return;
  }

  const { data: schedule } = await supabase
    .from("attendance_schedules")
    .select("id, pending_line_flow, is_sabaki")
    .eq("id", ensured.id)
    .maybeSingle();

  if (!schedule?.id) {
    await safeReply([{ type: "text", text: NO_SCHEDULE_FOR_TODAY_REPLY }]);
    return;
  }

  const scheduleSabaki = schedule.is_sabaki === true;

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
      isSabaki: scheduleSabaki,
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
      pending_line_flow: PENDING_RESERVATION_GROUP_COUNT,
      reservation_details: null,
      pending_line_updated_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", schedule.id);

  if (updErr) {
    console.error("[Attendance] reservation_yes 更新エラー:", updErr);
    await safeReply([{ type: "text", text: ERROR_REPLY }]);
    return;
  }

  await safeReply([buildReservationGroupCountFlexMessage()]);
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

    const ensured = await ensureTodayAttendanceSchedule(supabase, cast, today);
    if (!ensured) {
      await safeReply(ERROR_REPLY);
      return;
    }

    const { data: schedule, error: scheduleFetchError } = await supabase
      .from("attendance_schedules")
      .select("id, pending_line_flow, response_status, is_action_completed, is_sabaki, reservation_details")
      .eq("id", ensured.id)
      .maybeSingle();

    if (scheduleFetchError) {
      await safeReply(ERROR_REPLY);
      return;
    }

    if (!schedule?.id) {
      await safeReply(ERROR_REPLY);
      return;
    }

    const scheduleId = schedule.id;
    const isSabaki = schedule.is_sabaki === true;

    if (statusData === "attending" || statusData === "dohan") {
      const flowType = await fetchAttendanceFlowType(supabase, cast.store_id);
      if (flowType === "bar_extended") {
        const nowIso = new Date().toISOString();
        await supabase.from("attendance_logs").upsert(
          {
            store_id: cast.store_id,
            cast_id: cast.id,
            attendance_schedule_id: scheduleId,
            attended_date: today,
            status: "attending",
            responded_at: nowIso,
            updated_at: nowIso,
          } as Record<string, unknown>,
          { onConflict: "store_id,cast_id,attended_date", ignoreDuplicates: false }
        );
        await supabase
          .from("attendance_schedules")
          .update({
            response_status: "attending",
            is_dohan: statusData === "dohan",
            is_absent: false,
            is_late: false,
            is_action_completed: false,
            pending_line_flow: PENDING_BAR_PLANNED_GROUPS,
            reservation_details: serializeBarExtReservationDetails(emptyBarExtDraft()),
            pending_line_updated_at: nowIso,
            updated_at: nowIso,
          })
          .eq("id", scheduleId);
        if (!replyToken || !channelAccessToken) {
          await safeReply(ERROR_REPLY);
          return;
        }
        await sendReply(replyToken, channelAccessToken, [buildBarPlannedGroupsPromptMessage()]);
        return;
      }
      const pending = schedule.pending_line_flow ?? null;
      const rs = schedule.response_status ?? null;
      const done = schedule.is_action_completed === true;

      if (pending === PENDING_RESERVATION_DETAIL) {
        const nowIso = new Date().toISOString();
        await supabase
          .from("attendance_schedules")
          .update({
            pending_line_flow: PENDING_RESERVATION_GROUP_COUNT,
            reservation_details: null,
            pending_line_updated_at: nowIso,
            updated_at: nowIso,
          })
          .eq("id", scheduleId);
        if (replyToken && channelAccessToken) {
          await sendReply(replyToken, channelAccessToken, [buildReservationGroupCountFlexMessage()]);
        }
        return;
      }
      if (pending === PENDING_RESERVATION_GROUP_COUNT) {
        if (replyToken && channelAccessToken) {
          await sendReply(replyToken, channelAccessToken, [buildReservationGroupCountFlexMessage()]);
        }
        return;
      }
      if (pending === PENDING_RESERVATION_GUEST_NAMES) {
        if (replyToken && channelAccessToken) {
          const p = parseReservationProgress(schedule.reservation_details);
          const idx = (p?.guest_names?.length ?? 0) + 1;
          const total = p?.total_groups ?? 1;
          await sendReply(replyToken, channelAccessToken, [
            { type: "text", text: buildBarGuestNamePrompt(Math.min(idx, total), total) },
          ]);
        }
        return;
      }
      if (pending === PENDING_RESERVATION_TIME) {
        if (replyToken && channelAccessToken) {
          const opts = getReservationPromptTargets(schedule.reservation_details);
          await sendReply(replyToken, channelAccessToken, [
            buildReservationTimePickerFlexMessage(opts),
          ]);
        }
        return;
      }
      if (pending === PENDING_RESERVATION_GUESTS) {
        if (replyToken && channelAccessToken) {
          const opts = getReservationPromptTargets(schedule.reservation_details);
          await sendReply(replyToken, channelAccessToken, [
            buildReservationGuestsFlexMessage(opts),
          ]);
        }
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
          isSabaki,
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
        isSabaki,
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

    const flowType = await fetchAttendanceFlowType(supabase, cast.store_id);
    if (flowType === "bar_extended") {
      const nowIso = new Date().toISOString();
      await supabase.from("attendance_logs").upsert(
        {
          store_id: cast.store_id,
          cast_id: cast.id,
          attendance_schedule_id: scheduleId,
          attended_date: today,
          status: statusData === "late" ? "late" : "absent",
          responded_at: nowIso,
          updated_at: nowIso,
        } as Record<string, unknown>,
        { onConflict: "store_id,cast_id,attended_date", ignoreDuplicates: false }
      );
      await supabase
        .from("attendance_schedules")
        .update({
          is_action_completed: false,
          response_status: statusData,
          is_absent: statusData === "absent",
          is_late: statusData === "late",
          pending_line_flow: PENDING_BAR_REASON,
          pending_line_updated_at: nowIso,
          updated_at: nowIso,
        })
        .eq("id", scheduleId);
      await safeReply("理由を入力してください。");
      return;
    }

    const status = statusData;

    const upsertResult = await supabase.from("attendance_logs").upsert(
      {
        store_id: cast.store_id,
        cast_id: cast.id,
        attendance_schedule_id: scheduleId,
        attended_date: today,
        status,
        is_sabaki: isSabaki,
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

function parseReservationGuestsFromData(raw: string): number | null {
  const s = raw.trim();
  if (!s.includes("reservation_guests_select")) return null;
  const m = s.match(/(?:^|&)guests=(\d+)/);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  if (Number.isNaN(n) || n < 1 || n > 4) return null;
  return n;
}

/**
 * 予約フロー: 組数 Postback → Datetimepicker（来店時間）→ Postback（人数）を組数分ループ。
 * 対象 data のときのみ true。
 */
export async function handleReservationFollowupPostback(
  lineUserId: string,
  rawData: string,
  params: { time?: string; date?: string; datetime?: string } | undefined,
  supabase: ReturnType<typeof createSupabaseClient>,
  replyToken: string | undefined,
  channelAccessToken: string | undefined
): Promise<boolean> {
  if (!replyToken?.trim() || !channelAccessToken?.trim()) return false;

  const data = String(rawData ?? "").trim();
  const isGroupSelect = data.includes("reservation_group_select");
  const isTime = data === "action=reservation_time_select";
  const isTimeUnknown = data === "action=set_reservation_time_unknown";
  const isGuests = data.includes("reservation_guests_select");
  if (!isGroupSelect && !isTime && !isTimeUnknown && !isGuests) {
    return false;
  }

  const safeReply = async (messages: LineReplyMessage[]) => {
    await sendReply(replyToken, channelAccessToken, messages);
  };

  const tenantStoreId = getDefaultStoreIdOrNull();
  if (!tenantStoreId) {
    await safeReply([{ type: "text", text: ERROR_REPLY }]);
    return true;
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
    return true;
  }

  const today = getTodayJst();
  const ensured = await ensureTodayAttendanceSchedule(supabase, cast, today);
  if (!ensured) {
    await safeReply([{ type: "text", text: ERROR_REPLY }]);
    return true;
  }

  const { data: schedule } = await supabase
    .from("attendance_schedules")
    .select("id, pending_line_flow, reservation_details, is_sabaki")
    .eq("id", ensured.id)
    .maybeSingle();

  if (!schedule?.id) {
    await safeReply([{ type: "text", text: NO_SCHEDULE_FOR_TODAY_REPLY }]);
    return true;
  }

  const nowIso = new Date().toISOString();

  if (isGroupSelect) {
    if (schedule.pending_line_flow !== PENDING_RESERVATION_GROUP_COUNT) {
      await safeReply([
        { type: "text", text: "現在、組数の選択はできません。出勤確認の流れをご確認ください。" },
      ]);
      return true;
    }
    const groups = parseReservationGroupCountFromPostback(data);
    if (groups == null) {
      await safeReply([{ type: "text", text: ERROR_REPLY }]);
      return true;
    }

    const flags = await loadStoreBarReservationFlags(supabase, cast.store_id);

    if (flags.business_type === "bar") {
      if (flags.ask_guest_name) {
        const initial: ReservationProgressV2 = {
          v: RESERVATION_JSON_VERSION,
          total_groups: groups,
          current_group: 1,
          records: [],
          guest_names: [],
        };
        const { error: uErrBar } = await supabase
          .from("attendance_schedules")
          .update({
            reservation_details: serializeReservationProgress(initial),
            pending_line_flow: PENDING_RESERVATION_GUEST_NAMES,
            pending_line_updated_at: nowIso,
            updated_at: nowIso,
          })
          .eq("id", schedule.id);
        if (uErrBar) {
          console.error("[Reservation] BAR group→names:", uErrBar);
          await safeReply([{ type: "text", text: ERROR_REPLY }]);
          return true;
        }
        await safeReply([
          { type: "text", text: buildBarGuestNamePrompt(1, groups) },
        ]);
        return true;
      }
      if (flags.ask_guest_time) {
        const initial: ReservationProgressV2 = {
          v: RESERVATION_JSON_VERSION,
          total_groups: groups,
          current_group: 1,
          records: [],
        };
        const { error: uErrT } = await supabase
          .from("attendance_schedules")
          .update({
            reservation_details: serializeReservationProgress(initial),
            pending_line_flow: PENDING_RESERVATION_TIME,
            pending_line_updated_at: nowIso,
            updated_at: nowIso,
          })
          .eq("id", schedule.id);
        if (uErrT) {
          console.error("[Reservation] BAR group→time:", uErrT);
          await safeReply([{ type: "text", text: ERROR_REPLY }]);
          return true;
        }
        await safeReply([
          buildReservationTimePickerFlexMessage({ groupIndex: 1, totalGroups: groups }),
        ]);
        return true;
      }

      const detailStr = formatBarGroupsOnlyStoredPlainText(groups);
      const completionMsg = formatBarGroupsOnlyMessage(groups);
      await finalizeAttendingAttendance({
        supabase,
        cast,
        scheduleId: schedule.id,
        today,
        isSabaki: schedule.is_sabaki === true,
        hasReservation: true,
        reservationDetails: detailStr,
        replyToken,
        channelAccessToken,
        replyMessageText: completionMsg,
      });
      return true;
    }

    const initial: ReservationProgressV2 = {
      v: RESERVATION_JSON_VERSION,
      total_groups: groups,
      current_group: 1,
      records: [],
    };
    const { error: uErr } = await supabase
      .from("attendance_schedules")
      .update({
        reservation_details: serializeReservationProgress(initial),
        pending_line_flow: PENDING_RESERVATION_TIME,
        pending_line_updated_at: nowIso,
        updated_at: nowIso,
      })
      .eq("id", schedule.id);
    if (uErr) {
      console.error("[Reservation] group select update:", uErr);
      await safeReply([{ type: "text", text: ERROR_REPLY }]);
      return true;
    }
    await safeReply([
      buildReservationTimePickerFlexMessage({ groupIndex: 1, totalGroups: groups }),
    ]);
    return true;
  }

  if (data === "action=reservation_time_select") {
    if (schedule.pending_line_flow !== PENDING_RESERVATION_TIME) {
      await safeReply([
        { type: "text", text: "現在、来店時間の選択はできません。出勤確認の流れをご確認ください。" },
      ]);
      return true;
    }
    const hm = normalizeHmFromLineTime(params?.time);
    if (!hm) {
      await safeReply([{ type: "text", text: "時間を取得できませんでした。もう一度お試しください。" }]);
      return true;
    }
    const base = ensureProgressForTimeStep(schedule.reservation_details);
    const nextIdx = nextGroupIndexToFill(base);
    if (nextIdx > base.total_groups) {
      await safeReply([
        { type: "text", text: "予約の組数情報が不正です。最初からやり直してください。" },
      ]);
      return true;
    }
    const updated: ReservationProgressV2 = {
      ...base,
      current_group: nextIdx,
      pending_time: hm,
      pending_time_unknown: undefined,
    };
    const { error: uErr } = await supabase
      .from("attendance_schedules")
      .update({
        reservation_details: serializeReservationProgress(updated),
        pending_line_flow: PENDING_RESERVATION_GUESTS,
        pending_line_updated_at: nowIso,
        updated_at: nowIso,
      })
      .eq("id", schedule.id);
    if (uErr) {
      console.error("[Reservation] time step update:", uErr);
      await safeReply([{ type: "text", text: ERROR_REPLY }]);
      return true;
    }
    await safeReply([
      buildReservationGuestsFlexMessage({
        groupIndex: nextIdx,
        totalGroups: base.total_groups,
      }),
    ]);
    return true;
  }

  if (isTimeUnknown) {
    if (schedule.pending_line_flow !== PENDING_RESERVATION_TIME) {
      await safeReply([
        { type: "text", text: "現在、来店時間の選択はできません。出勤確認の流れをご確認ください。" },
      ]);
      return true;
    }
    const base = ensureProgressForTimeStep(schedule.reservation_details);
    const nextIdx = nextGroupIndexToFill(base);
    if (nextIdx > base.total_groups) {
      await safeReply([
        { type: "text", text: "予約の組数情報が不正です。最初からやり直してください。" },
      ]);
      return true;
    }
    const updatedUnknown: ReservationProgressV2 = {
      ...base,
      current_group: nextIdx,
      pending_time_unknown: true,
    };
    const { error: uErrUn } = await supabase
      .from("attendance_schedules")
      .update({
        reservation_details: serializeReservationProgress(updatedUnknown),
        pending_line_flow: PENDING_RESERVATION_GUESTS,
        pending_line_updated_at: nowIso,
        updated_at: nowIso,
      })
      .eq("id", schedule.id);
    if (uErrUn) {
      console.error("[Reservation] time unknown step update:", uErrUn);
      await safeReply([{ type: "text", text: ERROR_REPLY }]);
      return true;
    }
    await safeReply([
      buildReservationGuestsFlexMessage({
        groupIndex: nextIdx,
        totalGroups: base.total_groups,
      }),
    ]);
    return true;
  }

  const guests = parseReservationGuestsFromData(data);
  if (guests == null) {
    if (data.includes("reservation_guests_select")) {
      await safeReply([{ type: "text", text: ERROR_REPLY }]);
      return true;
    }
    return false;
  }

  if (schedule.pending_line_flow !== PENDING_RESERVATION_GUESTS) {
    await safeReply([
      { type: "text", text: "現在、人数の選択はできません。先に来店時間を選ぶか「未定」を選んでください。" },
    ]);
    return true;
  }

  const progress = parseReservationProgress(schedule.reservation_details);
  const pendingUnknown = progress?.pending_time_unknown === true;
  const hm = pendingUnknown
    ? null
    : progress?.pending_time
      ? normalizeHmFromLineTime(progress.pending_time)
      : null;
  if (!progress || (!pendingUnknown && !hm)) {
    await safeReply([
      { type: "text", text: "来店時間の情報が見つかりません。最初からやり直してください。" },
    ]);
    return true;
  }

  const guestBtn = guests as ReservationGuestButton;
  const nameForGroup = progress.guest_names?.[progress.records.length]?.trim() ?? null;
  const newRecords = [
    ...progress.records,
    {
      time: hm,
      guests: guestBtn,
      ...(nameForGroup ? { guest_name: nameForGroup } : {}),
    },
  ];

  if (newRecords.length < progress.total_groups) {
    const nextProgress: ReservationProgressV2 = {
      v: RESERVATION_JSON_VERSION,
      total_groups: progress.total_groups,
      current_group: newRecords.length + 1,
      records: newRecords,
      guest_names: progress.guest_names,
    };
    const { error: loopErr } = await supabase
      .from("attendance_schedules")
      .update({
        reservation_details: serializeReservationProgress(nextProgress),
        pending_line_flow: PENDING_RESERVATION_TIME,
        pending_line_updated_at: nowIso,
        updated_at: nowIso,
      })
      .eq("id", schedule.id);
    if (loopErr) {
      console.error("[Reservation] guest loop update:", loopErr);
      await safeReply([{ type: "text", text: ERROR_REPLY }]);
      return true;
    }
    await safeReply([
      buildReservationTimePickerFlexMessage({
        groupIndex: nextProgress.current_group,
        totalGroups: nextProgress.total_groups,
      }),
    ]);
    return true;
  }

  const finalProgress: ReservationProgressV2 = {
    v: RESERVATION_JSON_VERSION,
    total_groups: progress.total_groups,
    current_group: progress.total_groups,
    records: newRecords,
    guest_names: progress.guest_names,
  };
  const detailStr = formatReservationStoredPlainText(finalProgress);
  const completionMsg = formatReservationCompletionMessage(finalProgress);

  await finalizeAttendingAttendance({
    supabase,
    cast,
    scheduleId: schedule.id,
    today,
    isSabaki: schedule.is_sabaki === true,
    hasReservation: true,
    reservationDetails: detailStr,
    replyToken,
    channelAccessToken,
    replyMessageText: completionMsg,
  });

  return true;
}

const SABAKI_UNKNOWN_REPLY =
  "承知いたしました。時間が分かり次第、また教えてください。";

function normalizeLineTimeToSql(time: string | null | undefined): string | null {
  const t = String(time ?? "").trim();
  const m = t.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  if (Number.isNaN(h) || Number.isNaN(min) || h < 0 || h > 23 || min < 0 || min > 59) {
    return null;
  }
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}:00`;
}

function formatHmForSabakiReply(sqlTime: string): string {
  const m = sqlTime.match(/^(\d{2}):(\d{2})/);
  return m ? `${m[1]}:${m[2]}` : sqlTime.slice(0, 5);
}

/**
 * 捌きリマインドの Postback / Datetimepicker（入店時間・未定）。
 * 対象の data のときのみ処理し true を返す。
 */
export async function handleSabakiTimePostback(
  lineUserId: string,
  rawData: string,
  params: { date?: string; time?: string; datetime?: string } | undefined,
  supabase: ReturnType<typeof createSupabaseClient>,
  replyToken: string | undefined,
  channelAccessToken: string | undefined
): Promise<boolean> {
  const data = String(rawData ?? "").trim();
  if (data !== "action=sabaki_time_unknown" && data !== "action=sabaki_time_update") {
    return false;
  }

  const safeReply = async (text: string) => {
    if (replyToken && channelAccessToken) {
      await sendReply(replyToken, channelAccessToken, [{ type: "text", text }]);
    }
  };

  const tenantStoreId = getDefaultStoreIdOrNull();
  if (!tenantStoreId) {
    await safeReply(ERROR_REPLY);
    return true;
  }

  const { data: cast } = await supabase
    .from("casts")
    .select("id, store_id, name")
    .eq("line_user_id", lineUserId)
    .eq("store_id", tenantStoreId)
    .eq("is_active", true)
    .maybeSingle();

  if (!cast) {
    await safeReply(CAST_NOT_FOUND_REPLY);
    return true;
  }

  const today = getTodayJst();

  if (data === "action=sabaki_time_unknown") {
    await safeReply(SABAKI_UNKNOWN_REPLY);
    return true;
  }

  const sqlTime = normalizeLineTimeToSql(params?.time);
  if (!sqlTime) {
    await safeReply("時間を取得できませんでした。もう一度お試しください。");
    return true;
  }

  const { data: schedule, error: schedErr } = await supabase
    .from("attendance_schedules")
    .select("id, is_sabaki")
    .eq("store_id", cast.store_id)
    .eq("cast_id", cast.id)
    .eq("scheduled_date", today)
    .maybeSingle();

  if (schedErr) {
    console.error("[Sabaki] schedule fetch:", schedErr);
    await safeReply(ERROR_REPLY);
    return true;
  }

  if (!schedule?.id) {
    await safeReply(NO_SCHEDULE_FOR_TODAY_REPLY);
    return true;
  }

  if (schedule.is_sabaki !== true) {
    await safeReply("捌き出勤の予定が見つかりません。管理者にご連絡ください。");
    return true;
  }

  const nowIso = new Date().toISOString();

  const { error: updErr } = await supabase
    .from("attendance_schedules")
    .update({
      scheduled_time: sqlTime,
      response_status: "attending",
      is_absent: false,
      is_late: false,
      is_action_completed: true,
      pending_line_flow: null,
      pending_line_updated_at: null,
      updated_at: nowIso,
    })
    .eq("id", schedule.id);

  if (updErr) {
    console.error("[Sabaki] attendance_schedules update:", updErr);
    await safeReply(ERROR_REPLY);
    return true;
  }

  const upsertLog = await supabase.from("attendance_logs").upsert(
    {
      store_id: cast.store_id,
      cast_id: cast.id,
      attendance_schedule_id: schedule.id,
      attended_date: today,
      status: "attending",
      is_sabaki: true,
      responded_at: nowIso,
      updated_at: nowIso,
    } as Record<string, unknown>,
    {
      onConflict: "store_id,cast_id,attended_date",
      ignoreDuplicates: false,
    }
  );

  if (upsertLog.error) {
    console.error("[Sabaki] attendance_logs upsert:", upsertLog.error);
    await safeReply(ERROR_REPLY);
    return true;
  }

  const hm = formatHmForSabakiReply(sqlTime);
  await safeReply(`${hm}入りの連絡を受け付けました。お待ちしております。`);
  return true;
}
