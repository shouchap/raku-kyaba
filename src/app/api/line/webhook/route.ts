import { NextResponse } from "next/server";
import { Hono } from "hono";
import { handle } from "hono/vercel";
import { verifyLineSignature } from "@/lib/line-signature";
import {
  sendReply,
  sendPushMessage,
  createAttendanceConfirmationFlexMessage,
} from "@/lib/line-reply";
import { createSupabaseClient } from "@/lib/supabase";
import { getTodayJst } from "@/lib/date-utils";
import type {
  LineWebhookBody,
  LineMessageEvent,
  LinePostbackEvent,
  AttendancePostbackData,
} from "@/types/line-webhook";

const app = new Hono();

const ERROR_REPLY = "申し訳ございません。エラーが発生しました。しばらく経ってから再度お試しください。";
const CAST_NOT_FOUND_REPLY = "キャストが登録されていません。管理者にご連絡ください。";

/** テキスト「出勤」「欠勤」「遅刻」を AttendancePostbackData に変換（両方の入力形式に対応） */
function textToAttendanceData(text: string): AttendancePostbackData | null {
  const t = String(text ?? "").trim();
  if (t === "出勤") return "attending";
  if (t === "欠勤") return "absent";
  if (t === "遅刻") return "late";
  return null;
}

/** postback.data を AttendancePostbackData に変換（前後の空白・改行を除去） */
function parsePostbackData(data: unknown): AttendancePostbackData | null {
  const s = typeof data === "string" ? data.trim() : "";
  if (s === "attending" || s === "absent" || s === "late") return s;
  return null;
}

/**
 * LINE Webhook エンドポイント（本番環境・Vercel完全対応版）
 *
 * - 504タイムアウト防止: 必ず NextResponse.json({ message: "OK" }) を返す
 * - テキスト・ポストバック両対応: 出勤/欠勤/遅刻ボタンの両形式を処理
 * - 日本時間: getTodayJst() で日付を正しく処理
 * - ログ充実: Vercel Logs で何が届いたか追跡可能
 * - 堅牢な try-catch: エラー時もユーザーに返信
 */
app.post("*", async (c) => {
  const okResponse = () => NextResponse.json({ message: "OK" });

  try {
    console.log("[Webhook] リクエスト受信開始");

    // -------------------------------------------------------------------------
    // 1. 生ボディの取得
    // -------------------------------------------------------------------------
    let rawBody: string;
    try {
      rawBody = await c.req.raw.text();
      console.log("[Webhook] ボディ取得完了 length:", rawBody?.length ?? 0);
    } catch (err) {
      console.error("[Webhook] ボディ取得失敗:", err);
      return okResponse();
    }

    // -------------------------------------------------------------------------
    // 2. 署名検証
    // -------------------------------------------------------------------------
    const signature = c.req.header("x-line-signature") ?? null;
    const channelSecret = process.env.LINE_CHANNEL_SECRET;

    if (!channelSecret) {
      console.error("[Webhook] LINE_CHANNEL_SECRET 未設定");
      return okResponse();
    }

    const isValid = await verifyLineSignature(rawBody, signature, channelSecret);
    if (!isValid) {
      console.warn("[Webhook] 署名検証失敗");
      return c.json({ error: "Invalid signature" }, 401);
    }
    console.log("[Webhook] Step 1: 署名検証完了");

    // -------------------------------------------------------------------------
    // 3. ボディのパース
    // -------------------------------------------------------------------------
    let body: LineWebhookBody;
    try {
      body = JSON.parse(rawBody) as LineWebhookBody;
    } catch (err) {
      console.error("[Webhook] JSONパース失敗:", err);
      return okResponse();
    }

    const events = body.events;
    if (!events || !Array.isArray(events) || events.length === 0) {
      console.log("[Webhook] イベントなし（検証リクエスト等）");
      return okResponse();
    }

    console.log("[Webhook] イベント数:", events.length, "| 先頭イベントtype:", events[0]?.type ?? "(none)");

    // -------------------------------------------------------------------------
    // 4. イベント処理
    // -------------------------------------------------------------------------
    const supabase = createSupabaseClient();
    const channelAccessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN ?? undefined;

    if (!channelAccessToken) {
      console.error("[Webhook] LINE_CHANNEL_ACCESS_TOKEN 未設定");
    }

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

        // エラー時もユーザーに返信を試みる
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

    console.log("[Webhook] Step 4: 全処理完了（レスポンス送信）");
    return okResponse();
  } catch (err) {
    console.error("[Webhook] 予期しないエラー:", err);
    return okResponse();
  }
});

/**
 * 単一Webhookイベントの処理
 * - ポストバック（ボタンタップ）とテキストメッセージの両方で出勤/欠勤/遅刻に対応
 */
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

      if (data) {
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
        const data = textToAttendanceData(text);

        console.log("[Webhook] テキスト受信 | text:", JSON.stringify(text), "| 出勤判定:", data ?? "その他");

        if (data) {
          await handleAttendanceResponse(
            userId,
            data,
            supabase,
            messageEvent.replyToken,
            channelAccessToken
          );
        } else if (channelAccessToken && messageEvent.replyToken) {
          await sendReply(
            messageEvent.replyToken,
            channelAccessToken,
            [createAttendanceConfirmationFlexMessage()]
          );
          console.log("[Webhook] 出勤確認Flex送信");
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

/** 返信メッセージのデフォルト（DBにデータがない場合のフォールバック） */
const DEFAULT_REPLY_MESSAGES: Record<AttendancePostbackData, string> = {
  attending: "出勤を記録しました。本日もよろしくお願い致します。",
  late: "遅刻の連絡を受け付けました。差し支えなければ、このチャットで『理由』と『到着予定時刻』を教えていただけますか？",
  absent: "欠勤の連絡を受け付けました。この後、管理者から直接ご連絡させていただきます。",
};

const DEFAULT_ADMIN_NOTIFY_LATE =
  "【遅刻連絡】\n{name} さんから遅刻の連絡がありました。理由と到着予定時刻を確認してください。";
const DEFAULT_ADMIN_NOTIFY_ABSENT =
  "【欠勤連絡】\n{name} さんから欠勤の連絡がありました。至急、連絡・シフト調整をお願いします。";

type ReminderConfigValue = {
  reply_present?: string;
  reply_late?: string;
  reply_absent?: string;
  admin_notify_late?: string;
  admin_notify_absent?: string;
};

/** system_settings から reminder_config を取得し、返信・管理者通知メッセージを返す */
async function getReminderReplyConfig(
  supabase: ReturnType<typeof createSupabaseClient>
): Promise<{
  replyMessages: Record<AttendancePostbackData, string>;
  adminNotifyLate: string;
  adminNotifyAbsent: string;
}> {
  const { data, error } = await supabase
    .from("system_settings")
    .select("value")
    .eq("key", "reminder_config")
    .maybeSingle();

  const config = (data?.value ?? {}) as ReminderConfigValue;

  return {
    replyMessages: {
      attending:
        config.reply_present?.trim() || DEFAULT_REPLY_MESSAGES.attending,
      late: config.reply_late?.trim() || DEFAULT_REPLY_MESSAGES.late,
      absent: config.reply_absent?.trim() || DEFAULT_REPLY_MESSAGES.absent,
    },
    adminNotifyLate:
      config.admin_notify_late?.trim() || DEFAULT_ADMIN_NOTIFY_LATE,
    adminNotifyAbsent:
      config.admin_notify_absent?.trim() || DEFAULT_ADMIN_NOTIFY_ABSENT,
  };
}

/**
 * 友だち追加・ブロック解除時の処理
 */
async function handleFollowEvent(
  lineUserId: string,
  supabase: ReturnType<typeof createSupabaseClient>,
  channelAccessToken: string,
  replyToken: string
): Promise<void> {
  console.log("[Follow] 処理開始 lineUserId:", lineUserId);

  const { displayName } = await getLineProfile(lineUserId, channelAccessToken);
  console.log("[Follow] プロフィール取得成功 displayName:", displayName);

  const { data: store, error: storeError } = await supabase
    .from("stores")
    .select("id")
    .limit(1)
    .single();

  if (storeError || !store) {
    console.error("[Follow] 店舗取得エラー:", storeError?.message);
    await sendReply(replyToken, channelAccessToken, [
      { type: "text", text: `${displayName}さん、友だち追加ありがとうございます。` },
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
      { type: "text", text: `${displayName}さん、友だち追加ありがとうございます。` },
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
        { type: "text", text: `${displayName}さん、友だち追加ありがとうございます。` },
      ]);
      return;
    }
    console.log("[Follow] 新規キャスト登録完了");
  } else {
    const { error: updateError } = await supabase
      .from("casts")
      .update({ name: displayName })
      .eq("id", existingCast.id);
    if (updateError) {
      console.error("[Follow] UPDATE エラー:", updateError);
    }
  }

  const welcomeMessage = `${displayName}さん、はじめまして。出勤・退勤の連絡はこのLINEから行えます。よろしくお願いいたします。`;
  await sendReply(replyToken, channelAccessToken, [{ type: "text", text: welcomeMessage }]);
  console.log("[Follow] 処理完了");
}

async function getLineProfile(
  userId: string,
  channelAccessToken: string
): Promise<{ displayName: string }> {
  const res = await fetch(`https://api.line.me/v2/bot/profile/${userId}`, {
    headers: { Authorization: `Bearer ${channelAccessToken}` },
  });
  if (!res.ok) {
    console.warn("[LINE] getLineProfile failed:", res.status);
    return { displayName: "ゲスト" };
  }
  const data = (await res.json()) as { displayName?: string };
  return { displayName: data.displayName?.trim() || "ゲスト" };
}

/**
 * 出勤回答の記録・返信
 * - キャスト未登録時はユーザーにメッセージを返す（反応なしを防止）
 * - エラー時は try-catch で捕捉し返信
 */
async function handleAttendanceResponse(
  lineUserId: string,
  statusData: AttendancePostbackData,
  supabase: ReturnType<typeof createSupabaseClient>,
  replyToken?: string,
  channelAccessToken?: string
): Promise<void> {
  const safeReply = async (text: string) => {
    if (replyToken && channelAccessToken) {
      await sendReply(replyToken, channelAccessToken, [{ type: "text", text }]);
    } else {
      console.warn("[Webhook] 返信スキップ（replyToken or channelAccessToken なし）");
    }
  };

  try {
    console.log("[Attendance] 処理開始 lineUserId:", lineUserId, "status:", statusData);

    // Step 2: キャスト検索開始
    console.log("[Attendance] Step 2: キャスト検索開始");
    const { data: cast, error: castError } = await supabase
      .from("casts")
      .select("id, store_id, name")
      .eq("line_user_id", lineUserId)
      .eq("is_active", true)
      .limit(1)
      .maybeSingle();

    if (castError) {
      console.error("[Attendance] キャスト検索エラー:", castError);
      await safeReply(ERROR_REPLY);
      return;
    }

    if (!cast) {
      console.warn("[Attendance] キャスト未登録 lineUserId:", lineUserId);
      await safeReply(CAST_NOT_FOUND_REPLY);
      return;
    }

    const today = getTodayJst();
    const status = statusData;

    // Step 3: DBから返信メッセージを取得
    const { replyMessages, adminNotifyLate, adminNotifyAbsent } =
      await getReminderReplyConfig(supabase);
    const replyText = replyMessages[statusData] ?? "記録を受け付けました。";

    // Step 4: DB更新 & LINE返信を並行実行
    console.log("[Attendance] Step 4: DB更新 & LINE返信開始");

    const upsertPromise = supabase
      .from("attendance_logs")
      .upsert(
        {
          store_id: cast.store_id,
          cast_id: cast.id,
          attendance_schedule_id: null,
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

    const replyPromise = safeReply(replyText);

    const [upsertResult] = await Promise.all([upsertPromise, replyPromise]);

    if (upsertResult.error) {
      console.error("[Attendance] upsert エラー:", upsertResult.error);
      await safeReply(ERROR_REPLY);
      return;
    }

    console.log("[Attendance] 記録・返信完了");

    // 遅刻・欠勤時に管理者へ通知（DBのテンプレートを使用、{name}を置換）
    if ((statusData === "late" || statusData === "absent") && channelAccessToken) {
      const { data: store } = await supabase
        .from("stores")
        .select("admin_line_user_id")
        .eq("id", cast.store_id)
        .single();

      const adminUserId = store?.admin_line_user_id;
      if (adminUserId) {
        const template =
          statusData === "late" ? adminNotifyLate : adminNotifyAbsent;
        const adminMessage = template.replace(/\{name\}/g, cast.name ?? "キャスト");
        try {
          await sendPushMessage(adminUserId, channelAccessToken, [
            { type: "text", text: adminMessage },
          ]);
          console.log("[Attendance] 管理者通知送信");
        } catch (adminErr) {
          console.error("[Attendance] 管理者通知失敗:", adminErr);
        }
      }
    }
  } catch (err) {
    console.error("[Attendance] 処理エラー:", err);
    await safeReply(ERROR_REPLY);
    throw err;
  }
}

app.get("*", (c) => c.text("Webhook is running!", 200));

export const GET = handle(app);
export const POST = handle(app);
