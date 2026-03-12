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
 * 指定キャストの1週間シフトをLINEで個別送信するAPI
 * POST /api/admin/notify-individual
 * Body: { startDate: "2026-03-20", castId: "uuid" }
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

  let body: { startDate?: string; castId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  const startDate = body.startDate;
  const castId = body.castId;
  if (!startDate || !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
    return NextResponse.json(
      { error: "startDate is required (format: YYYY-MM-DD)" },
      { status: 400 }
    );
  }
  if (!castId || typeof castId !== "string") {
    return NextResponse.json(
      { error: "castId is required" },
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

  // キャスト情報（line_user_id 必須）
  const { data: cast, error: castError } = await supabase
    .from("casts")
    .select("id, name, line_user_id, store_id")
    .eq("id", castId)
    .eq("is_active", true)
    .single();

  if (castError || !cast) {
    return NextResponse.json(
      { error: "Cast not found or inactive" },
      { status: 404 }
    );
  }

  const lineUserId = cast.line_user_id;
  if (!lineUserId) {
    return NextResponse.json(
      { error: "Cast has no LINE account linked" },
      { status: 400 }
    );
  }

  // 該当キャストの7日間シフト
  const { data: schedules } = await supabase
    .from("attendance_schedules")
    .select("scheduled_date, scheduled_time")
    .eq("cast_id", castId)
    .eq("store_id", cast.store_id)
    .in("scheduled_date", dates);

  const byDate: Record<string, string> = {};
  (schedules ?? []).forEach((row: { scheduled_date: string; scheduled_time?: string }) => {
    byDate[row.scheduled_date] = formatTime(row.scheduled_time);
  });

  const lines: string[] = [
    `${cast.name}さん、来週のシフトが確定しました。`,
    "",
  ];
  let hasShift = false;
  dates.forEach((dateStr) => {
    const time = byDate[dateStr];
    const dateJa = formatDateJa(dateStr);
    if (time) {
      hasShift = true;
      lines.push(`${dateJa}: ${time}〜`);
    } else {
      lines.push(`${dateJa}: お休み`);
    }
  });
  lines.push("", "よろしくお願いします！");

  const text = hasShift
    ? lines.join("\n")
    : `${cast.name}さん、来週はお休みです。よろしくお願いします！`;

  try {
    await sendPushMessage(lineUserId, channelAccessToken, [
      { type: "text", text },
    ]);
  } catch (err) {
    console.error("[NotifyIndividual] Send failed:", err);
    return NextResponse.json(
      { error: "Failed to send LINE message" },
      { status: 500 }
    );
  }

  return NextResponse.json({
    ok: true,
    successCount: 1,
  });
}
