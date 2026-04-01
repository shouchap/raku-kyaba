/**
 * 就労継続支援B型（welfare_b）専用 LINE Webhook 処理
 * line-webhook-attendance.ts とは独立（インポートしない）
 */
import { sendReply, type LineReplyMessage } from "@/lib/line-reply";
import { createSupabaseClient } from "@/lib/supabase";
import { getTodayJst } from "@/lib/date-utils";
import {
  buildWelfareEveningEndFlexMessage,
  buildWelfareMiddayHealthFlexMessage,
  buildWelfareMorningStartFlexMessage,
  buildWelfareWorkItemSelectFlexMessage,
} from "@/lib/welfare-line-flex";
import type { LineMessageEvent, LinePostbackEvent } from "@/types/line-webhook";

const ERROR_REPLY = "申し訳ございません。エラーが発生しました。しばらく経ってから再度お試しください。";
const CAST_NOT_FOUND_REPLY =
  "登録情報が見つかりません。管理者に連絡するか、友だち追加からやり直してください。";

/** welfare_daily_logs.pending_line_flow と整合 */
export const WELFARE_PENDING_HEALTH_REASON = "welfare_health_reason" as const;
export const WELFARE_PENDING_WORK_ITEM = "welfare_work_item" as const;

export type WelfareStoreContext = { id: string; business_type: string };

type WelfareAction =
  | { kind: "start_work" }
  | { kind: "health_good" }
  | { kind: "health_soso" }
  | { kind: "health_bad" }
  | { kind: "end_work" }
  | { kind: "work_item"; item: string };

export function parseWelfarePostbackData(raw: string): WelfareAction | null {
  const s = String(raw ?? "").trim();
  if (!s.includes("welfare_action=")) return null;
  const sp = new URLSearchParams(s);
  const action = sp.get("welfare_action");
  if (!action) return null;
  if (action === "start_work") return { kind: "start_work" };
  if (action === "health_good") return { kind: "health_good" };
  if (action === "health_soso") return { kind: "health_soso" };
  if (action === "health_bad") return { kind: "health_bad" };
  if (action === "end_work") return { kind: "end_work" };
  if (action === "work_item") {
    const item = sp.get("item")?.trim();
    if (!item) return null;
    return { kind: "work_item", item };
  }
  return null;
}

async function getCastForWelfare(
  supabase: ReturnType<typeof createSupabaseClient>,
  storeId: string,
  lineUserId: string
): Promise<{ id: string } | null> {
  const { data } = await supabase
    .from("casts")
    .select("id")
    .eq("store_id", storeId)
    .eq("line_user_id", lineUserId)
    .eq("is_active", true)
    .maybeSingle();
  return data?.id ? { id: data.id } : null;
}

async function getOrCreateWelfareDailyLog(
  supabase: ReturnType<typeof createSupabaseClient>,
  storeId: string,
  castId: string,
  workDate: string
): Promise<{ id: string } | null> {
  const { data: existing } = await supabase
    .from("welfare_daily_logs")
    .select("id")
    .eq("cast_id", castId)
    .eq("work_date", workDate)
    .maybeSingle();
  if (existing?.id) return { id: existing.id };

  const { data: inserted, error } = await supabase
    .from("welfare_daily_logs")
    .insert({ store_id: storeId, cast_id: castId, work_date: workDate })
    .select("id")
    .single();

  if (error) {
    console.error("[Welfare] welfare_daily_logs insert:", error);
    return null;
  }
  return inserted?.id ? { id: inserted.id as string } : null;
}

async function safeReply(
  replyToken: string | undefined,
  channelAccessToken: string | undefined,
  messages: LineReplyMessage[]
): Promise<void> {
  if (!replyToken?.trim() || !channelAccessToken?.trim()) return;
  await sendReply(replyToken, channelAccessToken, messages);
}

/**
 * 体調「不調」後の自由記述（pending welfare_health_reason）
 */
export async function tryHandleWelfareHealthReasonText(
  lineUserId: string,
  rawText: string,
  supabase: ReturnType<typeof createSupabaseClient>,
  storeId: string,
  replyToken: string | undefined,
  channelAccessToken: string | undefined
): Promise<boolean> {
  const t = String(rawText ?? "").trim();
  if (!t) return false;

  const cast = await getCastForWelfare(supabase, storeId, lineUserId);
  if (!cast) return false;

  const todayJst = getTodayJst();
  const { data: row } = await supabase
    .from("welfare_daily_logs")
    .select("id, pending_line_flow")
    .eq("cast_id", cast.id)
    .eq("work_date", todayJst)
    .maybeSingle();

  if (row?.pending_line_flow !== WELFARE_PENDING_HEALTH_REASON) return false;

  const excerpt = t.length > 2000 ? `${t.slice(0, 2000)}…` : t;
  const nowIso = new Date().toISOString();
  const { error } = await supabase
    .from("welfare_daily_logs")
    .update({
      health_reason: excerpt,
      pending_line_flow: null,
      updated_at: nowIso,
    })
    .eq("id", row.id);

  if (error) {
    console.error("[Welfare] health_reason update:", error);
    await safeReply(replyToken, channelAccessToken, [{ type: "text", text: ERROR_REPLY }]);
    return true;
  }

  await safeReply(replyToken, channelAccessToken, [
    { type: "text", text: "内容を記録しました。無理せず、体調に気をつけてください。" },
  ]);
  return true;
}

async function handleWelfarePostback(
  lineUserId: string,
  rawData: string,
  store: WelfareStoreContext,
  supabase: ReturnType<typeof createSupabaseClient>,
  replyToken: string | undefined,
  channelAccessToken: string | undefined
): Promise<void> {
  const action = parseWelfarePostbackData(rawData);
  if (!action) {
    console.warn("[Welfare] 未対応 postback:", rawData);
    return;
  }

  const cast = await getCastForWelfare(supabase, store.id, lineUserId);
  if (!cast) {
    await safeReply(replyToken, channelAccessToken, [{ type: "text", text: CAST_NOT_FOUND_REPLY }]);
    return;
  }

  const todayJst = getTodayJst();
  const nowIso = new Date().toISOString();
  const log = await getOrCreateWelfareDailyLog(supabase, store.id, cast.id, todayJst);
  if (!log) {
    await safeReply(replyToken, channelAccessToken, [{ type: "text", text: ERROR_REPLY }]);
    return;
  }

  if (action.kind === "start_work") {
    const { error } = await supabase
      .from("welfare_daily_logs")
      .update({
        started_at: nowIso,
        pending_line_flow: null,
        updated_at: nowIso,
      })
      .eq("id", log.id);
    if (error) {
      console.error("[Welfare] start_work:", error);
      await safeReply(replyToken, channelAccessToken, [{ type: "text", text: ERROR_REPLY }]);
      return;
    }
    await safeReply(replyToken, channelAccessToken, [
      { type: "text", text: "作業開始を記録しました。今日も1日よろしくお願いします！" },
    ]);
    return;
  }

  if (action.kind === "health_good" || action.kind === "health_soso" || action.kind === "health_bad") {
    const status = action.kind === "health_good" ? "good" : action.kind === "health_soso" ? "soso" : "bad";
    if (status === "bad") {
      const { error } = await supabase
        .from("welfare_daily_logs")
        .update({
          health_status: "bad",
          pending_line_flow: WELFARE_PENDING_HEALTH_REASON,
          updated_at: nowIso,
        })
        .eq("id", log.id);
      if (error) {
        console.error("[Welfare] health_bad:", error);
        await safeReply(replyToken, channelAccessToken, [{ type: "text", text: ERROR_REPLY }]);
        return;
      }
      await safeReply(replyToken, channelAccessToken, [
        {
          type: "text",
          text: "どうしましたか？無理せず、テキストで理由を教えてください。",
        },
      ]);
      return;
    }

    const { error } = await supabase
      .from("welfare_daily_logs")
      .update({
        health_status: status,
        pending_line_flow: null,
        updated_at: nowIso,
      })
      .eq("id", log.id);
    if (error) {
      console.error("[Welfare] health update:", error);
      await safeReply(replyToken, channelAccessToken, [{ type: "text", text: ERROR_REPLY }]);
      return;
    }
    await safeReply(replyToken, channelAccessToken, [
      { type: "text", text: "ありがとうございます。引き続きよろしくお願いします！" },
    ]);
    return;
  }

  if (action.kind === "end_work") {
    const { error } = await supabase
      .from("welfare_daily_logs")
      .update({
        pending_line_flow: WELFARE_PENDING_WORK_ITEM,
        updated_at: nowIso,
      })
      .eq("id", log.id);
    if (error) {
      console.error("[Welfare] end_work:", error);
      await safeReply(replyToken, channelAccessToken, [{ type: "text", text: ERROR_REPLY }]);
      return;
    }
    await safeReply(replyToken, channelAccessToken, [buildWelfareWorkItemSelectFlexMessage()]);
    return;
  }

  if (action.kind === "work_item") {
    const { data: current } = await supabase
      .from("welfare_daily_logs")
      .select("pending_line_flow")
      .eq("id", log.id)
      .maybeSingle();
    if (current?.pending_line_flow !== WELFARE_PENDING_WORK_ITEM) {
      await safeReply(replyToken, channelAccessToken, [
        { type: "text", text: "先に「作業を終了する」から手続きしてください。" },
      ]);
      return;
    }

    const { error } = await supabase
      .from("welfare_daily_logs")
      .update({
        work_item: action.item,
        ended_at: nowIso,
        pending_line_flow: null,
        updated_at: nowIso,
      })
      .eq("id", log.id);
    if (error) {
      console.error("[Welfare] work_item:", error);
      await safeReply(replyToken, channelAccessToken, [{ type: "text", text: ERROR_REPLY }]);
      return;
    }
    await safeReply(replyToken, channelAccessToken, [
      { type: "text", text: `作業項目「${action.item}」で終了を記録しました。お疲れ様でした！` },
    ]);
  }
}

/**
 * welfare_b 店舗の Webhook イベントを処理（follow / unfollow は呼び出し側でキャバクラ流を利用）
 */
export async function handleWelfareWebhook(
  event: { type: string; source?: { userId?: string }; replyToken?: string },
  store: WelfareStoreContext,
  supabase: ReturnType<typeof createSupabaseClient>,
  channelAccessToken?: string
): Promise<void> {
  const userId = event.source?.userId;
  if (!userId) return;

  const replyToken = event.replyToken;

  switch (event.type) {
    case "postback": {
      const pe = event as LinePostbackEvent;
      await handleWelfarePostback(
        userId,
        pe.postback?.data ?? "",
        store,
        supabase,
        replyToken,
        channelAccessToken
      );
      break;
    }
    case "message": {
      const me = event as LineMessageEvent;
      if (me.message?.type === "text") {
        await tryHandleWelfareHealthReasonText(
          userId,
          me.message.text ?? "",
          supabase,
          store.id,
          replyToken,
          channelAccessToken
        );
      }
      break;
    }
    default:
      console.log("[Welfare] 未処理イベント:", event.type);
  }
}
