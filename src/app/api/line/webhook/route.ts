import { NextResponse } from "next/server";
import { Hono } from "hono";
import { handle } from "hono/vercel";
import { verifyLineSignature } from "@/lib/line-signature";
import { sendReply, sendMulticastMessage } from "@/lib/line-reply";
import { createSupabaseClient } from "@/lib/supabase";
import { getTodayJst } from "@/lib/date-utils";
import { getDefaultStoreIdOrNull } from "@/lib/current-store";
import type {
  LineWebhookBody,
  LineMessageEvent,
  LinePostbackEvent,
  AttendancePostbackData,
} from "@/types/line-webhook";

const app = new Hono();

const ERROR_REPLY = "申し訳ございません。エラーが発生しました。しばらく経ってから再度お試しください。";
const CAST_NOT_FOUND_REPLY = "キャストが登録されていません。管理者にご連絡ください。";
/** 本日分の attendance_schedules が無い場合（管理画面に反映できないため成功返信しない） */
const NO_SCHEDULE_FOR_TODAY_REPLY =
  "本日の出勤予定がシステムに登録されていません。管理者にご連絡ください。";

/** 遅刻・欠勤ボタン押下後、理由入力を促す（DB 成功後のみ送信） */
const LATE_POSTBACK_REPLY =
  "到着予定時間、またその理由をこのトークにそのまま返信してください";
const ABSENT_POSTBACK_REPLY =
  "欠勤の理由（体調不良など）をこのトークにそのまま返信してください";

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
 * - テキスト・ポストバック両対応: 出勤/欠勤/遅刻（「出勤」「遅刻」「欠勤」の完全一致テキスト含む）
 * - 遅刻・欠勤後の自由テキストは late_reason / absent_reason に保存（キャストへは無言）
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

        console.log("[Webhook] テキスト受信 | text:", JSON.stringify(text));

        // 遅刻・欠勤フラグが立っている場合は、完全一致コマンドより先に理由テキストとして扱う
        const consumedAsReason = await tryHandleLateAbsentReasonText(
          userId,
          text,
          supabase,
          channelAccessToken
        );

        if (consumedAsReason) {
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
const DEFAULT_ADMIN_NOTIFY_PRESENT =
  "【出勤連絡】{name}さんから本日の出勤（予定通り）の連絡がありました。";

type ReminderConfigValue = {
  reply_present?: string;
  reply_late?: string;
  reply_absent?: string;
  admin_notify_late?: string;
  admin_notify_absent?: string;
  admin_notify_present?: string;
  admin_notify_new_cast?: string;
  welcome_message?: string;
};

const DEFAULT_ADMIN_NOTIFY_NEW_CAST = "新しく {name} さんが登録されました！";
const DEFAULT_WELCOME_MESSAGE =
  "{name}さん、はじめまして。出勤・退勤の連絡はこのLINEから行えます。よろしくお願いいたします。";

/** system_settings から reminder_config を取得し、返信・管理者通知メッセージを返す */
async function getReminderReplyConfig(
  supabase: ReturnType<typeof createSupabaseClient>,
  storeId: string
): Promise<{
  replyMessages: Record<AttendancePostbackData, string>;
  adminNotifyTemplates: Record<AttendancePostbackData, string>;
}> {
  const { data, error } = await supabase
    .from("system_settings")
    .select("value")
    .eq("store_id", storeId)
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
    // DRY: 出勤・遅刻・欠勤の管理者通知テンプレートを一括で保持
    adminNotifyTemplates: {
      attending:
        config.admin_notify_present?.trim() || DEFAULT_ADMIN_NOTIFY_PRESENT,
      late: config.admin_notify_late?.trim() || DEFAULT_ADMIN_NOTIFY_LATE,
      absent: config.admin_notify_absent?.trim() || DEFAULT_ADMIN_NOTIFY_ABSENT,
    },
  };
}

/** 友だち追加時のメッセージ（新人通知・ウェルカム）を取得 */
async function getFollowConfig(
  supabase: ReturnType<typeof createSupabaseClient>,
  storeId: string
): Promise<{
  adminNotifyNewCast: string;
  welcomeMessage: string;
}> {
  const { data, error } = await supabase
    .from("system_settings")
    .select("value")
    .eq("store_id", storeId)
    .eq("key", "reminder_config")
    .maybeSingle();

  const config = (data?.value ?? {}) as ReminderConfigValue;

  return {
    adminNotifyNewCast:
      config.admin_notify_new_cast?.trim() || DEFAULT_ADMIN_NOTIFY_NEW_CAST,
    welcomeMessage:
      config.welcome_message?.trim() || DEFAULT_WELCOME_MESSAGE,
  };
}

/**
 * 管理者の LINE User ID 一覧を取得
 * casts テーブルの is_admin=true かつ line_user_id が null でない者を優先。
 * 該当者がいない場合は stores.admin_line_user_id にフォールバック。
 */
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

/**
 * 友だち追加・ブロック解除時の処理
 * DBの welcome_message / admin_notify_new_cast を使用
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

  const fromEnv = getDefaultStoreIdOrNull();
  let storeId: string | null = fromEnv;
  if (!storeId) {
    const { data: firstStore } = await supabase
      .from("stores")
      .select("id")
      .limit(1)
      .maybeSingle();
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

  const { adminNotifyNewCast, welcomeMessage } = await getFollowConfig(
    supabase,
    storeId
  );
  const applyName = (template: string) =>
    template.replace(/\{name\}/g, displayName || "キャスト");

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

    // 新人登録時: 管理者へ一斉通知（multicast）
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

type ScheduleReasonRow = {
  id: string;
  is_absent: boolean | null;
  is_late: boolean | null;
  response_status: "attending" | "absent" | "late" | null;
  updated_at: string | null;
  created_at: string | null;
};

function rowNeedsReasonInput(row: ScheduleReasonRow): boolean {
  return (
    row.is_absent === true ||
    row.is_late === true ||
    row.response_status === "absent" ||
    row.response_status === "late"
  );
}

function pickReasonKind(row: ScheduleReasonRow): "absent" | "late" {
  if (row.is_absent === true || row.response_status === "absent") return "absent";
  return "late";
}

/**
 * 本日シフトで遅刻・欠勤（またはその response_status）が立っている行に、テキストを理由として保存する。
 * 同一日に複数行ある場合は updated_at が最も新しい行を採用（同時刻なら created_at、それも同なら id）。
 * true を返すと出勤コマンド（「遅刻」等の完全一致）は走らない。
 * キャストへの reply は行わない（成功・失敗とも無言）。
 */
async function tryHandleLateAbsentReasonText(
  lineUserId: string,
  rawText: string,
  supabase: ReturnType<typeof createSupabaseClient>,
  channelAccessToken?: string
): Promise<boolean> {
  const utcNow = new Date().toISOString();
  const todayJst = getTodayJst();

  try {
    console.log("[Reason] --- 理由テキスト処理開始 ---", {
      lineUserIdPrefix: lineUserId?.slice(0, 8) + "…",
      todayJst,
      utcNow,
    });

    const { data: cast, error: castError } = await supabase
      .from("casts")
      .select("id, store_id, name")
      .eq("line_user_id", lineUserId)
      .eq("is_active", true)
      .limit(1)
      .maybeSingle();

    if (castError) {
      console.log("[Reason] キャスト取得エラー（理由モードは使わず継続）:", castError.message);
      return false;
    }
    if (!cast) {
      console.log("[Reason] キャスト未登録 → false（出勤コマンド等へ）");
      return false;
    }

    console.log("[Reason] キャスト特定:", {
      castId: cast.id,
      name: cast.name,
      store_id: cast.store_id,
    });

    const { data: scheduleRows, error: schedErr } = await supabase
      .from("attendance_schedules")
      .select(
        "id, is_absent, is_late, response_status, updated_at, created_at"
      )
      .eq("store_id", cast.store_id)
      .eq("cast_id", cast.id)
      .eq("scheduled_date", todayJst);

    if (schedErr) {
      console.error("[Reason] スケジュール取得エラー:", schedErr);
      return false;
    }

    const rows = (scheduleRows ?? []) as ScheduleReasonRow[];
    console.log("[Reason] 本日シフト件数:", rows.length, {
      scheduled_date: todayJst,
      rows: rows.map((r) => ({
        id: r.id,
        is_absent: r.is_absent,
        is_late: r.is_late,
        response_status: r.response_status,
        updated_at: r.updated_at,
      })),
    });

    if (rows.length === 0) {
      console.log("[Reason] 本日分 attendance_schedules なし → false");
      return false;
    }

    const candidates = rows.filter(rowNeedsReasonInput);
    console.log("[Reason] 理由入力待ち候補件数:", candidates.length);

    if (candidates.length === 0) {
      console.log(
        "[Reason] is_late/is_absent/response_status いずれも遅刻・欠勤でない → false"
      );
      return false;
    }

    candidates.sort((a, b) => {
      const ta = new Date(a.updated_at ?? a.created_at ?? 0).getTime();
      const tb = new Date(b.updated_at ?? b.created_at ?? 0).getTime();
      if (tb !== ta) return tb - ta;
      const ca = new Date(a.created_at ?? 0).getTime();
      const cb = new Date(b.created_at ?? 0).getTime();
      if (cb !== ca) return cb - ca;
      return String(b.id).localeCompare(String(a.id));
    });

    const schedule = candidates[0];
    const reasonKind = pickReasonKind(schedule);
    console.log("[Reason] 採用シフト行:", {
      scheduleId: schedule.id,
      reasonKind,
      is_absent: schedule.is_absent,
      is_late: schedule.is_late,
      response_status: schedule.response_status,
      updated_at: schedule.updated_at,
    });

    const text = String(rawText ?? "").trim();
    if (!text) {
      console.log("[Reason] 空テキスト → 理由として消費（コマンドは走らせない）");
      return true;
    }

    if (text.length > 5000) {
      console.warn("[Reason] 長すぎるため保存スキップ length=", text.length);
      return true;
    }

    const updates: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };

    if (reasonKind === "absent") {
      updates.absent_reason = text;
    } else {
      updates.late_reason = text;
    }

    const { data: updatedRows, error: updateErr } = await supabase
      .from("attendance_schedules")
      .update(updates)
      .eq("id", schedule.id)
      .select("id");

    if (updateErr) {
      console.error("[Reason] DB UPDATE 失敗:", updateErr);
      return true;
    }

    if (!updatedRows?.length) {
      console.error("[Reason] UPDATE 0件（RLS・id不一致の可能性） scheduleId=", schedule.id);
      return true;
    }

    console.log("[Reason] DB 更新成功 id=", schedule.id);

    if (!channelAccessToken) {
      console.warn("[Reason] LINE_CHANNEL_ACCESS_TOKEN なし → 管理者通知スキップ");
      return true;
    }

    const adminIds = await getAdminLineUserIds(supabase, cast.store_id);
    console.log("[Reason] 管理者宛て line_user_id 数:", adminIds.length);
    if (adminIds.length === 0) {
      console.warn("[Reason] 管理者IDなし → multicast スキップ");
      return true;
    }

    const kindLabel = reasonKind === "absent" ? "欠勤" : "遅刻";
    const displayName = cast.name ?? "キャスト";
    const adminMessage = `${displayName}さんの${kindLabel}理由：『${text}』`;

    try {
      await sendMulticastMessage(adminIds, channelAccessToken, [
        { type: "text", text: adminMessage },
      ]);
      console.log("[Reason] 管理者へ理由詳細通知 OK count=" + adminIds.length);
    } catch (adminErr) {
      console.error("[Reason] 管理者通知失敗:", adminErr);
    }

    return true;
  } catch (err) {
    console.error("[Reason] 未捕捉エラー:", err);
    return true;
  }
}

/**
 * 出勤回答の記録・返信
 * - 管理画面のシフト表は attendance_schedules.response_status を参照するため、
 *   本日のスケジュール行が無い場合は「成功」返信をしない。
 * - attendance_logs の upsert と attendance_schedules の更新がともに成功した場合のみ
 *   設定メッセージ（出勤予定確認等）を返信する。
 * - 遅刻・欠勤: 固定文で理由入力を促す。ボタン直後に管理者へ「理由確認中」通知、理由テキスト受信時に別途詳細通知。
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
    console.log("[Attendance] JST 対象日 scheduled_date=", today);

    // 本日のスケジュール行（管理画面のセルと同一キー）。無ければ response_status を更新できない
    const { data: schedule, error: scheduleFetchError } = await supabase
      .from("attendance_schedules")
      .select("id")
      .eq("store_id", cast.store_id)
      .eq("cast_id", cast.id)
      .eq("scheduled_date", today)
      .maybeSingle();

    if (scheduleFetchError) {
      console.error("[Attendance] スケジュール取得エラー:", scheduleFetchError);
      await safeReply(ERROR_REPLY);
      return;
    }

    const scheduleId = schedule?.id ?? null;
    if (!scheduleId) {
      console.warn(
        "[Attendance] 本日の attendance_schedules なし（反映不可）:",
        today,
        "cast_id=",
        cast.id
      );
      await safeReply(NO_SCHEDULE_FOR_TODAY_REPLY);
      return;
    }

    const { replyMessages } = await getReminderReplyConfig(supabase, cast.store_id);
    const replyTextAttending =
      replyMessages[statusData] ?? "記録を受け付けました。";

    const upsertResult = await supabase
      .from("attendance_logs")
      .upsert(
        {
          store_id: cast.store_id,
          cast_id: cast.id,
          attendance_schedule_id: scheduleId,
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

    if (upsertResult.error) {
      console.error("[Attendance] attendance_logs upsert エラー:", upsertResult.error);
      await safeReply(ERROR_REPLY);
      return;
    }

    const { data: updatedRows, error: scheduleUpdateError } = await supabase
      .from("attendance_schedules")
      .update({
        is_action_completed: true,
        response_status: status,
        is_absent: status === "absent",
        is_late: status === "late",
        updated_at: new Date().toISOString(),
      })
      .eq("id", scheduleId)
      .select("id");

    if (scheduleUpdateError) {
      console.error("[Attendance] attendance_schedules 更新エラー:", scheduleUpdateError);
      await safeReply(ERROR_REPLY);
      return;
    }

    if (!updatedRows?.length) {
      console.error(
        "[Attendance] attendance_schedules 更新0件 id=",
        scheduleId,
        "（空振りのため成功返信しない）"
      );
      await safeReply(ERROR_REPLY);
      return;
    }

    console.log("[Attendance] DB更新完了 scheduleId=", scheduleId);

    const replyAfterSave =
      statusData === "late"
        ? LATE_POSTBACK_REPLY
        : statusData === "absent"
          ? ABSENT_POSTBACK_REPLY
          : replyTextAttending;

    if (
      channelAccessToken &&
      (statusData === "late" || statusData === "absent")
    ) {
      const adminIds = await getAdminLineUserIds(supabase, cast.store_id);
      if (adminIds.length > 0) {
        const kind = statusData === "late" ? "遅刻" : "欠勤";
        const adminMessage = `${cast.name ?? "キャスト"}さんが${kind}の連絡をしました。理由確認中です。`;
        try {
          await sendMulticastMessage(adminIds, channelAccessToken, [
            { type: "text", text: adminMessage },
          ]);
          console.log(
            "[Attendance] 管理者へ初回通知（理由確認中） count=" + adminIds.length
          );
        } catch (adminErr) {
          console.error("[Attendance] 管理者初回通知失敗:", adminErr);
        }
      }
    }

    await safeReply(replyAfterSave);
  } catch (err) {
    console.error("[Attendance] 処理エラー:", err);
    await safeReply(ERROR_REPLY);
  }
}

app.get("*", (c) => c.text("Webhook is running!", 200));

export const GET = handle(app);
export const POST = handle(app);
