import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { sendPushMessage } from "@/lib/line-reply";

/**
 * 日本時間（JST）の「今日」を YYYY-MM-DD で返す
 */
function getTodayJst(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Tokyo" });
}

/**
 * 本日出勤予定のキャストへリマインド（Buttons Template）を送信するAPI
 *
 * GET /api/remind で呼び出し。
 * Vercel Cron で毎日12:00（JST）に実行される想定。
 */
export async function GET() {
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
  const today = getTodayJst();

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

  // 各キャストへ Push 送信（並列処理、1件失敗しても他は続行）
  const results = await Promise.allSettled(
    schedules.map(async (schedule) => {
      const casts = schedule.casts as { name: string; line_user_id: string } | null;
      if (!casts?.line_user_id) {
        throw new Error(`No line_user_id for schedule ${schedule.id}`);
      }
      const name = casts.name ?? "キャスト";
      const scheduledTime = formatTime(schedule.scheduled_time);

      const message = {
        type: "template" as const,
        altText: `${name}さん、本日の出勤確認をお願いします`,
        template: {
          type: "buttons" as const,
          text: `${name}さん、本日は ${scheduledTime} 出勤予定です。出勤確認をお願いいたします。`,
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

  return NextResponse.json({
    ok: true,
    total: schedules.length,
    successCount,
    failureCount,
  });
}
