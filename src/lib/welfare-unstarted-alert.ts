import type { SupabaseClient } from "@supabase/supabase-js";
import { sendMulticastMessage } from "@/lib/line-reply";
import { fetchResolvedLineChannelAccessTokenForStore } from "@/lib/line-channel-token";
import { getAdminRecipientLineUserIds } from "@/lib/line-admin-recipients";

/**
 * B型事業所（welfare_b）の「作業開始 未打刻アラート」共通処理。
 *
 * 定期実行（/api/welfare/warn-unstarted）と設定画面のテスト送信で同じ判定・文面を使う。
 */

/** メッセージに列挙する最大人数（LINE 文字数対策） */
const MAX_NAMES_IN_MESSAGE = 20;

export type UnstartedAlertSendResult =
  | { ok: true; recipients: number }
  | { ok: false; reason: "no_admin_recipient" | "no_line_token" | "line_send"; detail?: string };

/**
 * 当日「作業開始」を押していない利用者の名前一覧。
 *
 * 出勤予定の有無は見ない（定期配信と同じくアクティブな利用者全員が対象）。
 * 欠席・体調不良の連絡があっても、作業開始が押されていなければ含める。
 * 管理者アカウントは利用者ではないので除外する。
 */
export async function fetchUnstartedCastNames(
  supabase: SupabaseClient,
  storeId: string,
  today: string
): Promise<string[]> {
  const { data: castRows, error: castErr } = await supabase
    .from("casts")
    .select("id, name, display_name, is_admin")
    .eq("store_id", storeId)
    .eq("is_active", true)
    .order("name");

  if (castErr) {
    throw new Error(`casts fetch error: ${castErr.message}`);
  }

  type CastRow = {
    id: string;
    name: string | null;
    display_name?: string | null;
    is_admin?: boolean | null;
  };
  const members = ((castRows ?? []) as CastRow[]).filter((c) => c.is_admin !== true);
  if (members.length === 0) return [];

  const { data: logRows, error: logErr } = await supabase
    .from("welfare_daily_logs")
    .select("cast_id, started_at")
    .eq("store_id", storeId)
    .eq("work_date", today)
    .not("started_at", "is", null);

  if (logErr) {
    throw new Error(`welfare_daily_logs fetch error: ${logErr.message}`);
  }

  const startedCastIds = new Set(
    ((logRows ?? []) as { cast_id: string }[]).map((r) => r.cast_id)
  );

  return members
    .filter((c) => !startedCastIds.has(c.id))
    .map((c) => (c.display_name?.trim() || c.name?.trim() || "名前未設定"));
}

export function buildUnstartedAlertMessage(names: string[]): string {
  const header =
    "【作業開始 未打刻アラート】\n" +
    "12:00 時点で、以下の方が「作業開始」を押していません。\n";

  const shown = names.slice(0, MAX_NAMES_IN_MESSAGE).map((n) => `・${n}`);
  const rest = names.length - shown.length;
  const body = rest > 0 ? [...shown, `・他${rest}名`].join("\n") : shown.join("\n");

  return `${header}${body}`;
}

/** 管理者全員へアラートを送る */
export async function sendUnstartedAlertToAdmins(
  supabase: SupabaseClient,
  storeId: string,
  names: string[],
  logPrefix: string
): Promise<UnstartedAlertSendResult> {
  const adminIds = await getAdminRecipientLineUserIds(supabase, storeId);
  if (adminIds.length === 0) {
    return { ok: false, reason: "no_admin_recipient" };
  }

  const token = await fetchResolvedLineChannelAccessTokenForStore(
    supabase,
    storeId,
    logPrefix
  );
  if (!token?.token) {
    return { ok: false, reason: "no_line_token" };
  }

  try {
    await sendMulticastMessage(adminIds, token.token, [
      { type: "text", text: buildUnstartedAlertMessage(names) },
    ]);
  } catch (sendErr) {
    return {
      ok: false,
      reason: "line_send",
      detail: sendErr instanceof Error ? sendErr.message : String(sendErr),
    };
  }

  return { ok: true, recipients: adminIds.length };
}
