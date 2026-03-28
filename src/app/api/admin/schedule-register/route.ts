import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { sendPushMessage } from "@/lib/line-reply";
import {
  applyReminderMessageTemplate,
  buildAttendanceRemindFlexMessage,
  formatRemindScheduledTime,
} from "@/lib/attendance-remind-flex";
import { fetchReminderMessageTemplate } from "@/lib/reminder-config";
import { assertStoreIdMatchesRequest } from "@/lib/current-store";
import { fetchResolvedLineChannelAccessTokenForStore } from "@/lib/line-channel-token";

export const dynamic = "force-dynamic";

/**
 * 単日シフト登録。オプションで Cron と同一フォーマットの出勤確認 Flex を Push 送信。
 * LINE 失敗時も DB 登録はロールバックしない。
 */
export async function POST(request: Request) {
  const cookieStore = await cookies();
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    return NextResponse.json(
      { error: "Supabase is not configured" },
      { status: 500 }
    );
  }

  const supabase = createServerClient(supabaseUrl, supabaseKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          );
        } catch {
          // ignore
        }
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: {
    storeId?: string;
    castId?: string;
    scheduledDate?: string;
    scheduledTime?: string;
    isDohan?: boolean;
    sendImmediateLine?: boolean;
  };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const {
    storeId,
    castId,
    scheduledDate,
    scheduledTime,
    isDohan,
    sendImmediateLine,
  } = body;

  if (!storeId || !castId || !scheduledDate || scheduledTime == null || scheduledTime === "") {
    return NextResponse.json(
      {
        error:
          "storeId, castId, scheduledDate, scheduledTime are required",
      },
      { status: 400 }
    );
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(scheduledDate)) {
    return NextResponse.json(
      { error: "scheduledDate must be YYYY-MM-DD" },
      { status: 400 }
    );
  }

  try {
    assertStoreIdMatchesRequest(request, storeId);
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { data: insertRow, error: insertError } = await supabase
    .from("attendance_schedules")
    .insert({
      store_id: storeId,
      cast_id: castId,
      scheduled_date: scheduledDate,
      scheduled_time: scheduledTime,
      is_dohan: Boolean(isDohan),
    })
    .select("id")
    .single();

  if (insertError) {
    console.error("[schedule-register] insert error:", insertError);
    return NextResponse.json(
      { error: insertError.message, code: insertError.code },
      { status: 400 }
    );
  }

  const scheduleId = insertRow.id as string;

  if (!sendImmediateLine) {
    return NextResponse.json({
      ok: true,
      scheduleId,
      lineSent: false,
    });
  }

  const tokenResult = await fetchResolvedLineChannelAccessTokenForStore(
    supabase,
    storeId,
    "[schedule-register]"
  );
  if (!tokenResult) {
    return NextResponse.json({
      ok: true,
      scheduleId,
      lineSent: false,
      lineWarning:
        "stores.line_channel_access_token および環境変数 LINE_CHANNEL_ACCESS_TOKEN が未設定のため送信できませんでした（登録は完了しています）",
    });
  }
  const channelAccessToken = tokenResult.token;

  const { data: cast, error: castError } = await supabase
    .from("casts")
    .select("line_user_id, name")
    .eq("id", castId)
    .eq("store_id", storeId)
    .maybeSingle();

  if (castError) {
    console.error("[schedule-register] cast fetch:", castError);
    return NextResponse.json({
      ok: true,
      scheduleId,
      lineSent: false,
      lineWarning: `キャスト情報の取得に失敗しました: ${castError.message}`,
    });
  }

  const lineUserId = cast?.line_user_id?.trim();
  if (!lineUserId) {
    return NextResponse.json({
      ok: true,
      scheduleId,
      lineSent: false,
      lineWarning:
        "line_user_id がありません（登録は完了しています）。LINE連携を確認してください。",
    });
  }

  let messageTemplate: string;
  try {
    messageTemplate = await fetchReminderMessageTemplate(supabase, storeId);
  } catch (e) {
    console.error("[schedule-register] template fetch:", e);
    messageTemplate =
      "{name}さん、本日は {time} 出勤予定です。出勤確認をお願いいたします。";
  }

  const timeStr = formatRemindScheduledTime(scheduledTime, isDohan);
  const bodyText = applyReminderMessageTemplate(
    messageTemplate,
    cast?.name ?? "キャスト",
    timeStr
  );
  const flex = buildAttendanceRemindFlexMessage(bodyText);

  try {
    await sendPushMessage(lineUserId, channelAccessToken, [flex]);
  } catch (lineErr) {
    console.error("[schedule-register] LINE send failed:", lineErr);
    const msg =
      lineErr instanceof Error ? lineErr.message : "LINE送信に失敗しました";
    return NextResponse.json({
      ok: true,
      scheduleId,
      lineSent: false,
      lineWarning: `${msg}（登録は完了しています）`,
    });
  }

  const nowIso = new Date().toISOString();
  const { error: updateErr } = await supabase
    .from("attendance_schedules")
    .update({ last_reminded_at: nowIso })
    .eq("id", scheduleId);

  if (updateErr) {
    console.error("[schedule-register] last_reminded_at update:", updateErr);
  }

  return NextResponse.json({
    ok: true,
    scheduleId,
    lineSent: true,
  });
}
