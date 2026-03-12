import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { sendPushMessage } from "@/lib/line-reply";
import { getTodayJst, getCurrentTimeJst } from "@/lib/date-utils";

/** キャッシュ無効化: 毎回最新のDB値を取得する */
export const dynamic = "force-dynamic";

type ReminderConfig = {
  enabled?: boolean;
  sendTime?: string;
  messageTemplate?: string;
};

/** DBに未設定の場合のフォールバック（空文字時のみ使用） */
const DEFAULT_TEMPLATE =
  "{name}さん、本日は {time} 出勤予定です。出勤確認をお願いいたします。";

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
  const url = new URL(request.url);
  const isManual = url.searchParams.get("manual") === "true";
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
    console.error("[Remind] Failed to fetch reminder_config:", settingsError);
    return NextResponse.json(
      { error: "Failed to fetch settings", details: settingsError.message },
      { status: 500 }
    );
  }

  const config = (settingsRow?.value ?? {}) as ReminderConfig;

  // DBから取得したテンプレートをログ出力（デバッグ用）
  console.log("[Remind] DBから取得したテンプレート:", config.messageTemplate ?? "(未設定)");

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

  // 3. 時刻チェック: manual=true でなければ、設定時刻から15分以内の場合のみ送信（15分おきCron想定）
  const sendTime = config.sendTime ?? "12:00";
  const [configHourStr, configMinStr] = sendTime.split(":");
  const configuredHour = parseInt(configHourStr ?? "12", 10);
  const configuredMin = parseInt(configMinStr ?? "0", 10);
  const configuredMinutesSinceMidnight = configuredHour * 60 + configuredMin;

  const { hour: currentHour, minute: currentMin } = getCurrentTimeJst();
  const currentMinutesSinceMidnight = currentHour * 60 + currentMin;

  if (!isManual) {
    const windowStart = configuredMinutesSinceMidnight;
    const windowEnd = configuredMinutesSinceMidnight + 15;
    const inWindow =
      currentMinutesSinceMidnight >= windowStart &&
      currentMinutesSinceMidnight < windowEnd;

    if (!inWindow) {
      console.log(
        `[Remind] 送信時刻外のためスキップ（設定: ${sendTime}、現在: ${String(currentHour).padStart(2, "0")}:${String(currentMin).padStart(2, "0")} JST、窓: ${sendTime}〜15分以内）`
      );
      return NextResponse.json({
        ok: true,
        message: `Not send time (config: ${sendTime}, now: ${currentHour}:${currentMin} JST)`,
        successCount: 0,
        failureCount: 0,
      });
    }
    console.log(
      `[Remind] 設定に従い、${sendTime}（JST）の15分窓内のリマインドを開始します`
    );
  } else {
    console.log("[Remind] 手動テスト送信（manual=true）を開始します");
  }

  const today = getTodayJst();
  // 必ずDBの最新値を使用。空の場合のみフォールバック
  const messageTemplate =
    (config.messageTemplate && config.messageTemplate.trim() !== "")
      ? config.messageTemplate.trim()
      : DEFAULT_TEMPLATE;

  console.log("[Remind] 使用するテンプレート:", messageTemplate);

  // 本日の出勤予定を取得（休み＝scheduled_time が null/空 は除外、casts と JOIN、last_reminded_at 含む）
  const { data: rawSchedules, error } = await supabase
    .from("attendance_schedules")
    .select("id, cast_id, store_id, scheduled_date, scheduled_time, last_reminded_at, casts(name, line_user_id)")
    .eq("scheduled_date", today)
    .not("scheduled_time", "is", null);

  if (error) {
    console.error("[Remind] Supabase error:", error);
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

  if (schedules.length === 0) {
    console.log("[Remind] 本日の出勤予定はありません");
    return NextResponse.json({
      ok: true,
      message: "No schedules for today",
      successCount: 0,
      failureCount: 0,
    });
  }

  // "20:00:00" -> "20:00" 形式に整形
  const formatTime = (time: string | null | undefined): string => {
    if (!time) return "営業時間";
    const match = String(time).match(/^(\d{1,2}):(\d{2})/);
    return match ? `${match[1]}:${match[2]}` : "営業時間";
  };

  // 4. テンプレートの {name} / {time} を置換（DBから取得したテンプレートに対して実行）
  const applyTemplate = (
    template: string,
    name: string,
    time: string
  ): string => {
    return template
      .replace(/\{name\}/g, name)
      .replace(/\{time\}/g, time);
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
      const rawCasts = schedule.casts as
        | { name: string; line_user_id: string }
        | { name: string; line_user_id: string }[]
        | null;
      const casts = Array.isArray(rawCasts) ? rawCasts[0] : rawCasts;
      if (!casts?.line_user_id) {
        throw new Error(`No line_user_id for schedule ${schedule.id}`);
      }
      const name = casts.name ?? "キャスト";
      const scheduledTime = formatTime(schedule.scheduled_time);
      const bodyText = applyTemplate(messageTemplate, name, scheduledTime);
      const message = createAttendanceFlexMessage(bodyText);

      await sendPushMessage(casts.line_user_id, channelAccessToken, [message]);

      // 送信成功: last_reminded_at を更新（二重送信防止）
      const { error: updateError } = await supabase
        .from("attendance_schedules")
        .update({ last_reminded_at: nowIso })
        .eq("id", schedule.id);
      if (updateError) {
        console.error("[Remind] last_reminded_at 更新失敗:", schedule.id, updateError);
      }
    })
  );

  const successCount = results.filter((r) => r.status === "fulfilled").length;
  const failureCount = results.filter((r) => r.status === "rejected").length;

  if (failureCount > 0) {
    const failures = results
      .map((r, i) => (r.status === "rejected" ? { index: i, reason: r.reason } : null))
      .filter(Boolean);
    console.error("[Remind] Some sends failed:", failures);
  }

  console.log(`[Remind] 送信完了 success=${successCount} failure=${failureCount}`);

  return NextResponse.json({
    ok: true,
    total: schedules.length,
    successCount,
    failureCount,
  });
}
