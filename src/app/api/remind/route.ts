import { NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { sendPushMessage, sendMulticastMessage } from "@/lib/line-reply";
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
 * system_settings の reminder_config に従い、有効時かつ送信時刻一致時のみ送信。
 * メッセージは白背景カード型の Flex Message（Club GOLD 出勤確認）。
 *
 * GET /api/remind?manual=true でテスト送信（時刻チェックをスキップして即送信）
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
  const url = new URL(request.url);
  const isManual = url.searchParams.get("manual") === "true";

  // GitHub Actions からのアクセス許可: Authorization Bearer が CRON_SECRET と一致すれば処理継続
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

  // 3. Hobbyプラン（1日1回Cron）対応: 時刻枠チェックを削除。呼ばれたら未送信者へ送信。
  if (isManual) {
    console.log("[Remind] 手動テスト送信（manual=true）を開始します");
  } else {
    console.log("[Remind] Cron起動によりリマインド処理を開始します");
  }

  const today = getTodayJst();
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

  // "20:00:00" -> "20:00" 形式に整形。is_dohan が true の場合は「（同伴）」を追記
  const formatTime = (
    time: string | null | undefined,
    isDohan?: boolean | null
  ): string => {
    if (!time) return "営業時間";
    const match = String(time).match(/^(\d{1,2}):(\d{2})/);
    const base = match ? `${match[1]}:${match[2]}` : "営業時間";
    return isDohan ? `${base}（同伴）` : base;
  };

  // 4. テンプレートの {name} / {time} を置換（置換前に文字列の存在をチェック）
  const applyTemplate = (
    tpl: string,
    name: string,
    time: string
  ): string => {
    const safeTpl =
      tpl && typeof tpl === "string" ? tpl : "【Club GOLD】本日は {time} 出勤予定です。";
    return safeTpl
      .replace(/\{name\}/g, name ?? "キャスト")
      .replace(/\{time\}/g, time ?? "営業時間");
  };

  /**
   * 出勤確認用 Flex Message を生成
   * 白背景のカード型、ヘッダーにゴールド、本文はDBテンプレート、ボタンは縦並び
   */
  const createAttendanceFlexMessage = (bodyText: string) => ({
    type: "flex" as const,
    altText: `${bodyText.slice(0, 60)}${bodyText.length > 60 ? "…" : ""}\n下のボタンから選択してください。`,
    contents: {
      type: "bubble",
      header: {
        type: "box",
        layout: "vertical",
        contents: [
          {
            type: "separator",
            color: "#D4AF37",
          },
          {
            type: "text",
            text: "Club GOLD 出勤確認",
            color: "#D4AF37",
            size: "sm",
            weight: "bold",
            margin: "sm",
          },
        ],
      },
      body: {
        type: "box",
        layout: "vertical",
        contents: [
          {
            type: "text",
            text: bodyText,
            wrap: true,
            size: "md",
            color: "#333333",
          },
        ],
      },
      footer: {
        type: "box",
        layout: "vertical",
        spacing: "sm",
        contents: [
          {
            type: "button",
            style: "primary",
            color: "#2196F3",
            height: "sm",
            action: {
              type: "postback",
              label: "出勤",
              data: "attending",
              displayText: "出勤",
            },
          },
          {
            type: "button",
            style: "primary",
            color: "#FFC107",
            height: "sm",
            action: {
              type: "postback",
              label: "遅刻",
              data: "late",
              displayText: "遅刻",
            },
          },
          {
            type: "button",
            style: "primary",
            color: "#FF5252",
            height: "sm",
            action: {
              type: "postback",
              label: "欠勤",
              data: "absent",
              displayText: "欠勤",
            },
          },
        ],
      },
    },
  });

  // 各キャストへ Push 送信（並列処理、1件失敗しても他は続行）
  // 送信成功後に last_reminded_at を更新して二重送信を防止
  const nowIso = new Date().toISOString();
  const results = await Promise.allSettled(
    schedules.map(async (schedule) => {
      try {
        const rawCasts = schedule.casts as
          | { name: string; line_user_id: string }
          | { name: string; line_user_id: string }[]
          | null;
        const casts = Array.isArray(rawCasts) ? rawCasts[0] : rawCasts;
        if (!casts?.line_user_id) {
          throw new Error(`No line_user_id for schedule ${schedule.id}`);
        }
        const name = casts.name ?? "キャスト";
        const scheduledTime = formatTime(schedule.scheduled_time, schedule.is_dohan);
        const bodyText = applyTemplate(messageTemplate, name, scheduledTime);
        const message = createAttendanceFlexMessage(bodyText);

        console.log(
          "[Remind] 送信先:",
          name,
          "| 組み立てメッセージ:",
          bodyText
        );

        await sendPushMessage(casts.line_user_id, channelAccessToken, [message]);

        // 送信成功: last_reminded_at を更新（二重送信防止）
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
      } catch (err) {
        console.error("[Remind] Full Error details:", err);
        const raw = schedule.casts as
          | { name?: string; line_user_id?: string }
          | { name?: string; line_user_id?: string }[]
          | null;
        const cast = Array.isArray(raw) ? raw[0] : raw;
        const lineUserId = cast?.line_user_id ?? "unknown";
        logError(
          `LINE Push 送信失敗 scheduleId=${schedule.id} lineUserId=${lineUserId}`,
          err
        );
        throw err;
      }
    })
  );

  const successCount = results.filter((r) => r.status === "fulfilled").length;
  const failureCount = results.filter((r) => r.status === "rejected").length;

  if (failureCount > 0) {
    results.forEach((r, i) => {
      if (r.status === "rejected") {
        console.error("[Remind] Full Error details:", r.reason);
        logError(`送信失敗 [index=${i}]`, r.reason);
      }
    });
  }

  console.log(`[Remind] 送信完了 success=${successCount} failure=${failureCount}`);

  // 送信成功したキャストの名前・時刻・同伴を抽出し、管理者へ1通の完了報告を送信
  const sentItems = results
    .map((r, i) => (r.status === "fulfilled" ? schedules[i] : null))
    .filter((s): s is (typeof schedules)[number] => s != null)
    .map((s) => {
      const raw = s.casts as { name?: string } | { name?: string }[] | null;
      const c = Array.isArray(raw) ? raw[0] : raw;
      const name = c?.name ?? "キャスト";
      const baseTime = formatTime(s.scheduled_time, false);
      const timeDisplay = `${baseTime}〜${s.is_dohan ? " 同伴" : ""}`.trim();
      return { name, timeDisplay };
    });

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
