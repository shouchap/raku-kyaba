import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { sendPushMessage } from "@/lib/line-reply";
import { getTodayJst, getCurrentHourJst } from "@/lib/date-utils";

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
 * 本日出勤予定のキャストへリマインド（Buttons Template）を送信するAPI
 *
 * GET /api/remind で呼び出し。
 * system_settings の reminder_config に従い、有効時かつ送信時刻一致時のみ送信。
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

  // 3. 時刻チェック: manual=true でなければ、現在の JST の「時」と sendTime の「時」が一致する場合のみ送信
  const sendTime = config.sendTime ?? "12:00";
  const configuredHour = parseInt(sendTime.split(":")[0] ?? "12", 10);
  const currentHourJst = getCurrentHourJst();

  if (!isManual) {
    if (currentHourJst !== configuredHour) {
      console.log(
        `[Remind] 送信時刻外のためスキップ（設定: ${sendTime}、現在: ${currentHourJst}:xx JST）`
      );
      return NextResponse.json({
        ok: true,
        message: `Not send time (config: ${sendTime}, now: ${currentHourJst}:xx JST)`,
        successCount: 0,
        failureCount: 0,
      });
    }
    console.log(
      `[Remind] 設定に従い、${configuredHour}時（JST）のリマインドを開始します`
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

  // 本日の出勤予定を取得（休み＝scheduled_time が null/空 は除外、casts と JOIN）
  const { data: rawSchedules, error } = await supabase
    .from("attendance_schedules")
    .select("*, casts(name, line_user_id)")
    .eq("scheduled_date", today)
    .not("scheduled_time", "is", null);

  if (error) {
    console.error("[Remind] Supabase error:", error);
    return NextResponse.json(
      { error: "Failed to fetch schedules", details: error.message },
      { status: 500 }
    );
  }

  // 休み（—）: scheduled_time が空文字のレコードも除外
  const schedules = (rawSchedules ?? []).filter((s) => {
    const t = s.scheduled_time;
    return t != null && String(t).trim() !== "";
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
    const result = template
      .replace(/\{name\}/g, name)
      .replace(/\{time\}/g, time);
    return result;
  };

  // 各キャストへ Push 送信（並列処理、1件失敗しても他は続行）
  const results = await Promise.allSettled(
    schedules.map(async (schedule) => {
      const casts = schedule.casts as { name: string; line_user_id: string } | null;
      if (!casts?.line_user_id) {
        throw new Error(`No line_user_id for schedule ${schedule.id}`);
      }
      const name = casts.name ?? "キャスト";
      const scheduledTime = formatTime(schedule.scheduled_time);
      const text = applyTemplate(messageTemplate, name, scheduledTime);

      const message = {
        type: "template" as const,
        altText: `${name}さん、本日の出勤確認をお願いします`,
        template: {
          type: "buttons" as const,
          text,
          actions: [
            { type: "postback" as const, label: "出勤", data: "attending", displayText: "出勤" },
            { type: "postback" as const, label: "遅刻", data: "late", displayText: "遅刻" },
            { type: "postback" as const, label: "欠勤", data: "absent", displayText: "欠勤" },
          ],
        },
      };

      await sendPushMessage(casts.line_user_id, channelAccessToken, [message]);
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
