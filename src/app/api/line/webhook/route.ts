import { NextResponse } from "next/server";
import { Hono } from "hono";
import { handle } from "hono/vercel";
import { verifyLineSignature } from "@/lib/line-signature";
import { sendReply, sendMulticastMessage, getLineProfile } from "@/lib/line-reply";
import { createSupabaseClient } from "@/lib/supabase";
import { getDefaultStoreIdOrNull, runWithWebhookStoreContext } from "@/lib/current-store";
import type {
  LineWebhookBody,
  LineMessageEvent,
  LinePostbackEvent,
  AttendancePostbackData,
  ReservationPostbackData,
} from "@/types/line-webhook";
import {
  handleAttendanceResponse,
  handleReservationPostback,
  tryHandleLateAbsentReasonText,
  tryHandleReservationDetailText,
  tryHandleReservationAskInvalidText,
  tryHandleCompletedFollowupText,
} from "@/lib/line-webhook-attendance";

const app = new Hono();

const ERROR_REPLY = "申し訳ございません。エラーが発生しました。しばらく経ってから再度お試しください。";

/** テキストコマンドを AttendancePostbackData に変換（完全一致） */
function textToAttendanceData(text: string): AttendancePostbackData | null {
  const t = String(text ?? "").trim();
  if (t === "出勤") return "attending";
  if (t === "欠勤") return "absent";
  if (t === "遅刻") return "late";
  if (t === "公休") return "public_holiday";
  if (t === "半休") return "half_holiday";
  return null;
}

/** postback.data を出勤・来客予定の postback に変換 */
function parsePostbackData(
  data: unknown
): AttendancePostbackData | ReservationPostbackData | null {
  const s = typeof data === "string" ? data.trim() : "";
  if (
    s === "attending" ||
    s === "absent" ||
    s === "late" ||
    s === "public_holiday" ||
    s === "half_holiday"
  )
    return s;
  if (s === "reservation_yes" || s === "reservation_no") return s;
  return null;
}

/**
 * LINE Webhook エンドポイント（本番環境・Vercel完全対応版）
 *
 * - 504タイムアウト防止: 必ず NextResponse.json({ message: "OK" }) を返す
 * - マルチ店舗: `destination`（ボットユーザーID）で stores を引き、チャンネルシークレット・トークンを解決（無ければ環境変数へフォールバック）
 * - 出勤/遅刻/欠勤/公休/半休・来客予定ヒアリング（クイックリプライ）
 * - 遅刻・欠勤・公休・半休後の自由テキストは各理由カラムに保存（キャストへは無言）
 * - 日本時間: getTodayJst() で日付を正しく処理
 */
app.post("*", async (c) => {
  const okResponse = () => NextResponse.json({ message: "OK" });

  try {
    console.log("[Webhook] リクエスト受信開始");
    const supabase = createSupabaseClient();

    let rawBody: string;
    try {
      rawBody = await c.req.raw.text();
      console.log("[Webhook] ボディ取得完了 length:", rawBody?.length ?? 0);
    } catch (err) {
      console.error("[Webhook] ボディ取得失敗:", err);
      return okResponse();
    }

    let body: LineWebhookBody;
    try {
      body = JSON.parse(rawBody) as LineWebhookBody;
    } catch (err) {
      console.error("[Webhook] JSONパース失敗:", err);
      return okResponse();
    }

    const botUserId = body.destination?.trim() ?? "";
    let resolvedStoreId: string | null = null;
    let channelSecret: string | undefined = process.env.LINE_CHANNEL_SECRET;
    let channelAccessToken: string | undefined =
      process.env.LINE_CHANNEL_ACCESS_TOKEN ?? undefined;

    if (botUserId) {
      const { data: storeData, error: storeLookupErr } = await supabase
        .from("stores")
        .select("id, line_channel_secret, line_channel_access_token")
        .eq("line_bot_user_id", botUserId)
        .maybeSingle();

      if (storeLookupErr) {
        console.warn("[Webhook] stores 参照エラー（環境変数へフォールバック）:", storeLookupErr.message);
      }

      resolvedStoreId = storeData?.id ?? null;
      if (resolvedStoreId) {
        console.log(`[Webhook] destination に対応する store_id=${resolvedStoreId}`);
      }

      const sec = storeData?.line_channel_secret?.trim();
      const tok = storeData?.line_channel_access_token?.trim();
      if (sec && tok) {
        channelSecret = sec;
        channelAccessToken = tok;
        console.log(`[Webhook] ボットID ${botUserId} に紐づく店舗設定をDBから取得しました`);
      } else {
        console.log(
          `[Webhook] ボットID ${botUserId} のDB設定が不完全なため環境変数へフォールバックします`
        );
      }
    }

    const signature = c.req.header("x-line-signature") ?? null;
    if (!channelSecret?.trim()) {
      console.error("[Webhook] チャンネルシークレットが取得できません（DB・環境変数とも）");
      return okResponse();
    }

    const isValid = await verifyLineSignature(rawBody, signature, channelSecret);
    if (!isValid) {
      console.warn("[Webhook] 署名検証失敗");
      return c.json({ error: "Invalid signature" }, 401);
    }
    console.log("[Webhook] 署名検証完了");

    const events = body.events;
    if (!events || !Array.isArray(events) || events.length === 0) {
      console.log("[Webhook] イベントなし（検証リクエスト等）");
      return okResponse();
    }

    console.log("[Webhook] イベント数:", events.length, "| 先頭イベントtype:", events[0]?.type ?? "(none)");

    if (!channelAccessToken?.trim()) {
      console.error("[Webhook] LINE_CHANNEL_ACCESS_TOKEN が取得できません（DB・環境変数とも）");
    }

    await runWithWebhookStoreContext(resolvedStoreId, async () => {
      for (let i = 0; i < events.length; i++) {
        const event = events[i];
        const eventType = event?.type ?? "(unknown)";
        const webhookId = event?.webhookEventId ?? `idx-${i}`;

        console.log(`[Webhook] Event[${i}] type=${eventType} webhookEventId=${webhookId}`);

        if (!event || typeof event.type !== "string") {
          console.warn("[Webhook] 不正なイベントをスキップ:", JSON.stringify(event));
          continue;
        }

        try {
          await processWebhookEvent(event, body.destination, supabase, channelAccessToken);
        } catch (err) {
          console.error("[Webhook] イベント処理エラー:", webhookId, err);

          const replyToken = (event as { replyToken?: string }).replyToken;
          if (replyToken && channelAccessToken) {
            try {
              await sendReply(replyToken, channelAccessToken, [
                { type: "text", text: ERROR_REPLY },
              ]);
              console.log("[Webhook] エラー返信を送信");
            } catch (replyErr) {
              console.error("[Webhook] エラー返信も失敗:", replyErr);
            }
          }
        }
      }
    });

    console.log("[Webhook] 全処理完了（レスポンス送信）");
    return okResponse();
  } catch (err) {
    console.error("[Webhook] 予期しないエラー:", err);
    return okResponse();
  }
});

async function processWebhookEvent(
  event: LineWebhookBody["events"][number],
  _destination: string | undefined,
  supabase: ReturnType<typeof createSupabaseClient>,
  channelAccessToken?: string
): Promise<void> {
  const userId = event.source?.userId;
  if (!userId) {
    console.log("[Webhook] userId なし（グループ等）のためスキップ");
    return;
  }

  switch (event.type) {
    case "postback": {
      const postbackEvent = event as LinePostbackEvent;
      const rawData = postbackEvent.postback?.data;
      const data = parsePostbackData(rawData);

      console.log("[Webhook] Postback受信 | rawData:", JSON.stringify(rawData), "| 判定:", data ?? "未対応");

      if (data === "reservation_yes" || data === "reservation_no") {
        await handleReservationPostback(
          userId,
          data,
          supabase,
          postbackEvent.replyToken,
          channelAccessToken
        );
      } else if (data) {
        await handleAttendanceResponse(
          userId,
          data,
          supabase,
          postbackEvent.replyToken,
          channelAccessToken
        );
      } else {
        console.warn("[Webhook] 未対応のpostback.data:", rawData);
      }
      break;
    }

    case "message": {
      const messageEvent = event as LineMessageEvent;
      if (messageEvent.message?.type === "text") {
        const text = messageEvent.message.text ?? "";

        console.log("[Webhook] テキスト受信 | text:", JSON.stringify(text));

        const consumedReservationDetail = await tryHandleReservationDetailText(
          userId,
          text,
          supabase,
          messageEvent.replyToken,
          channelAccessToken
        );
        if (consumedReservationDetail) break;

        const consumedAskRemind = await tryHandleReservationAskInvalidText(
          userId,
          text,
          supabase,
          messageEvent.replyToken,
          channelAccessToken
        );
        if (consumedAskRemind) break;

        const consumedAsReason = await tryHandleLateAbsentReasonText(
          userId,
          text,
          supabase,
          channelAccessToken
        );

        if (consumedAsReason) {
          break;
        }

        const consumedCompletedFollowup = await tryHandleCompletedFollowupText(
          userId,
          text,
          supabase,
          messageEvent.replyToken,
          channelAccessToken
        );
        if (consumedCompletedFollowup) {
          break;
        }

        const data = textToAttendanceData(text);
        console.log("[Webhook] 出勤コマンド判定:", data ?? "なし");

        if (data) {
          await handleAttendanceResponse(
            userId,
            data,
            supabase,
            messageEvent.replyToken,
            channelAccessToken
          );
        }
      }
      break;
    }

    case "follow": {
      const followEvent = event as { replyToken?: string };
      if (channelAccessToken && followEvent.replyToken) {
        await handleFollowEvent(userId, supabase, channelAccessToken, followEvent.replyToken);
      }
      break;
    }

    case "unfollow":
    case "join":
    case "leave":
      console.log("[Webhook] 未処理イベント:", event.type);
      break;

    default:
      console.log("[Webhook] 未対応イベント:", event.type);
  }
}

const DEFAULT_ADMIN_NOTIFY_NEW_CAST = "新しく {name} さんが登録されました！";
const DEFAULT_WELCOME_MESSAGE =
  "{name}さん、はじめまして。出勤・退勤の連絡はこのLINEから行えます。よろしくお願いいたします。";

type ReminderConfigValue = {
  admin_notify_new_cast?: string;
  welcome_message?: string;
};

async function getFollowConfig(
  supabase: ReturnType<typeof createSupabaseClient>,
  storeId: string
): Promise<{
  adminNotifyNewCast: string;
  welcomeMessage: string;
}> {
  const { data } = await supabase
    .from("system_settings")
    .select("value")
    .eq("store_id", storeId)
    .eq("key", "reminder_config")
    .maybeSingle();

  const config = (data?.value ?? {}) as ReminderConfigValue;

  return {
    adminNotifyNewCast:
      config.admin_notify_new_cast?.trim() || DEFAULT_ADMIN_NOTIFY_NEW_CAST,
    welcomeMessage: config.welcome_message?.trim() || DEFAULT_WELCOME_MESSAGE,
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

async function handleFollowEvent(
  lineUserId: string,
  supabase: ReturnType<typeof createSupabaseClient>,
  channelAccessToken: string,
  replyToken: string
): Promise<void> {
  console.log("[Follow] 処理開始 lineUserId:", lineUserId);

  const { displayName } = await getLineProfile(lineUserId, channelAccessToken);
  console.log("[Follow] プロフィール取得成功 displayName:", displayName);

  let storeId: string | null = getDefaultStoreIdOrNull();
  if (!storeId) {
    const { data: firstStore } = await supabase.from("stores").select("id").limit(1).maybeSingle();
    storeId = firstStore?.id ?? null;
  }
  if (!storeId) {
    console.error("[Follow] 店舗IDを解決できません（NEXT_PUBLIC_DEFAULT_STORE_ID または stores）");
    await sendReply(replyToken, channelAccessToken, [
      {
        type: "text",
        text: DEFAULT_WELCOME_MESSAGE.replace(/\{name\}/g, displayName || "キャスト"),
      },
    ]);
    return;
  }

  const { adminNotifyNewCast, welcomeMessage } = await getFollowConfig(supabase, storeId);
  const applyName = (template: string) => template.replace(/\{name\}/g, displayName || "キャスト");

  const { data: store, error: storeError } = await supabase
    .from("stores")
    .select("id, admin_line_user_id")
    .eq("id", storeId)
    .single();

  if (storeError || !store) {
    console.error("[Follow] 店舗取得エラー:", storeError?.message);
    await sendReply(replyToken, channelAccessToken, [
      { type: "text", text: applyName(welcomeMessage) },
    ]);
    return;
  }

  const { data: existingCast, error: selectError } = await supabase
    .from("casts")
    .select("id, name")
    .eq("line_user_id", lineUserId)
    .eq("store_id", store.id)
    .maybeSingle();

  if (selectError) {
    console.error("[Follow] SELECT エラー:", selectError);
    await sendReply(replyToken, channelAccessToken, [
      { type: "text", text: applyName(welcomeMessage) },
    ]);
    return;
  }

  if (!existingCast) {
    const { error: insertError } = await supabase.from("casts").insert({
      store_id: store.id,
      line_user_id: lineUserId,
      name: displayName,
      is_active: true,
    });
    if (insertError) {
      console.error("[Follow] INSERT エラー:", insertError);
      await sendReply(replyToken, channelAccessToken, [
        { type: "text", text: applyName(welcomeMessage) },
      ]);
      return;
    }
    console.log("[Follow] 新規キャスト登録完了");

    const adminIds = await getAdminLineUserIds(supabase, store.id);
    if (adminIds.length > 0 && channelAccessToken) {
      const adminMsg = applyName(adminNotifyNewCast);
      try {
        await sendMulticastMessage(adminIds, channelAccessToken, [
          { type: "text", text: adminMsg },
        ]);
        console.log("[Follow] 管理者へ新人登録通知送信", adminIds.length, "名");
      } catch (adminErr) {
        console.error("[Follow] 管理者通知失敗:", adminErr);
      }
    }
  } else {
    const { error: updateError } = await supabase
      .from("casts")
      .update({ name: displayName })
      .eq("id", existingCast.id);
    if (updateError) {
      console.error("[Follow] UPDATE エラー:", updateError);
    }
  }

  await sendReply(replyToken, channelAccessToken, [
    { type: "text", text: applyName(welcomeMessage) },
  ]);
  console.log("[Follow] 処理完了");
}

app.get("*", (c) => c.text("Webhook is running!", 200));

export const GET = handle(app);
export const POST = handle(app);
