import { NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { sendPushMessage, sendMulticastMessage } from "@/lib/line-reply";
import {
  applyReminderMessageTemplate,
  buildAttendanceRemindFlexMessage,
  formatRemindScheduledTime,
} from "@/lib/attendance-remind-flex";
import { getTodayJst } from "@/lib/date-utils";

/** 管理者の line_user_id 一覧を取得（warn-unanswered と同様のロジック） */
async function getAdminLineUserIds(
  supabase: SupabaseClient,
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

/** キャッシュ無効化: 毎回最新のDB値を取得する */
export const dynamic = "force-dynamic";

type ReminderConfig = {
  enabled?: boolean;
  sendTime?: string;
  send_time?: string;
  messageTemplate?: string;
  template?: string;
  reply_present?: string;
  reply_late?: string;
  reply_absent?: string;
  admin_notify_late?: string;
  admin_notify_absent?: string;
  admin_notify_new_cast?: string;
  welcome_message?: string;
};

/** reminder_config の文字列フィールドを undefined なら "" に正規化（JSONエラー防止） */
function sanitizeReminderConfig(raw: Record<string, unknown>): Record<string, string | boolean> {
  const stringKeys = [
    "sendTime",
    "messageTemplate",
    "reply_present",
    "reply_late",
    "reply_absent",
    "admin_notify_late",
    "admin_notify_absent",
    "admin_notify_new_cast",
    "welcome_message",
  ] as const;
  const out: Record<string, string | boolean> = { ...raw } as Record<string, string | boolean>;
  for (const k of stringKeys) {
    const v = raw[k];
    out[k] = typeof v === "string" ? v : "";
  }
  // キー名の違いに対応: send_time → sendTime, template → messageTemplate
  if (!out.sendTime && typeof raw.send_time === "string") out.sendTime = raw.send_time;
  if (!out.messageTemplate && typeof raw.template === "string") out.messageTemplate = raw.template;
  return out;
}

/** DBに未設定の場合のフォールバック（空文字時のみ使用） */
const DEFAULT_TEMPLATE =
  "{name}さん、本日は {time} 出勤予定です。出勤確認をお願いいたします。";

/** reminder_config が空・未設定時のデフォルト値 */
const DEFAULT_REMINDER_CONFIG: ReminderConfig = {
  enabled: true,
  sendTime: "12:00",
  messageTemplate: DEFAULT_TEMPLATE,
};

/** エラーを詳細にログ出力（LINE API レスポンス等を含む） */
function logError(context: string, err: unknown): void {
  const msg = err instanceof Error ? err.message : String(err);
  const stack = err instanceof Error ? err.stack : undefined;
  const extra =
    err && typeof err === "object" && !(err instanceof Error)
      ? JSON.stringify(err, null, 2)
      : "";
  console.error(`[Remind] ${context}:`, msg);
  if (stack) console.error(`[Remind] ${context} stack:`, stack);
  if (extra) console.error(`[Remind] ${context} details:`, extra);
}

/**
 * 本日出勤予定のキャストへリマインド（Flex Message）を送信するAPI
 *
 * GET /api/remind で呼び出し。
 * system_settings の reminder_config で enabled が true のとき、
 * 認証（CRON_SECRET）通過後は本日未送信分を送信する（実行時刻はスケジューラ側で制御）。
 * メッセージは白背景カード型の Flex Message（Club GOLD 出勤確認）。
 */
export async function GET(request: Request) {
  try {
    return await handleRemind(request);
  } catch (err) {
    console.error("[Remind] Full Error details:", err);
    logError("予期しないエラー", err);
    return NextResponse.json(
      {
        error: "Internal server error",
        details: err instanceof Error ? err.message : String(err),
      },
      { status: 500 }
    );
  }
}

async function handleRemind(request: Request) {
  // Authorization Bearer が CRON_SECRET と一致すれば処理継続
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && cronSecret.trim() !== "") {
    const authHeader = request.headers.get("authorization");
    const expected = `Bearer ${cronSecret.trim()}`;
    if (authHeader?.trim() !== expected) {
      return NextResponse.json(
        { error: "Unauthorized", message: "Invalid or missing Authorization header" },
        { status: 401 }
      );
    }
  }
  const supabaseUrl =
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const supabaseKey =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    process.env.SUPABASE_SERVICE_ROLE_KEY;
  const channelAccessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN;

  if (!supabaseUrl || !supabaseKey) {
    return NextResponse.json(
      { error: "Supabase URL or key is not configured" },
      { status: 500 }
    );
  }
  if (!channelAccessToken) {
    return NextResponse.json(
      { error: "LINE_CHANNEL_ACCESS_TOKEN is not configured" },
      { status: 500 }
    );
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  // 1. system_settings から reminder_config を取得
  const { data: settingsRow, error: settingsError } = await supabase
    .from("system_settings")
    .select("value")
    .eq("key", "reminder_config")
    .maybeSingle();

  if (settingsError) {
    console.error("[Remind] Full Error details:", settingsError);
    logError("reminder_config 取得失敗", settingsError);
    return NextResponse.json(
      { error: "Failed to fetch settings", details: settingsError.message },
      { status: 500 }
    );
  }

  const rawConfig = (settingsRow?.value ?? {}) as Record<string, unknown>;
  const sanitized = sanitizeReminderConfig(rawConfig);

  console.log("[Remind] DBから取得した reminder_config の中身:", JSON.stringify(rawConfig, null, 2));

  const config: ReminderConfig = {
    ...DEFAULT_REMINDER_CONFIG,
    ...sanitized,
    enabled: rawConfig.enabled === false ? false : DEFAULT_REMINDER_CONFIG.enabled,
    sendTime:
      (sanitized.sendTime && String(sanitized.sendTime).trim()) ||
      (typeof rawConfig.send_time === "string" && rawConfig.send_time.trim()) ||
      DEFAULT_REMINDER_CONFIG.sendTime,
    messageTemplate:
      (sanitized.messageTemplate && String(sanitized.messageTemplate).trim()) ||
      (typeof rawConfig.template === "string" && rawConfig.template.trim()) ||
      DEFAULT_REMINDER_CONFIG.messageTemplate,
  };

  // 2. enabled が false なら何もせず終了
  if (config.enabled === false) {
    console.log("[Remind] リマインドは無効です（enabled: false）");
    return NextResponse.json({
      ok: true,
      message: "Reminder disabled",
      successCount: 0,
      failureCount: 0,
    });
  }

  console.log("[Remind] リマインド処理を開始します（内部の送信時刻チェックは行いません）");

  // DB の scheduled_date は「日本のカレンダー上の今日」と一致させる（UTC の日付は使わない）
  const today = getTodayJst();
  console.log(
    `[Remind] 対象日（JST）scheduled_date=${today}（UTC時刻=${new Date().toISOString()}）`
  );

  // config.messageTemplate が undefined でも絶対にクラッシュしないガード
  const rawTemplate =
    (config.messageTemplate && String(config.messageTemplate).trim()) ||
    (config.template && String(config.template).trim()) ||
    (typeof rawConfig.messageTemplate === "string" && rawConfig.messageTemplate.trim()) ||
    (typeof rawConfig.template === "string" && rawConfig.template.trim()) ||
    "【Club GOLD】本日は {time} 出勤予定です。";
  const messageTemplate = rawTemplate.trim() || "【Club GOLD】本日は {time} 出勤予定です。";

  console.log("[Remind] 使用するテンプレート:", messageTemplate);

  // 本日の出勤予定を取得（休み＝scheduled_time が null/空 は除外、casts と JOIN、is_dohan 含む）
  const { data: rawSchedules, error } = await supabase
    .from("attendance_schedules")
    .select("id, cast_id, store_id, scheduled_date, scheduled_time, is_dohan, last_reminded_at, casts(name, line_user_id)")
    .eq("scheduled_date", today)
    .not("scheduled_time", "is", null);

  if (error) {
    console.error("[Remind] Full Error details:", error);
    logError("出勤予定取得失敗 (Supabase)", error);
    return NextResponse.json(
      { error: "Failed to fetch schedules", details: error.message },
      { status: 500 }
    );
  }

  // 休み（—）: scheduled_time が空文字のレコードを除外
  // 二重送信防止: 本日すでに送信済み（last_reminded_at が今日の日付）はスキップ
  const todayForCompare = today;
  const schedules = (rawSchedules ?? []).filter((s) => {
    const t = s.scheduled_time;
    if (t == null || String(t).trim() === "") return false;
    const lastReminded = s.last_reminded_at;
    if (!lastReminded) return true;
    const lastRemindedDate = new Date(lastReminded).toLocaleDateString("en-CA", {
      timeZone: "Asia/Tokyo",
    });
    if (lastRemindedDate === todayForCompare) return false;
    return true;
  });

  console.log(
    "[Remind] 本日の出勤者数:",
    schedules.length,
    `(DB取得件数: ${rawSchedules?.length ?? 0}、フィルタ後: ${schedules.length})`
  );

  if (schedules.length === 0) {
    console.log("[Remind] 本日の出勤予定はありません（送信対象0人）");
    return NextResponse.json({
      ok: true,
      message: "送信対象がいません",
      successCount: 0,
      failureCount: 0,
    });
  }

  /** 管理者一覧の並び替え用（当日出勤の早い順）。未パースは末尾 */
  const minutesFromScheduledTime = (
    time: string | null | undefined
  ): number => {
    if (!time) return Number.MAX_SAFE_INTEGER;
    const m = String(time).match(/^(\d{1,2}):(\d{2})/);
    if (!m) return Number.MAX_SAFE_INTEGER;
    return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
  };

  // 4. 各キャストへ Push 送信（2フェーズで壁時計を短縮）
  // 1) LINE Push のみ Promise.allSettled で全件同時に実行
  // 2) 送信成功分のみ Promise.all で last_reminded_at を並列更新（二重送信防止）
  const nowIso = new Date().toISOString();
  const lineResults = await Promise.allSettled(
    schedules.map(async (schedule) => {
      const rawCasts = schedule.casts as
        | { name: string; line_user_id: string }
        | { name: string; line_user_id: string }[]
        | null;
      const casts = Array.isArray(rawCasts) ? rawCasts[0] : rawCasts;
      if (!casts?.line_user_id) {
        throw new Error(`No line_user_id for schedule ${schedule.id}`);
      }
      const name = casts.name ?? "キャスト";
      const scheduledTime = formatRemindScheduledTime(
        schedule.scheduled_time,
        schedule.is_dohan
      );
      const bodyText = applyReminderMessageTemplate(
        messageTemplate,
        name,
        scheduledTime
      );
      const message = buildAttendanceRemindFlexMessage(bodyText);

      console.log(
        "[Remind] 送信先:",
        name,
        "| 組み立てメッセージ:",
        bodyText
      );

      await sendPushMessage(casts.line_user_id, channelAccessToken, [message]);
      return schedule;
    })
  );

  const lineSucceeded = lineResults
    .map((r) => (r.status === "fulfilled" ? r.value : null))
    .filter((s): s is (typeof schedules)[number] => s != null);

  if (lineSucceeded.length > 0) {
    await Promise.all(
      lineSucceeded.map(async (schedule) => {
        const { error: updateError } = await supabase
          .from("attendance_schedules")
          .update({ last_reminded_at: nowIso })
          .eq("id", schedule.id);
        if (updateError) {
          logError(
            `last_reminded_at 更新失敗 scheduleId=${schedule.id}`,
            updateError
          );
        }
      })
    );
  }

  const successCount = lineSucceeded.length;
  const failureCount = lineResults.filter((r) => r.status === "rejected").length;

  if (failureCount > 0) {
    lineResults.forEach((r, i) => {
      if (r.status === "rejected") {
        console.error("[Remind] Full Error details:", r.reason);
        const schedule = schedules[i];
        const raw = schedule.casts as
          | { name?: string; line_user_id?: string }
          | { name?: string; line_user_id?: string }[]
          | null;
        const cast = Array.isArray(raw) ? raw[0] : raw;
        const lineUserId = cast?.line_user_id ?? "unknown";
        logError(
          `LINE Push 送信失敗 scheduleId=${schedule.id} lineUserId=${lineUserId}`,
          r.reason
        );
      }
    });
  }

  console.log(`[Remind] 送信完了 success=${successCount} failure=${failureCount}`);

  // 送信成功したキャストの名前・時刻・同伴を抽出し、管理者へ1通の完了報告を送信
  // 出勤時刻の早い順（分単位で昇順）、表示から「〜」は付けない
  const sentItems = lineSucceeded
    .map((s) => {
      const raw = s.casts as { name?: string } | { name?: string }[] | null;
      const c = Array.isArray(raw) ? raw[0] : raw;
      const name = c?.name ?? "キャスト";
      const baseTime = formatRemindScheduledTime(s.scheduled_time, false);
      const timeDisplay = `${baseTime}${s.is_dohan ? " 同伴" : ""}`.trim();
      return {
        name,
        timeDisplay,
        sortMinutes: minutesFromScheduledTime(s.scheduled_time),
      };
    })
    .sort((a, b) => a.sortMinutes - b.sortMinutes)
    .map(({ name, timeDisplay }) => ({ name, timeDisplay }));

  if (sentItems.length > 0 && channelAccessToken) {
    const storeId = schedules[0]?.store_id;
    if (storeId) {
      try {
        const adminIds = await getAdminLineUserIds(supabase, storeId);
        if (adminIds.length > 0) {
          const nameList = sentItems
            .map(({ name, timeDisplay }) => `・${name} (${timeDisplay})`)
            .join("\n");
          const adminMessage = `【システム通知】本日、以下の${sentItems.length}名に出勤確認のリマインドを送信しました。\n${nameList}`;
          await sendMulticastMessage(adminIds, channelAccessToken, [
            { type: "text", text: adminMessage },
          ]);
          console.log("[Remind] 管理者へ送信完了報告を送信", adminIds.length, "名");
        }
      } catch (adminErr) {
        // 管理者通知失敗はメイン処理に影響させない（ログのみ）
        logError("管理者への送信完了報告失敗", adminErr);
      }
    }
  }

  return NextResponse.json({
    ok: true,
    total: schedules.length,
    successCount,
    failureCount,
  });
}
