import { Hono } from "hono";
import { handle } from "hono/vercel";
import { verifyLineSignature } from "@/lib/line-signature";
import {
  sendReply,
  sendPushMessage,
  createAttendanceConfirmationFlexMessage,
} from "@/lib/line-reply";
import { createSupabaseClient } from "@/lib/supabase";
import type {
  LineWebhookBody,
  LineMessageEvent,
  LinePostbackEvent,
  AttendancePostbackData,
} from "@/types/line-webhook";

export const runtime = "edge";

const app = new Hono();

/** テキスト「出勤」「欠勤」「遅刻」を AttendancePostbackData に変換 */
function textToAttendanceData(text: string): AttendancePostbackData | null {
  const t = text?.trim();
  if (t === "出勤") return "attending";
  if (t === "欠勤") return "absent";
  if (t === "遅刻") return "late";
  return null;
}

/**
 * LINE Webhook エンドポイント
 *
 * 設計意図:
 * - POSTのみ受付。LINEはWebhookにPOSTでイベントを送信する
 * - 署名検証を最優先で実施し、不正リクエストを早期に拒否する
 * - raw bodyを署名検証前に取得するため、Honoのbody解析前にc.req.rawから直接取得
 * - エラー時も必ず200でレスポンスを返し、Vercelの504タイムアウトを防ぐ
 */
app.post("*", async (c) => {
  const okResponse = () => c.json({ message: "OK" }, 200);

  try {
    // -------------------------------------------------------------------------
    // 1. 生ボディの取得（署名検証には完全一致が必要なため、パース前の文字列を使用）
    // -------------------------------------------------------------------------
    let rawBody: string;
    try {
      rawBody = await c.req.raw.text();
    } catch (err) {
      console.error("[Webhook] Failed to read request body:", err);
      return c.json({ message: "OK" }, 200); // 不正リクエストでも200で返し再送を防ぐ
    }

    // -------------------------------------------------------------------------
    // 2. 署名検証
    // -------------------------------------------------------------------------
    const signature = c.req.header("x-line-signature") ?? null;
    const channelSecret = process.env.LINE_CHANNEL_SECRET;

    if (!channelSecret) {
      console.error("[Webhook] LINE_CHANNEL_SECRET is not configured");
      return okResponse();
    }

    const isValid = await verifyLineSignature(rawBody, signature, channelSecret);
    if (!isValid) {
      console.warn("[Webhook] Signature verification failed");
      return c.json({ error: "Invalid signature" }, 401);
    }

    // -------------------------------------------------------------------------
    // 3. ボディのパース
    // -------------------------------------------------------------------------
    let body: LineWebhookBody;
    try {
      body = JSON.parse(rawBody) as LineWebhookBody;
    } catch {
      return okResponse();
    }

    // イベントが空の場合は即返却（LINEの検証リクエスト等）
    if (!body.events || !Array.isArray(body.events) || body.events.length === 0) {
      return okResponse();
    }

    // -------------------------------------------------------------------------
    // 4. イベント処理（各イベントを順次処理）
    // -------------------------------------------------------------------------
    const supabase = createSupabaseClient();
    const channelAccessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN ?? undefined;

    for (let i = 0; i < body.events.length; i++) {
      const event = body.events[i];
      const eventType = event?.type ?? "(unknown)";
      console.log(`[Webhook] Event[${i}] type:`, eventType);

      if (!event || typeof event.type !== "string") {
        console.warn("[Webhook] Skipping invalid event:", event);
        continue;
      }

      try {
        await processWebhookEvent(
          event,
          body.destination,
          supabase,
          channelAccessToken
        );
      } catch (err) {
        console.error("[Webhook] Event processing error:", event.webhookEventId ?? i, err);
      }
    }

    return okResponse();
  } catch (err) {
    console.error("[Webhook] Unexpected error:", err);
    return okResponse();
  }
});

/**
 * 単一Webhookイベントの処理
 *
 * 設計意図:
 * - LINE User ID は source.userId から取得（1対1チャット・グループ共通）
 * - Postbackのdataで「attending」「absent」「late」を識別
 * - マルチテナント時は body.destination でストアを特定可能（将来拡張）
 */
async function processWebhookEvent(
  event: LineWebhookBody["events"][number],
  _destination: string | undefined,
  supabase: ReturnType<typeof createSupabaseClient>,
  channelAccessToken?: string
): Promise<void> {
  const userId = event.source?.userId;
  if (!userId) {
    // グループ/ルームのみのイベントなど、userIdが無い場合はスキップ
    return;
  }

  switch (event.type) {
    case "postback": {
      const postbackEvent = event as LinePostbackEvent;
      const data = postbackEvent.postback?.data as AttendancePostbackData | undefined;

      if (isAttendancePostbackData(data)) {
        await handleAttendanceResponse(
          userId,
          data,
          supabase,
          postbackEvent.replyToken,
          channelAccessToken
        );
      }
      break;
    }

    case "message": {
      const messageEvent = event as LineMessageEvent;
      if (messageEvent.message?.type === "text") {
        const text = messageEvent.message.text ?? "";
        console.log("[Webhook] テキストメッセージ:", text);

        const attendanceData = textToAttendanceData(text);
        if (attendanceData) {
          // 「出勤」「欠勤」「遅刻」→ 出勤回答として記録・返信
          await handleAttendanceResponse(
            userId,
            attendanceData,
            supabase,
            messageEvent.replyToken,
            channelAccessToken
          );
        } else if (channelAccessToken && messageEvent.replyToken) {
          // その他のテキスト → 出勤確認Flex Messageを返信
          await sendReply(
            messageEvent.replyToken,
            channelAccessToken,
            [createAttendanceConfirmationFlexMessage()]
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
      break;

    default:
      // 未対応イベントは無視（ログ出力のみ）
      break;
  }
}

/** 出勤回答に対する返信メッセージ（管理しやすいようにオブジェクトにまとめる） */
const REPLY_MESSAGES: Record<AttendancePostbackData, string> = {
  attending:
    "出勤を記録しました。本日もよろしくお願い致します！",
  late: "遅刻の連絡を受け付けました。差し支えなければ、このチャットで『理由』と『到着予定時刻』を教えていただけますか？",
  absent:
    "欠勤の連絡を受け付けました。この後、管理者から直接ご連絡させていただきます。",
};

/**
 * 友だち追加・ブロック解除時の処理
 * LINEプロフィールから表示名を取得し、castsテーブルに登録する
 */
async function handleFollowEvent(
  lineUserId: string,
  supabase: ReturnType<typeof createSupabaseClient>,
  channelAccessToken: string,
  replyToken: string
): Promise<void> {
  console.log("[Follow] 処理開始 lineUserId:", lineUserId);

  // 1. LINEプロフィールから表示名を取得
  console.log("[Follow] プロフィール取得を開始");
  const { displayName } = await getLineProfile(lineUserId, channelAccessToken);
  console.log("[Follow] プロフィール取得成功 displayName:", displayName);

  // 2. stores テーブルから最初の1件を取得
  console.log("[Follow] 店舗取得を開始");
  const { data: store, error: storeError } = await supabase
    .from("stores")
    .select("id")
    .limit(1)
    .single();

  if (storeError || !store) {
    console.error("[Follow] 店舗取得エラー:", storeError?.message ?? "No store data");
    await sendReply(
      replyToken,
      channelAccessToken,
      [{ type: "text", text: `${displayName}さん、友だち追加ありがとうございます！` }]
    );
    return;
  }
  console.log("[Follow] 店舗取得成功 storeId:", store.id);

  // 3. casts テーブルを line_user_id で SELECT（既存登録の確認）
  console.log("[Follow] 既存キャスト確認を開始 line_user_id:", lineUserId);
  const { data: existingCast, error: selectError } = await supabase
    .from("casts")
    .select("id, name")
    .eq("line_user_id", lineUserId)
    .eq("store_id", store.id)
    .maybeSingle();

  if (selectError) {
    console.error("[Follow] SELECT エラー:", selectError);
    await sendReply(
      replyToken,
      channelAccessToken,
      [{ type: "text", text: `${displayName}さん、友だち追加ありがとうございます！` }]
    );
    return;
  }

  if (!existingCast) {
    // 4a. データが無ければ INSERT で新規登録
    console.log("[Follow] 新規登録のため INSERT を実行");
    const { error: insertError } = await supabase.from("casts").insert({
      store_id: store.id,
      line_user_id: lineUserId,
      name: displayName,
      is_active: true,
    });

    if (insertError) {
      console.error("[Follow] INSERT エラー:", insertError);
      await sendReply(
        replyToken,
        channelAccessToken,
        [{ type: "text", text: `${displayName}さん、友だち追加ありがとうございます！` }]
      );
      return;
    }
    console.log("[Follow] INSERT 成功 新規キャスト登録完了");
  } else {
    // 4b. データが有れば UPDATE で名前を更新
    console.log("[Follow] 既存データあり UPDATE を実行 castId:", existingCast.id, "旧name:", existingCast.name);
    const { error: updateError } = await supabase
      .from("casts")
      .update({ name: displayName })
      .eq("id", existingCast.id);

    if (updateError) {
      console.error("[Follow] UPDATE エラー:", updateError);
      await sendReply(
        replyToken,
        channelAccessToken,
        [{ type: "text", text: `${displayName}さん、友だち追加ありがとうございます！` }]
      );
      return;
    }
    console.log("[Follow] UPDATE 成功 名前を更新:", displayName);
  }

  // 5. 挨拶メッセージを返信
  console.log("[Follow] 挨拶メッセージを送信");
  const welcomeMessage = `${displayName}さん、はじめまして！出勤・退勤の連絡はこのLINEから行えます。よろしくお願いいたします。`;
  await sendReply(replyToken, channelAccessToken, [{ type: "text", text: welcomeMessage }]);
  console.log("[Follow] 処理完了");
}

/** LINEプロフィールから表示名を取得 */
async function getLineProfile(
  userId: string,
  channelAccessToken: string
): Promise<{ displayName: string }> {
  const res = await fetch(`https://api.line.me/v2/bot/profile/${userId}`, {
    headers: { Authorization: `Bearer ${channelAccessToken}` },
  });
  if (!res.ok) {
    console.warn("[LINE] getLineProfile failed:", res.status, await res.text());
    return { displayName: "ゲスト" };
  }
  const data = (await res.json()) as { displayName?: string };
  return { displayName: data.displayName?.trim() || "ゲスト" };
}

function isAttendancePostbackData(value: unknown): value is AttendancePostbackData {
  return value === "attending" || value === "absent" || value === "late";
}

function toAttendanceStatus(data: AttendancePostbackData): "attending" | "absent" | "late" {
  return data;
}

/**
 * 出勤回答の記録処理
 *
 * 設計意図:
 * - line_user_id で casts を検索し、store_id を取得してテナントを特定
 * - 同一キャスト・同一日の重複は upsert で上書き（再回答を許可）
 * - 記録成功後、REPLY_MESSAGES に従い該当メッセージをLINEで返信
 * - 欠勤時の管理者即時通知は別モジュール（将来的に実装）で行う想定
 */
async function handleAttendanceResponse(
  lineUserId: string,
  statusData: AttendancePostbackData,
  supabase: ReturnType<typeof createSupabaseClient>,
  replyToken?: string,
  channelAccessToken?: string
): Promise<void> {
  // キャスト照合: line_user_id で検索
  const { data: cast, error: castError } = await supabase
    .from("casts")
    .select("id, store_id, name")
    .eq("line_user_id", lineUserId)
    .eq("is_active", true)
    .single();

  if (castError || !cast) {
    console.warn("[Webhook] Cast not found for line_user_id:", lineUserId, castError?.message);
    return;
  }

  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const status = toAttendanceStatus(statusData);

  // attendance_logs に upsert（同日・同キャストの重複回答は上書き）
  const { error: upsertError } = await supabase
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

  if (upsertError) {
    console.error("[Webhook] Failed to upsert attendance_log:", upsertError);
    throw upsertError;
  }

  // 記録成功後、該当メッセージをLINEへ返信（KISS原則に基づきシンプルに）
  const text =
    REPLY_MESSAGES[statusData] || "記録を受け付けました。";
  if (replyToken && channelAccessToken) {
    await sendReply(replyToken, channelAccessToken, [{ type: "text", text }]);
  }

  // 遅刻・欠勤時に管理者へPushメッセージを送る
  if (
    (statusData === "late" || statusData === "absent") &&
    channelAccessToken
  ) {
    const { data: store } = await supabase
      .from("stores")
      .select("admin_line_user_id")
      .eq("id", cast.store_id)
      .single();

    const adminUserId = store?.admin_line_user_id;
    if (adminUserId) {
      const adminMessage =
        statusData === "late"
          ? `⚠️ 【遅刻連絡】\nキャストの ${cast.name} さんから遅刻の連絡がありました。チャットで理由と到着予定時刻を確認してください。`
          : `🚨 【欠勤連絡】\nキャストの ${cast.name} さんから欠勤の連絡がありました。至急、直接の連絡・シフト調整をお願いします。`;

      await sendPushMessage(adminUserId, channelAccessToken, [
        { type: "text", text: adminMessage },
      ]);
    }
  }
}

app.get("*", (c) => c.text("Webhook is running!", 200));

export const GET = handle(app);
export const POST = handle(app);
