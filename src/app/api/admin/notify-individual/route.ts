import { NextResponse } from "next/server";
import { sendPushMessage } from "@/lib/line-reply";
import { fetchResolvedLineChannelAccessTokenForStore } from "@/lib/line-channel-token";
import { canUserEditStore, getAuthedUserForAdminApi } from "@/lib/admin-store-auth";
import { resolveActiveStoreIdFromRequest } from "@/lib/current-store";
import { formatScheduleTimeLabel } from "@/lib/attendance-remind-flex";
import { createServiceRoleClient } from "@/lib/supabase-service";
import { addCalendarDaysJst, getTodayJst } from "@/lib/date-utils";

const WEEKDAY_JA = ["日", "月", "火", "水", "木", "金", "土"];

/** "2026-03-20" → "3/20(月)"（JST 暦日として解釈） */
function formatDateJa(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00+09:00");
  const m = d.getMonth() + 1;
  const day = d.getDate();
  const w = WEEKDAY_JA[d.getDay()];
  return `${m}/${day}(${w})`;
}

/**
 * 指定キャストの1週間シフトをLINEで個別送信するAPI
 * POST /api/admin/notify-individual
 * Body: { startDate: "2026-03-20", castId: "uuid", is_update?: boolean }
 * is_update=true: 変更通知文面 + 本日（JST）未満の日付行をメッセージから除外
 */
export async function POST(request: Request) {
  let admin: ReturnType<typeof createServiceRoleClient>;
  try {
    admin = createServiceRoleClient();
  } catch {
    return NextResponse.json(
      { error: "Server configuration error (service role)" },
      { status: 500 }
    );
  }

  let body: { startDate?: string; castId?: string; is_update?: boolean };
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
  const isUpdate = body.is_update === true;
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

  /** 日本時間の「今日」YYYY-MM-DD（文字列比較で日付判定する） */
  const todayStr = getTodayJst();

  let expectedStoreId: string;
  try {
    expectedStoreId = resolveActiveStoreIdFromRequest(request);
  } catch (e) {
    return NextResponse.json(
      {
        error: "Tenant not configured",
        details: e instanceof Error ? e.message : String(e),
      },
      { status: 500 }
    );
  }

  const { user, error: authErr } = await getAuthedUserForAdminApi();
  if (authErr === "config") {
    return NextResponse.json({ error: "Supabase is not configured" }, { status: 500 });
  }
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!canUserEditStore(user, expectedStoreId)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // 7日間の日付配列（JST 暦日の YYYY-MM-DD。toISOString では UTC 日付になり DB とずれるため addCalendarDaysJst を使用）
  const dates: string[] = [];
  for (let i = 0; i < 7; i++) {
    dates.push(addCalendarDaysJst(startDate, i));
  }

  const datesForMessage = isUpdate ? dates.filter((d) => d >= todayStr) : dates;

  // キャスト情報（line_user_id 必須）
  const { data: cast, error: castError } = await admin
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

  if (cast.store_id !== expectedStoreId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const tokenResult = await fetchResolvedLineChannelAccessTokenForStore(
    admin,
    cast.store_id,
    "[NotifyIndividual]"
  );
  if (!tokenResult) {
    return NextResponse.json(
      {
        error:
          "LINE チャネルアクセストークンがありません。stores.line_channel_access_token または環境変数 LINE_CHANNEL_ACCESS_TOKEN を設定してください。",
      },
      { status: 500 }
    );
  }
  const channelAccessToken = tokenResult.token;

  const lineUserId = cast.line_user_id;
  if (!lineUserId) {
    return NextResponse.json(
      { error: "Cast has no LINE account linked" },
      { status: 400 }
    );
  }

  // 該当キャストの7日間シフト（同伴・捌き含む）
  const { data: schedules } = await admin
    .from("attendance_schedules")
    .select("scheduled_date, scheduled_time, is_dohan, is_sabaki")
    .eq("cast_id", castId)
    .eq("store_id", cast.store_id)
    .in("scheduled_date", dates);

  const byDate: Record<string, string> = {};
  (schedules ?? []).forEach(
    (row: {
      scheduled_date: string;
      scheduled_time?: string;
      is_dohan?: boolean;
      is_sabaki?: boolean;
    }) => {
      const formatted = formatScheduleTimeLabel(
        row.scheduled_time,
        row.is_dohan,
        row.is_sabaki
      );
      byDate[row.scheduled_date] =
        formatted && formatted !== "—" ? `${formatted}〜` : "";
    }
  );

  const headerIntro = isUpdate
    ? `${cast.name}さん、今週のシフトに変更がありましたのでご確認お願いします。`
    : `${cast.name}さん、来週のシフトが確定しました。`;

  const lines: string[] = [headerIntro, ""];
  let hasShift = false;

  if (datesForMessage.length === 0) {
    lines.push("よろしくお願いします！");
  } else {
    datesForMessage.forEach((dateStr) => {
      const time = byDate[dateStr];
      const dateJa = formatDateJa(dateStr);
      if (time) {
        hasShift = true;
        lines.push(`${dateJa}: ${time}`);
      } else {
        lines.push(`${dateJa}: お休み`);
      }
    });
    lines.push("", "よろしくお願いします！");
  }

  let text: string;
  if (datesForMessage.length === 0) {
    text = lines.join("\n");
  } else if (hasShift) {
    text = lines.join("\n");
  } else if (isUpdate) {
    text = `${cast.name}さん、今週のシフトに変更がありましたのでご確認お願いします。\n\nよろしくお願いします！`;
  } else {
    text = `${cast.name}さん、来週はお休みです。よろしくお願いします！`;
  }

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
