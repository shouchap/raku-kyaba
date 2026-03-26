import type { SupabaseClient } from "@supabase/supabase-js";

const DEFAULT_REMINDER_MESSAGE_TEMPLATE =
  "{name}さん、本日は {time} 出勤予定です。出勤確認をお願いいたします。";

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
