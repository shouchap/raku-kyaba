import type { SupabaseClient } from "@supabase/supabase-js";
import { sendMulticastMessage } from "@/lib/line-reply";
import { fetchResolvedLineChannelAccessTokenForStore } from "@/lib/line-channel-token";
import { getAdminRecipientLineUserIds } from "@/lib/line-admin-recipients";

/**
 * B型事業所（welfare_b）の「作業開始 未打刻アラート」共通処理。
 *
 * 12:00 の midday cron（/api/welfare/cron?segment=midday）から自動実行する。
 * 単独エンドポイント（/api/welfare/warn-unstarted）と設定画面のテスト送信でも同じ判定・文面を使う。
 */

/** メッセージに列挙する最大人数（LINE 文字数対策） */
const MAX_NAMES_IN_MESSAGE = 20;

/** 同日中の重複送信を抑止する system_settings のキー */
export const WELFARE_UNSTARTED_WARN_STATE_KEY = "welfare_unstarted_warn_state";

export type UnstartedAlertSendResult =
  | { ok: true; recipients: number }
  | { ok: false; reason: "no_admin_recipient" | "no_line_token" | "line_send"; detail?: string };

export type UnstartedAlertStoreResult = {
  storeId: string;
  unstartedCount: number;
  notified: boolean;
  skipped?: string;
  error?: string;
  names?: string[];
};

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
    .map((c) => c.display_name?.trim() || c.name?.trim() || "名前未設定");
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

async function getLastWarnedDate(
  supabase: SupabaseClient,
  storeId: string
): Promise<string | null> {
  const { data } = await supabase
    .from("system_settings")
    .select("value")
    .eq("store_id", storeId)
    .eq("key", WELFARE_UNSTARTED_WARN_STATE_KEY)
    .maybeSingle();

  const value = (data?.value ?? {}) as Record<string, unknown>;
  const last = value.last_warned_date;
  return typeof last === "string" && last.trim() !== "" ? last : null;
}

async function setLastWarnedDate(
  supabase: SupabaseClient,
  storeId: string,
  date: string,
  logPrefix: string
): Promise<void> {
  const { error } = await supabase.from("system_settings").upsert(
    {
      store_id: storeId,
      key: WELFARE_UNSTARTED_WARN_STATE_KEY,
      value: { last_warned_date: date },
    },
    { onConflict: "store_id,key" }
  );

  if (error) {
    console.warn(
      `${logPrefix} storeId=${storeId} 送信記録の保存に失敗: ${error.message}`
    );
  }
}

/**
 * 1店舗分の未打刻アラートを判定・送信する。
 * midday cron / 単独エンドポイントの両方から呼ぶ。
 */
export async function runWelfareUnstartedAlertForStore(
  supabase: SupabaseClient,
  storeId: string,
  today: string,
  options: { force?: boolean; logPrefix?: string } = {}
): Promise<UnstartedAlertStoreResult> {
  const force = options.force === true;
  const logPrefix = options.logPrefix ?? "[WelfareUnstartedAlert]";

  if (!force && (await getLastWarnedDate(supabase, storeId)) === today) {
    return { storeId, unstartedCount: 0, notified: false, skipped: "already_warned_today" };
  }

  const names = await fetchUnstartedCastNames(supabase, storeId, today);
  if (names.length === 0) {
    return { storeId, unstartedCount: 0, notified: false, skipped: "all_started" };
  }

  const sent = await sendUnstartedAlertToAdmins(supabase, storeId, names, logPrefix);
  if (!sent.ok) {
    const error = sent.detail ? `${sent.reason}: ${sent.detail}` : sent.reason;
    console.error(
      `${logPrefix} storeId=${storeId} 送信できませんでした error=${error}`
    );
    return {
      storeId,
      unstartedCount: names.length,
      notified: false,
      error,
      names,
    };
  }

  await setLastWarnedDate(supabase, storeId, today, logPrefix);
  console.info(
    `${logPrefix} storeId=${storeId} notified unstarted=${names.length} recipients=${sent.recipients}`
  );
  return {
    storeId,
    unstartedCount: names.length,
    notified: true,
    names,
  };
}
