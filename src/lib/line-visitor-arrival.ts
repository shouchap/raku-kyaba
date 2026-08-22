/**
 * Club GOLD 等向け「来客」連絡フロー。
 *
 * リッチメニュー（postback: visitor_arrival）またはテキスト「来客」で開始し、
 * 顧客名・人数・時間をトークで確認したうえで、管理者へまとめて通知する。
 * 遅刻・欠勤理由の管理者通知と同じく、casts.is_admin の LINE ユーザーへ Push する。
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { sendMulticastMessage, sendReply, type LineReplyMessage } from "@/lib/line-reply";
import { getAdminRecipientLineUserIds } from "@/lib/line-admin-recipients";
import { getDefaultStoreIdOrNull } from "@/lib/current-store";
import { getTodayJst } from "@/lib/date-utils";

export const VISITOR_ARRIVAL_POSTBACK = "visitor_arrival";
export const VISITOR_ARRIVAL_TEXT = "来客";

const FLOW_NAME = "visitor_arrival_name";
const FLOW_COUNT = "visitor_arrival_count";
const FLOW_TIME = "visitor_arrival_time";

type VisitorDraft = {
  guestName?: string;
  peopleCount?: string;
  visitTime?: string;
};

type CastRow = {
  id: string;
  store_id: string;
  name: string | null;
  display_name?: string | null;
  line_pending_flow: string | null;
  line_pending_draft: VisitorDraft | null;
};

function castDisplayName(cast: Pick<CastRow, "name" | "display_name">): string {
  return (
    cast.display_name?.trim() ||
    cast.name?.trim() ||
    "キャスト"
  );
}

function isCancelText(text: string): boolean {
  const t = text.trim();
  return t === "キャンセル" || t === "取消" || t === "やめる" || t === "中止";
}

async function clearPending(
  supabase: SupabaseClient,
  castId: string
): Promise<void> {
  await supabase
    .from("casts")
    .update({ line_pending_flow: null, line_pending_draft: null })
    .eq("id", castId);
}

async function setPending(
  supabase: SupabaseClient,
  castId: string,
  flow: string,
  draft: VisitorDraft
): Promise<void> {
  await supabase
    .from("casts")
    .update({ line_pending_flow: flow, line_pending_draft: draft })
    .eq("id", castId);
}

async function loadCast(
  supabase: SupabaseClient,
  lineUserId: string
): Promise<CastRow | null> {
  const tenantStoreId = getDefaultStoreIdOrNull();
  if (!tenantStoreId) return null;

  const { data, error } = await supabase
    .from("casts")
    .select(
      "id, store_id, name, display_name, line_pending_flow, line_pending_draft"
    )
    .eq("line_user_id", lineUserId)
    .eq("store_id", tenantStoreId)
    .eq("is_active", true)
    .maybeSingle();

  if (error) {
    // カラム未適用時は来客フローを無効扱い（マイグレーション待ち）
    if (
      typeof error.message === "string" &&
      (error.message.includes("line_pending_flow") ||
        error.message.includes("line_pending_draft"))
    ) {
      console.warn(
        "[VisitorArrival] casts.line_pending_* 未適用。マイグレーション 060 を適用してください。"
      );
      return null;
    }
    console.error("[VisitorArrival] cast fetch:", error.message);
    return null;
  }

  if (!data?.id) return null;
  return data as CastRow;
}

function askNameMessage(): LineReplyMessage {
  return {
    type: "text",
    text:
      "来客の連絡ですね。\n" +
      "① 顧客名（または呼び名）を送ってください。\n" +
      "途中でやめる場合は「キャンセル」と送ってください。",
  };
}

function askCountMessage(): LineReplyMessage {
  const labels = ["1名", "2名", "3名", "4名", "5名", "6名", "7名以上"];
  return {
    type: "text",
    text: "② 人数を選ぶか、数字で送ってください。（例: 3）",
    quickReply: {
      items: labels.map((label) => ({
        type: "action" as const,
        action: {
          type: "message" as const,
          label,
          text: label,
        },
      })),
    },
  };
}

function askTimeMessage(): LineReplyMessage {
  return {
    type: "text",
    text:
      "③ 来客の時間を教えてください。\n" +
      "下のボタンか、「21:00」「今から」など自由に送れます。",
    quickReply: {
      items: [
        {
          type: "action",
          action: {
            type: "datetimepicker",
            label: "時刻を選ぶ",
            data: "visitor_arrival_time_pick",
            mode: "time",
          },
        },
        {
          type: "action",
          action: { type: "message", label: "今から", text: "今から" },
        },
        {
          type: "action",
          action: { type: "message", label: "30分後", text: "30分後" },
        },
        {
          type: "action",
          action: { type: "message", label: "1時間後", text: "1時間後" },
        },
      ],
    },
  };
}

function normalizePeopleCount(raw: string): string | null {
  const t = raw.trim().replace(/　/g, "");
  if (!t) return null;
  const m = t.match(/(\d+)\s*名?/);
  if (m) {
    const n = Number.parseInt(m[1]!, 10);
    if (Number.isFinite(n) && n > 0 && n < 200) {
      return t.includes("以上") || t.includes("〜") || t.includes("~")
        ? `${n}名以上`
        : `${n}名`;
    }
  }
  if (/^[0-9０-９]+$/.test(t)) {
    const n = Number.parseInt(
      t.replace(/[０-９]/g, (c) =>
        String.fromCharCode(c.charCodeAt(0) - 0xff10 + 0x30)
      ),
      10
    );
    if (Number.isFinite(n) && n > 0 && n < 200) return `${n}名`;
  }
  if (t.length <= 20) return t;
  return null;
}

function normalizeVisitTime(raw: string): string | null {
  const t = raw.trim();
  if (!t) return null;
  if (t.length > 40) return null;
  return t;
}

function buildAdminMessage(
  castName: string,
  draft: Required<Pick<VisitorDraft, "guestName" | "peopleCount" | "visitTime">>
): string {
  const today = getTodayJst();
  return (
    `🚪 【来客連絡】\n` +
    `日付: ${today}\n` +
    `キャスト: ${castName}さん\n` +
    `顧客名: ${draft.guestName}\n` +
    `人数: ${draft.peopleCount}\n` +
    `時間: ${draft.visitTime}\n\n` +
    `公式LINEのチャットから確認・返信をお願いします。`
  );
}

async function finishAndNotify(
  supabase: SupabaseClient,
  cast: CastRow,
  draft: Required<Pick<VisitorDraft, "guestName" | "peopleCount" | "visitTime">>,
  replyToken: string | undefined,
  channelAccessToken: string
): Promise<void> {
  await clearPending(supabase, cast.id);

  const castName = castDisplayName(cast);
  const adminMessage = buildAdminMessage(castName, draft);
  const adminIds = await getAdminRecipientLineUserIds(supabase, cast.store_id);

  if (adminIds.length > 0) {
    try {
      await sendMulticastMessage(adminIds, channelAccessToken, [
        { type: "text", text: adminMessage },
      ]);
    } catch (e) {
      console.error("[VisitorArrival] 管理者通知失敗:", e);
      if (replyToken) {
        await sendReply(replyToken, channelAccessToken, [
          {
            type: "text",
            text:
              "内容は受け取りましたが、管理者への通知に失敗しました。店舗スタッフへ直接ご連絡ください。",
          },
        ]);
      }
      return;
    }
  } else {
    console.warn(
      "[VisitorArrival] 管理者 LINE 未連携 store_id=",
      cast.store_id
    );
  }

  if (replyToken) {
    await sendReply(replyToken, channelAccessToken, [
      {
        type: "text",
        text:
          "管理者へ来客連絡を送りました。ありがとうございます！\n\n" +
          `・顧客名: ${draft.guestName}\n` +
          `・人数: ${draft.peopleCount}\n` +
          `・時間: ${draft.visitTime}`,
      },
    ]);
  }
}

/** リッチメニュー / 「来客」テキストからフロー開始 */
export async function startVisitorArrivalFlow(
  lineUserId: string,
  supabase: SupabaseClient,
  replyToken: string | undefined,
  channelAccessToken: string | undefined
): Promise<boolean> {
  if (!channelAccessToken?.trim() || !replyToken) return false;

  const cast = await loadCast(supabase, lineUserId);
  if (!cast) {
    await sendReply(replyToken, channelAccessToken, [
      {
        type: "text",
        text: "キャストが登録されていません。管理者にご連絡ください。",
      },
    ]);
    return true;
  }

  await setPending(supabase, cast.id, FLOW_NAME, {});
  await sendReply(replyToken, channelAccessToken, [askNameMessage()]);
  return true;
}

/** postback: visitor_arrival / visitor_arrival_time_pick */
export async function tryHandleVisitorArrivalPostback(
  lineUserId: string,
  rawData: string,
  postbackParams: { time?: string; datetime?: string; date?: string } | undefined,
  supabase: SupabaseClient,
  replyToken: string | undefined,
  channelAccessToken: string | undefined
): Promise<boolean> {
  const data = String(rawData ?? "").trim();
  if (!channelAccessToken?.trim()) return false;

  if (data === VISITOR_ARRIVAL_POSTBACK) {
    return startVisitorArrivalFlow(
      lineUserId,
      supabase,
      replyToken,
      channelAccessToken
    );
  }

  if (data === "visitor_arrival_time_pick") {
    const cast = await loadCast(supabase, lineUserId);
    if (!cast || cast.line_pending_flow !== FLOW_TIME) return false;

    const picked =
      postbackParams?.time?.trim() ||
      postbackParams?.datetime?.trim() ||
      "";
    if (!picked) {
      if (replyToken) {
        await sendReply(replyToken, channelAccessToken, [askTimeMessage()]);
      }
      return true;
    }

    const draft: VisitorDraft = {
      ...(cast.line_pending_draft ?? {}),
      visitTime: picked,
    };
    if (!draft.guestName || !draft.peopleCount) {
      await setPending(supabase, cast.id, FLOW_NAME, {});
      if (replyToken) {
        await sendReply(replyToken, channelAccessToken, [askNameMessage()]);
      }
      return true;
    }

    await finishAndNotify(
      supabase,
      cast,
      {
        guestName: draft.guestName,
        peopleCount: draft.peopleCount,
        visitTime: draft.visitTime!,
      },
      replyToken,
      channelAccessToken
    );
    return true;
  }

  return false;
}

/**
 * 進行中の来客フローへのテキスト回答、または「来客」開始コマンド。
 * @returns true なら他のテキスト処理をスキップ
 */
export async function tryHandleVisitorArrivalText(
  lineUserId: string,
  rawText: string,
  supabase: SupabaseClient,
  replyToken: string | undefined,
  channelAccessToken: string | undefined
): Promise<boolean> {
  const text = String(rawText ?? "").trim();
  if (!text || !channelAccessToken?.trim()) return false;

  if (text === VISITOR_ARRIVAL_TEXT) {
    return startVisitorArrivalFlow(
      lineUserId,
      supabase,
      replyToken,
      channelAccessToken
    );
  }

  const cast = await loadCast(supabase, lineUserId);
  if (!cast?.line_pending_flow?.startsWith("visitor_arrival_")) return false;

  if (isCancelText(text)) {
    await clearPending(supabase, cast.id);
    if (replyToken) {
      await sendReply(replyToken, channelAccessToken, [
        { type: "text", text: "来客連絡をキャンセルしました。" },
      ]);
    }
    return true;
  }

  const draft: VisitorDraft = { ...(cast.line_pending_draft ?? {}) };

  if (cast.line_pending_flow === FLOW_NAME) {
    if (text.length > 80) {
      if (replyToken) {
        await sendReply(replyToken, channelAccessToken, [
          {
            type: "text",
            text: "顧客名が長すぎます。80文字以内で送ってください。",
          },
        ]);
      }
      return true;
    }
    draft.guestName = text;
    await setPending(supabase, cast.id, FLOW_COUNT, draft);
    if (replyToken) {
      await sendReply(replyToken, channelAccessToken, [askCountMessage()]);
    }
    return true;
  }

  if (cast.line_pending_flow === FLOW_COUNT) {
    const people = normalizePeopleCount(text);
    if (!people) {
      if (replyToken) {
        await sendReply(replyToken, channelAccessToken, [
          {
            type: "text",
            text: "人数が分かりませんでした。例: 2名 / 3",
          },
          askCountMessage(),
        ]);
      }
      return true;
    }
    draft.peopleCount = people;
    await setPending(supabase, cast.id, FLOW_TIME, draft);
    if (replyToken) {
      await sendReply(replyToken, channelAccessToken, [askTimeMessage()]);
    }
    return true;
  }

  if (cast.line_pending_flow === FLOW_TIME) {
    const visitTime = normalizeVisitTime(text);
    if (!visitTime) {
      if (replyToken) {
        await sendReply(replyToken, channelAccessToken, [askTimeMessage()]);
      }
      return true;
    }
    if (!draft.guestName || !draft.peopleCount) {
      await setPending(supabase, cast.id, FLOW_NAME, {});
      if (replyToken) {
        await sendReply(replyToken, channelAccessToken, [askNameMessage()]);
      }
      return true;
    }
    await finishAndNotify(
      supabase,
      cast,
      {
        guestName: draft.guestName,
        peopleCount: draft.peopleCount,
        visitTime,
      },
      replyToken,
      channelAccessToken
    );
    return true;
  }

  return false;
}
