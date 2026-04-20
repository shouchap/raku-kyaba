/**
 * 就労継続支援B型（welfare_b）専用 LINE Webhook 処理
 * line-webhook-attendance.ts とは独立（インポートしない）
 */
import { sendReply, type LineReplyMessage } from "@/lib/line-reply";
import { createSupabaseClient } from "@/lib/supabase";
import { getTodayJst } from "@/lib/date-utils";
import {
  buildWelfareEndWorkChoiceFlexMessage,
  buildWelfareEveningEndFlexMessage,
  buildWelfareHospitalDurationQuickReplyMessage,
  buildWelfareHospitalNameQuestionMessage,
  buildWelfareMiddayHealthFlexMessage,
  buildWelfareMorningStartFlexMessage,
  buildWelfareWorkItemSelectFlexMessage,
} from "@/lib/welfare-line-flex";
import type { LineMessageEvent, LinePostbackEvent } from "@/types/line-webhook";

const ERROR_REPLY = "申し訳ございません。エラーが発生しました。しばらく経ってから再度お試しください。";
const CAST_NOT_FOUND_REPLY =
  "登録情報が見つかりません。管理者に連絡するか、友だち追加からやり直してください。";

const START_WORK_REPLY =
  "作業開始を記録しました。\n\n今日も1日よろしくお願いいたします！";

function healthConditionWord(status: "good" | "soso" | "bad"): string {
  if (status === "good") return "良好";
  if (status === "soso") return "やや不調";
  return "不調";
}

/** 体調 good / soso / bad 記録後の共通フォーマット */
function healthRecordedReplyText(status: "good" | "soso" | "bad"): string {
  return `体調「${healthConditionWord(status)}」を記録しました。\n\n引き続き、無理のない範囲で作業をお願いいたします。`;
}

/** welfare_daily_logs.pending_line_flow と整合 */
export const WELFARE_PENDING_HEALTH_REASON = "welfare_health_reason" as const;
export const WELFARE_PENDING_WORK_ITEM = "welfare_work_item" as const;
export const WELFARE_PENDING_END_CHOICE = "welfare_end_choice" as const;
export const WELFARE_PENDING_HOSPITAL_NAME = "welfare_hospital_name" as const;
export const WELFARE_PENDING_HOSPITAL_SYMPTOMS = "welfare_hospital_symptoms" as const;
export const WELFARE_PENDING_HOSPITAL_DURATION = "welfare_hospital_duration" as const;

export type WelfareStoreContext = { id: string; business_type: string };

type WelfareAction =
  | { kind: "start_work" }
  | { kind: "health_good" }
  | { kind: "health_soso" }
  | { kind: "health_bad" }
  | { kind: "health_contact" }
  | { kind: "end_work" }
  | { kind: "end_work_normal" }
  | { kind: "end_work_hospital" }
  | { kind: "hospital_name_default" }
  | { kind: "hospital_name_other" }
  | { kind: "hospital_duration"; slot: "under1" | "between1_2" | "between2_3" | "halfday" | "other" }
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
  if (action === "health_contact") return { kind: "health_contact" };
  if (action === "end_work") return { kind: "end_work" };
  if (action === "end_work_normal") return { kind: "end_work_normal" };
  if (action === "end_work_hospital") return { kind: "end_work_hospital" };
  if (action === "hospital_name_default") return { kind: "hospital_name_default" };
  if (action === "hospital_name_other") return { kind: "hospital_name_other" };
  if (action === "hospital_duration") {
    const slot = sp.get("slot")?.trim();
    if (
      slot === "under1" ||
      slot === "between1_2" ||
      slot === "between2_3" ||
      slot === "halfday" ||
      slot === "other"
    ) {
      return { kind: "hospital_duration", slot };
    }
    return null;
  }
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
): Promise<{ id: string; default_hospital_name: string | null } | null> {
  const { data } = await supabase
    .from("casts")
    .select("id, default_hospital_name")
    .eq("store_id", storeId)
    .eq("line_user_id", lineUserId)
    .eq("is_active", true)
    .maybeSingle();
  if (!data?.id) return null;
  const raw = (data as { id: string; default_hospital_name?: string | null }).default_hospital_name;
  return {
    id: data.id,
    default_hospital_name: typeof raw === "string" && raw.trim() ? raw.trim() : null,
  };
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

function blockedEveningEndMessage(p: string | null): string | null {
  if (p === WELFARE_PENDING_WORK_ITEM) return "作業項目をボタンから選んでください。";
  if (p === WELFARE_PENDING_HEALTH_REASON) return "体調についてのご記入を先に完了してください。";
  if (
    p === WELFARE_PENDING_HOSPITAL_NAME ||
    p === WELFARE_PENDING_HOSPITAL_SYMPTOMS ||
    p === WELFARE_PENDING_HOSPITAL_DURATION
  ) {
    return "通院報告の入力を続けてください。";
  }
  return null;
}

function canUseDirectEndWorkChoice(p: string | null): boolean {
  return p === null || p === WELFARE_PENDING_END_CHOICE;
}

const HOSPITAL_DURATION_DETAIL_PROMPT = "通院時間の詳細を教えてください";

const HOSPITAL_DURATION_LABEL: Record<
  "under1" | "between1_2" | "between2_3" | "halfday",
  string
> = {
  under1: "1時間未満",
  between1_2: "1〜2時間",
  between2_3: "2〜3時間",
  halfday: "半日（3時間以上）",
};

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
    { type: "text", text: healthRecordedReplyText("bad") },
  ]);
  return true;
}

/**
 * 作業項目確定後の日誌（個数・内容）自由記述
 * 条件: 本日ログがあり ended_at と work_item があり、work_details が未入力
 */
export async function tryHandleWelfareWorkJournalText(
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
    .select("id, ended_at, work_item, work_details, pending_line_flow, is_hospital_visit")
    .eq("cast_id", cast.id)
    .eq("work_date", todayJst)
    .maybeSingle();

  if (!row?.id) return false;
  if (row.is_hospital_visit === true) return false;
  if (row.pending_line_flow === WELFARE_PENDING_HEALTH_REASON) return false;
  if (!row.ended_at) return false;
  const wi = typeof row.work_item === "string" ? row.work_item.trim() : "";
  if (!wi) return false;
  const wd = row.work_details;
  if (wd !== null && String(wd).trim() !== "") return false;

  const excerpt = t.length > 2000 ? `${t.slice(0, 2000)}…` : t;
  const nowIso = new Date().toISOString();
  const { error } = await supabase
    .from("welfare_daily_logs")
    .update({
      work_details: excerpt,
      pending_line_flow: null,
      updated_at: nowIso,
    })
    .eq("id", row.id);

  if (error) {
    console.error("[Welfare] work_details update:", error);
    await safeReply(replyToken, channelAccessToken, [{ type: "text", text: ERROR_REPLY }]);
    return true;
  }

  /** 成功時は返信せず既読のみ（フロー完了） */
  return true;
}

const HOSPITAL_EMPTY_REPLY = "内容を入力してください。";
const HOSPITAL_Q2 = "症状や診察内容を教えてください";
const HOSPITAL_DONE =
  "通院報告を記録して作業を終了しました。お疲れ様でした。";

/**
 * 通院報告 3 問（pending: hospital_name → symptoms → duration）
 */
export async function tryHandleWelfareHospitalFlowText(
  lineUserId: string,
  rawText: string,
  supabase: ReturnType<typeof createSupabaseClient>,
  storeId: string,
  replyToken: string | undefined,
  channelAccessToken: string | undefined
): Promise<boolean> {
  const cast = await getCastForWelfare(supabase, storeId, lineUserId);
  if (!cast) return false;

  const todayJst = getTodayJst();
  const { data: row } = await supabase
    .from("welfare_daily_logs")
    .select("id, pending_line_flow")
    .eq("cast_id", cast.id)
    .eq("work_date", todayJst)
    .maybeSingle();

  const flow = row?.pending_line_flow ?? null;
  if (
    flow !== WELFARE_PENDING_HOSPITAL_NAME &&
    flow !== WELFARE_PENDING_HOSPITAL_SYMPTOMS &&
    flow !== WELFARE_PENDING_HOSPITAL_DURATION
  ) {
    return false;
  }

  const t = String(rawText ?? "").trim();
  if (!t) {
    await safeReply(replyToken, channelAccessToken, [{ type: "text", text: HOSPITAL_EMPTY_REPLY }]);
    return true;
  }

  const excerpt = t.length > 2000 ? `${t.slice(0, 2000)}…` : t;
  const nowIso = new Date().toISOString();

  if (flow === WELFARE_PENDING_HOSPITAL_NAME) {
    const { error } = await supabase
      .from("welfare_daily_logs")
      .update({
        hospital_name: excerpt,
        pending_line_flow: WELFARE_PENDING_HOSPITAL_SYMPTOMS,
        updated_at: nowIso,
      })
      .eq("id", row!.id);
    if (error) {
      console.error("[Welfare] hospital_name update:", error);
      await safeReply(replyToken, channelAccessToken, [{ type: "text", text: ERROR_REPLY }]);
      return true;
    }
    await safeReply(replyToken, channelAccessToken, [{ type: "text", text: HOSPITAL_Q2 }]);
    return true;
  }

  if (flow === WELFARE_PENDING_HOSPITAL_SYMPTOMS) {
    const { error } = await supabase
      .from("welfare_daily_logs")
      .update({
        symptoms: excerpt,
        pending_line_flow: WELFARE_PENDING_HOSPITAL_DURATION,
        updated_at: nowIso,
      })
      .eq("id", row!.id);
    if (error) {
      console.error("[Welfare] symptoms update:", error);
      await safeReply(replyToken, channelAccessToken, [{ type: "text", text: ERROR_REPLY }]);
      return true;
    }
    await safeReply(replyToken, channelAccessToken, [buildWelfareHospitalDurationQuickReplyMessage()]);
    return true;
  }

  const { error } = await supabase
    .from("welfare_daily_logs")
    .update({
      visit_duration: excerpt,
      is_hospital_visit: true,
      ended_at: nowIso,
      pending_line_flow: null,
      updated_at: nowIso,
    })
    .eq("id", row!.id);

  if (error) {
    console.error("[Welfare] hospital visit_duration / complete:", error);
    await safeReply(replyToken, channelAccessToken, [{ type: "text", text: ERROR_REPLY }]);
    return true;
  }

  await safeReply(replyToken, channelAccessToken, [{ type: "text", text: HOSPITAL_DONE }]);
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
    await safeReply(replyToken, channelAccessToken, [{ type: "text", text: START_WORK_REPLY }]);
    return;
  }

  if (
    action.kind === "health_good" ||
    action.kind === "health_soso" ||
    action.kind === "health_bad" ||
    action.kind === "health_contact"
  ) {
    if (action.kind === "health_contact") {
      const { error } = await supabase
        .from("welfare_daily_logs")
        .update({
          health_status: "contact",
          pending_line_flow: null,
          updated_at: nowIso,
        })
        .eq("id", log.id);
      if (error) {
        console.error("[Welfare] health_contact:", error);
        await safeReply(replyToken, channelAccessToken, [{ type: "text", text: ERROR_REPLY }]);
        return;
      }
      await safeReply(replyToken, channelAccessToken, [
        {
          type: "text",
          text: "担当者に連絡が必要な旨を記録しました。担当より連絡します。",
        },
      ]);
      return;
    }

    const status: "good" | "soso" | "bad" =
      action.kind === "health_good" ? "good" : action.kind === "health_soso" ? "soso" : "bad";
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
      { type: "text", text: healthRecordedReplyText(status) },
    ]);
    return;
  }

  if (action.kind === "end_work") {
    const { data: curFlow } = await supabase
      .from("welfare_daily_logs")
      .select("pending_line_flow")
      .eq("id", log.id)
      .maybeSingle();
    const p = curFlow?.pending_line_flow ?? null;

    if (p === WELFARE_PENDING_WORK_ITEM) {
      await safeReply(replyToken, channelAccessToken, [
        { type: "text", text: "作業項目をボタンから選んでください。" },
      ]);
      return;
    }
    if (p === WELFARE_PENDING_HEALTH_REASON) {
      await safeReply(replyToken, channelAccessToken, [
        { type: "text", text: "体調についてのご記入を先に完了してください。" },
      ]);
      return;
    }
    if (p === WELFARE_PENDING_END_CHOICE) {
      await safeReply(replyToken, channelAccessToken, [buildWelfareEndWorkChoiceFlexMessage()]);
      return;
    }
    if (
      p === WELFARE_PENDING_HOSPITAL_NAME ||
      p === WELFARE_PENDING_HOSPITAL_SYMPTOMS ||
      p === WELFARE_PENDING_HOSPITAL_DURATION
    ) {
      await safeReply(replyToken, channelAccessToken, [
        { type: "text", text: "通院報告の入力を続けてください。" },
      ]);
      return;
    }

    const { error } = await supabase
      .from("welfare_daily_logs")
      .update({
        pending_line_flow: WELFARE_PENDING_END_CHOICE,
        updated_at: nowIso,
      })
      .eq("id", log.id);
    if (error) {
      console.error("[Welfare] end_work:", error);
      await safeReply(replyToken, channelAccessToken, [{ type: "text", text: ERROR_REPLY }]);
      return;
    }
    await safeReply(replyToken, channelAccessToken, [buildWelfareEndWorkChoiceFlexMessage()]);
    return;
  }

  if (action.kind === "end_work_normal") {
    const { data: cur } = await supabase
      .from("welfare_daily_logs")
      .select("pending_line_flow")
      .eq("id", log.id)
      .maybeSingle();
    const p = cur?.pending_line_flow ?? null;
    const blocked = blockedEveningEndMessage(p);
    if (blocked) {
      await safeReply(replyToken, channelAccessToken, [{ type: "text", text: blocked }]);
      return;
    }
    if (!canUseDirectEndWorkChoice(p)) {
      await safeReply(replyToken, channelAccessToken, [
        { type: "text", text: "この操作は現在できません。" },
      ]);
      return;
    }
    const { error } = await supabase
      .from("welfare_daily_logs")
      .update({
        pending_line_flow: WELFARE_PENDING_WORK_ITEM,
        is_hospital_visit: false,
        hospital_name: null,
        symptoms: null,
        visit_duration: null,
        updated_at: nowIso,
      })
      .eq("id", log.id);
    if (error) {
      console.error("[Welfare] end_work_normal:", error);
      await safeReply(replyToken, channelAccessToken, [{ type: "text", text: ERROR_REPLY }]);
      return;
    }
    const { data: storeRow } = await supabase
      .from("stores")
      .select("welfare_work_items")
      .eq("id", store.id)
      .maybeSingle();
    const csv =
      storeRow && typeof (storeRow as { welfare_work_items?: unknown }).welfare_work_items === "string"
        ? (storeRow as { welfare_work_items: string }).welfare_work_items
        : null;
    await safeReply(replyToken, channelAccessToken, [buildWelfareWorkItemSelectFlexMessage(csv)]);
    return;
  }

  if (action.kind === "end_work_hospital") {
    const { data: cur } = await supabase
      .from("welfare_daily_logs")
      .select("pending_line_flow")
      .eq("id", log.id)
      .maybeSingle();
    const p = cur?.pending_line_flow ?? null;
    const blocked = blockedEveningEndMessage(p);
    if (blocked) {
      await safeReply(replyToken, channelAccessToken, [{ type: "text", text: blocked }]);
      return;
    }
    if (!canUseDirectEndWorkChoice(p)) {
      await safeReply(replyToken, channelAccessToken, [
        { type: "text", text: "この操作は現在できません。" },
      ]);
      return;
    }
    const { error } = await supabase
      .from("welfare_daily_logs")
      .update({
        pending_line_flow: WELFARE_PENDING_HOSPITAL_NAME,
        is_hospital_visit: false,
        hospital_name: null,
        symptoms: null,
        visit_duration: null,
        updated_at: nowIso,
      })
      .eq("id", log.id);
    if (error) {
      console.error("[Welfare] end_work_hospital:", error);
      await safeReply(replyToken, channelAccessToken, [{ type: "text", text: ERROR_REPLY }]);
      return;
    }
    await safeReply(replyToken, channelAccessToken, [
      buildWelfareHospitalNameQuestionMessage(cast.default_hospital_name),
    ]);
    return;
  }

  if (action.kind === "hospital_name_default") {
    const { data: cur } = await supabase
      .from("welfare_daily_logs")
      .select("pending_line_flow")
      .eq("id", log.id)
      .maybeSingle();
    if (cur?.pending_line_flow !== WELFARE_PENDING_HOSPITAL_NAME) {
      await safeReply(replyToken, channelAccessToken, [
        { type: "text", text: "病院名の質問から操作してください。" },
      ]);
      return;
    }
    const def = cast.default_hospital_name?.trim();
    if (!def) {
      await safeReply(replyToken, channelAccessToken, [
        {
          type: "text",
          text: "かかりつけ病院が未登録です。病院名をテキストで入力してください。",
        },
      ]);
      return;
    }
    const excerpt = def.length > 2000 ? `${def.slice(0, 2000)}…` : def;
    const { error } = await supabase
      .from("welfare_daily_logs")
      .update({
        hospital_name: excerpt,
        pending_line_flow: WELFARE_PENDING_HOSPITAL_SYMPTOMS,
        updated_at: nowIso,
      })
      .eq("id", log.id);
    if (error) {
      console.error("[Welfare] hospital_name_default:", error);
      await safeReply(replyToken, channelAccessToken, [{ type: "text", text: ERROR_REPLY }]);
      return;
    }
    await safeReply(replyToken, channelAccessToken, [{ type: "text", text: HOSPITAL_Q2 }]);
    return;
  }

  if (action.kind === "hospital_name_other") {
    const { data: cur } = await supabase
      .from("welfare_daily_logs")
      .select("pending_line_flow")
      .eq("id", log.id)
      .maybeSingle();
    if (cur?.pending_line_flow !== WELFARE_PENDING_HOSPITAL_NAME) {
      await safeReply(replyToken, channelAccessToken, [
        { type: "text", text: "病院名の質問から操作してください。" },
      ]);
      return;
    }
    await safeReply(replyToken, channelAccessToken, [
      { type: "text", text: "病院名を入力してください" },
    ]);
    return;
  }

  if (action.kind === "hospital_duration") {
    const { data: cur } = await supabase
      .from("welfare_daily_logs")
      .select("pending_line_flow")
      .eq("id", log.id)
      .maybeSingle();
    if (cur?.pending_line_flow !== WELFARE_PENDING_HOSPITAL_DURATION) {
      await safeReply(replyToken, channelAccessToken, [
        { type: "text", text: "先に症状の入力を完了してください。" },
      ]);
      return;
    }
    if (action.slot === "other") {
      await safeReply(replyToken, channelAccessToken, [
        { type: "text", text: HOSPITAL_DURATION_DETAIL_PROMPT },
      ]);
      return;
    }
    const label = HOSPITAL_DURATION_LABEL[action.slot];
    const { error } = await supabase
      .from("welfare_daily_logs")
      .update({
        visit_duration: label,
        is_hospital_visit: true,
        ended_at: nowIso,
        pending_line_flow: null,
        updated_at: nowIso,
      })
      .eq("id", log.id);
    if (error) {
      console.error("[Welfare] hospital_duration:", error);
      await safeReply(replyToken, channelAccessToken, [{ type: "text", text: ERROR_REPLY }]);
      return;
    }
    await safeReply(replyToken, channelAccessToken, [{ type: "text", text: HOSPITAL_DONE }]);
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
        {
          type: "text",
          text: "先に夕方のメニューから「通常の作業終了」を選び、作業項目を選択してください。",
        },
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
      {
        type: "text",
        text: `作業項目「${action.item}」を記録しました。\n\n続けて、本日の【作業個数】と【作業内容（日誌）】をこのメッセージに返信してください。\n\n（例：30個、集中して作業できました）`,
      },
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
        const text = me.message.text ?? "";
        const handledHealth = await tryHandleWelfareHealthReasonText(
          userId,
          text,
          supabase,
          store.id,
          replyToken,
          channelAccessToken
        );
        if (handledHealth) break;
        const handledHospital = await tryHandleWelfareHospitalFlowText(
          userId,
          text,
          supabase,
          store.id,
          replyToken,
          channelAccessToken
        );
        if (handledHospital) break;
        await tryHandleWelfareWorkJournalText(
          userId,
          text,
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
