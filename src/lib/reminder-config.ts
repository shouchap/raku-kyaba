import type { SupabaseClient } from "@supabase/supabase-js";
import { isUndefinedColumnError } from "@/lib/postgrest-error";

const DEFAULT_REMINDER_MESSAGE_TEMPLATE =
  "{name}さん、本日は {time} 出勤予定です。出勤確認をお願いいたします。";

/** 出勤確認 Flex の公休・半休ボタン表示（system_settings の reminder_config 行） */
export type HolidayFlexFlags = {
  enablePublicHoliday: boolean;
  enableHalfHoliday: boolean;
};

const DEFAULT_HOLIDAY_FLAGS: HolidayFlexFlags = {
  enablePublicHoliday: false,
  enableHalfHoliday: false,
};

/**
 * system_settings.reminder_config 行から公休・半休ボタン表示を取得。
 * 016 未適用の DB では false 固定。
 */
export async function fetchAttendanceFlexHolidayOptions(
  supabase: SupabaseClient,
  storeId: string
): Promise<HolidayFlexFlags> {
  const { data, error } = await supabase
    .from("system_settings")
    .select("enable_public_holiday, enable_half_holiday")
    .eq("store_id", storeId)
    .eq("key", "reminder_config")
    .maybeSingle();

  if (error) {
    if (isUndefinedColumnError(error, "enable_public_holiday")) {
      return { ...DEFAULT_HOLIDAY_FLAGS };
    }
    console.error("[reminder-config] fetchAttendanceFlexHolidayOptions:", error.message);
    return { ...DEFAULT_HOLIDAY_FLAGS };
  }

  return {
    enablePublicHoliday: data?.enable_public_holiday === true,
    enableHalfHoliday: data?.enable_half_holiday === true,
  };
}

/**
 * system_settings.reminder_config からメッセージテンプレートを取得（/api/remind と共通）
 */
export async function fetchReminderMessageTemplate(
  supabase: SupabaseClient,
  storeId: string
): Promise<string> {
  const { data: settingsRow } = await supabase
    .from("system_settings")
    .select("value")
    .eq("store_id", storeId)
    .eq("key", "reminder_config")
    .maybeSingle();

  const raw = (settingsRow?.value ?? {}) as Record<string, unknown>;
  const fromTemplate =
    (typeof raw.messageTemplate === "string" && raw.messageTemplate.trim()) ||
    (typeof raw.template === "string" && raw.template.trim()) ||
    "";

  const t = (fromTemplate || DEFAULT_REMINDER_MESSAGE_TEMPLATE).trim();
  return t || DEFAULT_REMINDER_MESSAGE_TEMPLATE;
}
