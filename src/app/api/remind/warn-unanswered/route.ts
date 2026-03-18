/**
 * リマインド未対応者アラートバッチ API
 *
 * リマインド送信から5時間経過しても出勤確認を行っていないキャストを抽出し、
 * 管理者にLINEで通知する。Cronなどで定期的に呼び出す想定。
 *
 * GET /api/remind/warn-unanswered
 * - Cronから呼び出す場合は Authorization ヘッダーやクエリパラメータで保護推奨
 */

import { NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { sendMulticastMessage } from "@/lib/line-reply";
import { getTodayJst } from "@/lib/date-utils";

export const dynamic = "force-dynamic";

/** リマインドからアラートを出すまでの経過時間（時間） */
const ALERT_HOURS = 5;

/** メッセージに列挙する最大人数。超えた場合は「他N名」で省略（LINE文字数制限対策） */
const MAX_NAMES_IN_MESSAGE = 15;

type OverdueSchedule = {
  id: string;
  cast_id: string;
  store_id: string;
  scheduled_date: string;
  cast_name: string;
};

/**
 * 抽出: リマインドから5時間以上経過＆未返信＆未警告のスケジュールを取得
 *
 * 条件:
 * - last_reminded_at が 5時間以上前（last_reminded_at < now - 5h）
 * - attendance_logs に該当日の回答が存在しない（未返信）
 * - admin_warned_at が null（警告未送信）
 */
async function fetchOverdueUnansweredSchedules(
  supabase: SupabaseClient,
  today: string
): Promise<OverdueSchedule[]> {
  const cutoff = new Date(Date.now() - ALERT_HOURS * 60 * 60 * 1000).toISOString();

  // is_action_completed=false のスケジュールのみ対象（回答済みは除外）
  // 旧データ互換: attendance_logs の respondedSet でも二重チェック
  const { data: schedules, error: schedError } = await supabase
    .from("attendance_schedules")
    .select("id, cast_id, store_id, scheduled_date, last_reminded_at, admin_warned_at, is_action_completed, casts(name)")
    .eq("scheduled_date", today)
    .not("last_reminded_at", "is", null)
    .lt("last_reminded_at", cutoff)
    .is("admin_warned_at", null)
    .not("scheduled_time", "is", null)
    .or("is_action_completed.eq.false,is_action_completed.is.null");

  if (schedError) {
    throw new Error(`schedules fetch error: ${schedError.message}`);
  }

  if (!schedules || schedules.length === 0) return [];

  const castIds = (schedules as Array<{ cast_id: string }>).map((s) => s.cast_id);

  const { data: logs } = await supabase
    .from("attendance_logs")
    .select("cast_id, attended_date")
    .in("cast_id", castIds)
    .eq("attended_date", today);

  const respondedSet = new Set(
    (logs ?? []).map((l: { cast_id: string; attended_date: string }) => `${l.cast_id}:${l.attended_date}`)
  );

  const result: OverdueSchedule[] = [];
  type ScheduleRow = {
    id: string;
    cast_id: string;
    store_id: string;
    scheduled_date: string;
    is_action_completed?: boolean;
    casts?: { name: string } | { name: string }[] | null;
  };
  for (const s of schedules as ScheduleRow[]) {
    // 二重チェック: is_action_completed または attendance_logs で回答済みなら除外
    const completed = s.is_action_completed === true;
    if (completed || respondedSet.has(`${s.cast_id}:${s.scheduled_date}`)) continue;
    const raw = s.casts;
    const castName = raw
      ? Array.isArray(raw)
        ? raw[0]?.name ?? "不明"
        : (raw as { name?: string }).name ?? "不明"
      : "不明";
    result.push({
      id: s.id,
      cast_id: s.cast_id,
      store_id: s.store_id,
      scheduled_date: s.scheduled_date,
      cast_name: castName,
    });
  }

  return result;
}

/**
 * 通知メッセージ本文を組み立て
 * 大人数時は「他N名」で省略してLINE文字数制限を回避
 */
function buildWarningMessage(items: OverdueSchedule[]): string {
  if (items.length === 0) return "";

  const header = "【警告】以下のユーザーがリマインドから5時間経過しても未対応です。\n";
  const maxShow = Math.min(items.length, MAX_NAMES_IN_MESSAGE);
  const lines = items
    .slice(0, maxShow)
    .map((i) => `・${i.cast_name}`)
    .join("\n");

  if (items.length <= MAX_NAMES_IN_MESSAGE) {
    return header + lines;
  }
  return header + lines + `\n・他${items.length - MAX_NAMES_IN_MESSAGE}名`;
}

/**
 * 管理者の line_user_id 一覧を取得（casts.is_admin または stores.admin_line_user_id）
 */
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
    .filter((id: string | undefined): id is string => !!id && id.trim() !== "");

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
 * 指定スケジュールの admin_warned_at を更新（二重通知防止）
 */
async function markSchedulesAsWarned(
  supabase: SupabaseClient,
  scheduleIds: string[]
): Promise<void> {
  if (scheduleIds.length === 0) return;

  const now = new Date().toISOString();
  const { error } = await supabase
    .from("attendance_schedules")
    .update({ admin_warned_at: now })
    .in("id", scheduleIds);

  if (error) {
    throw new Error(`admin_warned_at update error: ${error.message}`);
  }
}

export async function GET() {
  const supabaseUrl =
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const supabaseKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
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

  try {
    const overdue = await fetchOverdueUnansweredSchedules(supabase, today);

    if (overdue.length === 0) {
      console.log("[WarnUnanswered] 該当者なし");
      return NextResponse.json({
        ok: true,
        message: "該当者なし",
        warnedCount: 0,
      });
    }

    const storeIds = [...new Set(overdue.map((o) => o.store_id))];

    for (const storeId of storeIds) {
      const storeOverdue = overdue.filter((o) => o.store_id === storeId);
      const adminIds = await getAdminLineUserIds(supabase, storeId);

      if (adminIds.length === 0) {
        console.warn("[WarnUnanswered] 管理者不在 storeId=", storeId);
        continue;
      }

      try {
        await sendMulticastMessage(
          adminIds,
          channelAccessToken,
          [{ type: "text", text: buildWarningMessage(storeOverdue) }]
        );
      } catch (sendErr) {
        console.error("[WarnUnanswered] LINE送信失敗:", sendErr);
        return NextResponse.json(
          {
            error: "LINE送信失敗",
            details: sendErr instanceof Error ? sendErr.message : String(sendErr),
          },
          { status: 500 }
        );
      }

      await markSchedulesAsWarned(
        supabase,
        storeOverdue.map((o) => o.id)
      );
    }

    console.log("[WarnUnanswered] 通知完了 count=", overdue.length);
    return NextResponse.json({
      ok: true,
      message: "通知完了",
      warnedCount: overdue.length,
    });
  } catch (err) {
    console.error("[WarnUnanswered] エラー:", err);
    return NextResponse.json(
      {
        error: "Internal server error",
        details: err instanceof Error ? err.message : String(err),
      },
      { status: 500 }
    );
  }
}
