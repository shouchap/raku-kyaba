"use server";

import { redirect } from "next/navigation";
import { createServiceRoleClient } from "@/lib/supabase-service";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { isValidStoreId } from "@/lib/current-store";
import { TIME_OPTIONS_REQUIRED } from "@/lib/time-options";
import { SHIFT_TIME_OFF } from "./constants";
import type { SubmitShiftState } from "./types";

const ALLOWED_TIMES = new Set(TIME_OPTIONS_REQUIRED.map((o) => o.value));

function normalizeTime(raw: string): string | null {
  const t = raw.trim();
  if (!t || t === SHIFT_TIME_OFF) return null;
  if (!ALLOWED_TIMES.has(t)) return null;
  return `${t}:00`;
}

export async function submitShiftAction(
  _prevState: SubmitShiftState,
  formData: FormData
): Promise<SubmitShiftState> {
  const storeId = formData.get("storeId")?.toString().trim() ?? "";
  const castId = formData.get("castId")?.toString().trim() ?? "";
  const datesJson = formData.get("datesJson")?.toString() ?? "[]";

  if (!isValidStoreId(storeId)) {
    return { error: "店舗IDが不正です。" };
  }
  if (!castId) {
    return { error: "自分の名前を選択してください。" };
  }

  let dates: string[];
  try {
    dates = JSON.parse(datesJson) as string[];
  } catch {
    return { error: "送信データが不正です。" };
  }
  if (
    !Array.isArray(dates) ||
    dates.length !== 7 ||
    !dates.every((d) => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d))
  ) {
    return { error: "日付データが不正です。" };
  }

  let admin: ReturnType<typeof createServiceRoleClient>;
  try {
    admin = createServiceRoleClient();
  } catch (e) {
    console.error("[submitShiftAction] service role:", e);
    return { error: "サーバー設定エラーです。" };
  }

  const { data: storeRow, error: storeErr } = await admin
    .from("stores")
    .select("allow_shift_submission")
    .eq("id", storeId)
    .maybeSingle();

  if (storeErr || !storeRow) {
    return { error: "店舗を取得できませんでした。" };
  }
  if (storeRow.allow_shift_submission !== true) {
    return { error: "この店舗はシフト提出を受け付けていません。" };
  }

  const { data: castRow, error: castErr } = await admin
    .from("casts")
    .select("id")
    .eq("id", castId)
    .eq("store_id", storeId)
    .eq("is_active", true)
    .maybeSingle();

  if (castErr || !castRow) {
    return { error: "指定のキャストが見つかりません。" };
  }

  const rowsToInsert: Array<{
    store_id: string;
    cast_id: string;
    scheduled_date: string;
    scheduled_time: string;
    is_dohan: boolean;
    is_sabaki: boolean;
  }> = [];

  for (const d of dates) {
    const raw = formData.get(`time_${d}`)?.toString() ?? "";
    const normalized = normalizeTime(raw);
    if (normalized) {
      rowsToInsert.push({
        store_id: storeId,
        cast_id: castId,
        scheduled_date: d,
        scheduled_time: normalized,
        is_dohan: false,
        is_sabaki: false,
      });
    }
  }

  const { error: delErr } = await admin
    .from("attendance_schedules")
    .delete()
    .eq("store_id", storeId)
    .eq("cast_id", castId)
    .in("scheduled_date", dates);

  if (delErr) {
    console.error("[submitShiftAction] delete:", delErr);
    return { error: "既存の予定の更新準備に失敗しました。" };
  }

  if (rowsToInsert.length > 0) {
    const { error: insErr } = await admin.from("attendance_schedules").insert(rowsToInsert);
    if (insErr) {
      console.error("[submitShiftAction] insert:", insErr);
      return { error: "シフトの保存に失敗しました。" };
    }
  }

  let loggedIn = false;
  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    loggedIn = Boolean(user);
  } catch {
    loggedIn = false;
  }

  if (loggedIn) {
    redirect("/admin/view?shiftSubmitted=1");
  }
  redirect(`/admin/view/submit?storeId=${encodeURIComponent(storeId)}&success=1`);
}
