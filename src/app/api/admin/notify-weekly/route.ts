import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { sendPushMessage } from "@/lib/line-reply";

const WEEKDAY_JA = ["日", "月", "火", "水", "木", "金", "土"];

/** "2026-03-20" → "3/20(月)" */
function formatDateJa(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00");
  const m = d.getMonth() + 1;
  const day = d.getDate();
  const w = WEEKDAY_JA[d.getDay()];
  return `${m}/${day}(${w})`;
}

/** "20:00:00" → "20:00" */
function formatTime(time: string | null | undefined): string {
  if (!time) return "";
  const match = String(time).match(/^(\d{1,2}):(\d{2})/);
  return match ? `${match[1]}:${match[2]}` : "";
}

/**
 * 確定シフトを各キャストのLINEに一斉送信するAPI
 * POST /api/admin/notify-weekly
 * Body: { startDate: "2026-03-20" }
 */
export async function POST(request: Request) {
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

  let body: { startDate?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  const startDate = body.startDate;
  if (!startDate || !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
    return NextResponse.json(
      { error: "startDate is required (format: YYYY-MM-DD)" },
      { status: 400 }
    );
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  // 7日間の日付配列
  const dates: string[] = [];
  const base = new Date(startDate + "T12:00:00");
  for (let i = 0; i < 7; i++) {
    const d = new Date(base);
    d.setDate(d.getDate() + i);
    dates.push(d.toISOString().slice(0, 10));
  }

  // 店舗ID（最初の1件）
  const { data: store, error: storeError } = await supabase
    .from("stores")
    .select("id")
    .limit(1)
    .single();

  if (storeError || !store) {
    return NextResponse.json(
      { error: "Store not found" },
      { status: 500 }
    );
  }

  // 全キャスト（LINE連携あり）を取得（休みの人にも通知するため）
  const { data: allCasts, error: castsError } = await supabase
    .from("casts")
    .select("id, name, line_user_id")
    .eq("store_id", store.id)
    .eq("is_active", true)
    .not("line_user_id", "is", null);

  if (castsError) {
    console.error("[NotifyWeekly] Casts fetch error:", castsError);
    return NextResponse.json(
      { error: "Failed to fetch casts" },
      { status: 500 }
    );
  }

  if (!allCasts || allCasts.length === 0) {
    return NextResponse.json({
      ok: true,
      message: "No casts to notify",
      successCount: 0,
      failureCount: 0,
    });
  }

  // 7日間の attendance_schedules を casts と JOIN して取得
  const { data: schedules, error: scheduleError } = await supabase
    .from("attendance_schedules")
    .select("cast_id, scheduled_date, scheduled_time, casts(name, line_user_id)")
    .eq("store_id", store.id)
    .in("scheduled_date", dates);

  if (scheduleError) {
    console.error("[NotifyWeekly] Supabase error:", scheduleError);
    return NextResponse.json(
      { error: "Failed to fetch schedules" },
      { status: 500 }
    );
  }

  // cast_id ごとにスケジュールをグループ化
  type CastSchedule = {
    name: string;
    line_user_id: string;
    byDate: Record<string, string>;
  };
  const castMap = new Map<string, CastSchedule>();

  (schedules ?? []).forEach((row: Record<string, unknown>) => {
    const casts = row.casts as { name?: string; line_user_id?: string } | null;
    const lineUserId = casts?.line_user_id;
    if (!lineUserId || typeof lineUserId !== "string") return;

    const castId = row.cast_id as string;
    const scheduledDate = row.scheduled_date as string;
    const scheduledTime = row.scheduled_time as string | undefined;

    if (!castMap.has(castId)) {
      castMap.set(castId, {
        name: casts?.name ?? "キャスト",
        line_user_id: lineUserId,
        byDate: {},
      });
    }
    const entry = castMap.get(castId)!;
    entry.byDate[scheduledDate] = formatTime(scheduledTime);
  });

  // 全キャストに送信（スケジュールあり→詳細、全て休み→「来週はお休みです」）
  const results = await Promise.allSettled(
    allCasts.map(async (castRow) => {
      const lineUserId = castRow.line_user_id;
      if (!lineUserId) return;

      const scheduleEntry = castMap.get(castRow.id);
      const name = castRow.name ?? scheduleEntry?.name ?? "キャスト";

      let text: string;
      if (scheduleEntry) {
        const hasAnyShift = Object.values(scheduleEntry.byDate).some((t) => t);
        if (hasAnyShift) {
          const lines: string[] = [
            `${name}さん、来週のシフトが確定しました。`,
            "",
          ];
          dates.forEach((dateStr) => {
            const time = scheduleEntry.byDate[dateStr];
            const dateJa = formatDateJa(dateStr);
            lines.push(time ? `${dateJa}: ${time}〜` : `${dateJa}: お休み`);
          });
          lines.push("", "よろしくお願いします！");
          text = lines.join("\n");
        } else {
          text = `${name}さん、来週はお休みです。よろしくお願いします。`;
        }
      } else {
        text = `${name}さん、来週はお休みです。よろしくお願いします。`;
      }

      await sendPushMessage(lineUserId, channelAccessToken, [
        { type: "text", text },
      ]);
    })
  );

  const successCount = results.filter((r) => r.status === "fulfilled").length;
  const failureCount = results.filter((r) => r.status === "rejected").length;

  if (failureCount > 0) {
    results.forEach((r, i) => {
      if (r.status === "rejected") {
        console.error("[NotifyWeekly] Send failed for cast index", i, r.reason);
      }
    });
  }

  return NextResponse.json({
    ok: true,
    successCount,
    failureCount,
  });
}
