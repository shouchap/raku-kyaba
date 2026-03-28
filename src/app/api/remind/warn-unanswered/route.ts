/**
 * リマインド未対応者エスカレーション API
 *
 * 本日シフトでリマインド送信済みだが未返信のまま、設定時間（デフォルト2時間）経過したキャストを抽出し、
 * 管理者へ店舗の LINE 公式アカウントから通知する。Cron 等で定期実行想定。
 *
 * GET /api/remind/warn-unanswered
 * - エスカレーション待ち時間: system_settings.reminder_config の
 *   `warn_unanswered_hours_after_remind` または `escalation_hours_after_remind`（数値・時間）、
 *   なければ環境変数 WARN_UNANSWERED_HOURS_AFTER_REMIND、なければ 2 時間
 */

import { NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { sendMulticastMessage } from "@/lib/line-reply";
import { fetchResolvedLineChannelAccessTokenForStore } from "@/lib/line-channel-token";
import { getTodayJst } from "@/lib/date-utils";
import { resolveActiveStoreIdFromRequest } from "@/lib/current-store";

export const dynamic = "force-dynamic";

const REMINDER_CONFIG_KEY = "reminder_config";

/** リマインド送信からこの時間経過後にエスカレーション（設定・環境変数が無い場合） */
const DEFAULT_ESCALATION_HOURS_AFTER_REMIND = 2;

/** 1〜168 時間の範囲でクリップ */
const MIN_ESCALATION_HOURS = 1;
const MAX_ESCALATION_HOURS = 168;

/** メッセージに列挙する最大人数（LINE 文字数対策） */
const MAX_NAMES_IN_MESSAGE = 15;

type OverdueSchedule = {
  id: string;
  cast_id: string;
  store_id: string;
  scheduled_date: string;
  cast_name: string;
  /** 表示用 "21:00" */
  timeDisplay: string;
};

/**
 * reminder_config JSON または環境変数から「リマインド送信後 N 時間でエスカレーション」を取得
 */
async function getEscalationHoursAfterRemind(
  supabase: SupabaseClient,
  storeId: string
): Promise<number> {
  const { data: row } = await supabase
    .from("system_settings")
    .select("value")
    .eq("store_id", storeId)
    .eq("key", REMINDER_CONFIG_KEY)
    .maybeSingle();

  const config = (row?.value ?? {}) as Record<string, unknown>;
  const raw =
    config.warn_unanswered_hours_after_remind ?? config.escalation_hours_after_remind;

  const parseNum = (v: unknown): number | null => {
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string" && v.trim()) {
      const n = parseFloat(v.trim());
      if (!Number.isNaN(n)) return n;
    }
    return null;
  };

  const fromConfig = parseNum(raw);
  if (fromConfig != null && fromConfig > 0) {
    return clampEscalationHours(fromConfig);
  }

  const envRaw = process.env.WARN_UNANSWERED_HOURS_AFTER_REMIND?.trim();
  if (envRaw) {
    const n = parseFloat(envRaw);
    if (!Number.isNaN(n) && n > 0) return clampEscalationHours(n);
  }

  return DEFAULT_ESCALATION_HOURS_AFTER_REMIND;
}

function clampEscalationHours(n: number): number {
  const floor = Math.floor(n);
  return Math.min(MAX_ESCALATION_HOURS, Math.max(MIN_ESCALATION_HOURS, floor));
}

/** DB の TIME / 文字列から "HH:mm" */
function formatScheduledTimeDisplay(scheduledTime: string | null | undefined): string {
  if (scheduledTime == null || scheduledTime === "") return "—";
  const m = String(scheduledTime).match(/^(\d{1,2}):(\d{2})/);
  if (!m) return "—";
  const hh = m[1].padStart(2, "0");
  const mm = m[2];
  return `${hh}:${mm}`;
}

/**
 * 抽出: リマインド送信から N 時間経過 ＆ 未返信 ＆ 未警告の本日シフト
 *
 * - last_reminded_at が N 時間より前
 * - admin_warned_at IS NULL
 * - scheduled_time あり、is_action_completed が true でない
 * - attendance_logs に当日回答が無い
 */
async function fetchOverdueUnansweredSchedules(
  supabase: SupabaseClient,
  today: string,
  storeId: string,
  escalationHours: number
): Promise<OverdueSchedule[]> {
  const cutoff = new Date(
    Date.now() - escalationHours * 60 * 60 * 1000
  ).toISOString();

  const { data: schedules, error: schedError } = await supabase
    .from("attendance_schedules")
    .select(
      "id, cast_id, store_id, scheduled_date, scheduled_time, last_reminded_at, admin_warned_at, is_action_completed, response_status, casts(name)"
    )
    .eq("store_id", storeId)
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
    .eq("store_id", storeId)
    .in("cast_id", castIds)
    .eq("attended_date", today);

  const respondedSet = new Set(
    (logs ?? []).map(
      (l: { cast_id: string; attended_date: string }) => `${l.cast_id}:${l.attended_date}`
    )
  );

  const result: OverdueSchedule[] = [];
  type ScheduleRow = {
    id: string;
    cast_id: string;
    store_id: string;
    scheduled_date: string;
    scheduled_time?: string | null;
    is_action_completed?: boolean;
    response_status?: string | null;
    casts?: { name: string } | { name: string }[] | null;
  };

  for (const s of schedules as ScheduleRow[]) {
    if (s.is_action_completed === true) continue;
    if (
      s.response_status === "attending" ||
      s.response_status === "late" ||
      s.response_status === "absent"
    ) {
      continue;
    }
    if (respondedSet.has(`${s.cast_id}:${s.scheduled_date}`)) continue;

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
      timeDisplay: formatScheduledTimeDisplay(s.scheduled_time),
    });
  }

  return result;
}

function buildUnansweredAlertMessage(
  items: OverdueSchedule[],
  escalationHours: number
): string {
  if (items.length === 0) return "";

  const header =
    "【未返信アラート】\n" +
    `出勤確認から${escalationHours}時間が経過しましたが、以下のキャストから返信がありません。\n`;

  const maxShow = Math.min(items.length, MAX_NAMES_IN_MESSAGE);
  const lines = items
    .slice(0, maxShow)
    .map((i) => `・${i.cast_name} (${i.timeDisplay})`)
    .join("\n");

  if (items.length <= MAX_NAMES_IN_MESSAGE) {
    return header + lines;
  }
  return header + lines + `\n・他${items.length - MAX_NAMES_IN_MESSAGE}名`;
}

/**
 * 管理者の LINE ユーザー ID（stores.admin_line_user_id と is_admin キャストをマージ・重複除去）
 */
async function getAdminRecipientLineUserIds(
  supabase: SupabaseClient,
  storeId: string
): Promise<string[]> {
  const ids = new Set<string>();

  const { data: storeRow, error: storeErr } = await supabase
    .from("stores")
    .select("admin_line_user_id")
    .eq("id", storeId)
    .maybeSingle();

  if (!storeErr) {
    const legacy = (storeRow as { admin_line_user_id?: string | null } | null)
      ?.admin_line_user_id;
    if (legacy && String(legacy).trim() !== "") {
      ids.add(String(legacy).trim());
    }
  }

  const { data: adminCasts } = await supabase
    .from("casts")
    .select("line_user_id")
    .eq("store_id", storeId)
    .eq("is_admin", true)
    .eq("is_active", true)
    .not("line_user_id", "is", null);

  for (const r of adminCasts ?? []) {
    const id = (r as { line_user_id?: string }).line_user_id;
    if (id && String(id).trim() !== "") ids.add(String(id).trim());
  }

  return [...ids];
}

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

export async function GET(request: Request) {
  const supabaseUrl =
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const supabaseKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    return NextResponse.json(
      { error: "Supabase URL or key is not configured" },
      { status: 500 }
    );
  }

  const supabase = createClient(supabaseUrl, supabaseKey);
  const today = getTodayJst();

  let tenantStoreId: string;
  try {
    tenantStoreId = resolveActiveStoreIdFromRequest(request);
  } catch (e) {
    return NextResponse.json(
      {
        error: "Tenant not configured",
        details: e instanceof Error ? e.message : String(e),
      },
      { status: 500 }
    );
  }

  try {
    const escalationHours = await getEscalationHoursAfterRemind(
      supabase,
      tenantStoreId
    );

    const overdue = await fetchOverdueUnansweredSchedules(
      supabase,
      today,
      tenantStoreId,
      escalationHours
    );

    if (overdue.length === 0) {
      console.log("[WarnUnanswered] 該当者なし escalationHours=", escalationHours);
      return NextResponse.json({
        ok: true,
        message: "該当者なし",
        warnedCount: 0,
        escalationHoursAfterRemind: escalationHours,
      });
    }

    const storeIds = [...new Set(overdue.map((o) => o.store_id))];

    let warnedCount = 0;
    const errors: string[] = [];

    for (const storeId of storeIds) {
      const storeOverdue = overdue.filter((o) => o.store_id === storeId);
      const storeEscalationHours = await getEscalationHoursAfterRemind(
        supabase,
        storeId
      );
      const adminIds = await getAdminRecipientLineUserIds(supabase, storeId);

      if (adminIds.length === 0) {
        console.warn("[WarnUnanswered] 管理者不在 storeId=", storeId);
        continue;
      }

      const tokenResult = await fetchResolvedLineChannelAccessTokenForStore(
        supabase,
        storeId,
        "[WarnUnanswered]"
      );
      if (!tokenResult) {
        console.warn(
          "[WarnUnanswered] 店舗の LINE トークンなし（stores または LINE_CHANNEL_ACCESS_TOKEN） storeId=",
          storeId
        );
        errors.push(`store ${storeId}: no LINE channel access token`);
        continue;
      }

      const text = buildUnansweredAlertMessage(storeOverdue, storeEscalationHours);

      try {
        await sendMulticastMessage(adminIds, tokenResult.token, [
          { type: "text", text },
        ]);
      } catch (sendErr) {
        console.error("[WarnUnanswered] LINE送信失敗 storeId=", storeId, sendErr);
        errors.push(
          `store ${storeId}: ${sendErr instanceof Error ? sendErr.message : String(sendErr)}`
        );
        continue;
      }

      await markSchedulesAsWarned(
        supabase,
        storeOverdue.map((o) => o.id)
      );
      warnedCount += storeOverdue.length;
    }

    if (warnedCount === 0 && errors.length > 0) {
      return NextResponse.json(
        {
          ok: false,
          error: "LINE送信できた店舗がありません",
          details: errors,
        },
        { status: 500 }
      );
    }

    console.log(
      "[WarnUnanswered] 通知完了 warnedCount=",
      warnedCount,
      "errors=",
      errors.length
    );
    return NextResponse.json({
      ok: true,
      message:
        errors.length > 0 ? "一部完了（トークン不足等でスキップあり）" : "通知完了",
      warnedCount,
      escalationHoursAfterRemind: escalationHours,
      ...(errors.length > 0 ? { partialErrors: errors } : {}),
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
