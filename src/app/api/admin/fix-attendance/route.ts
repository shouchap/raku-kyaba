import { NextResponse } from "next/server";
import { canUserEditStore, getAuthedUserForAdminApi } from "@/lib/admin-store-auth";
import { assertStoreIdMatchesRequest, isValidStoreId } from "@/lib/current-store";
import { createServiceRoleClient } from "@/lib/supabase-service";
import type { AttendanceStatus } from "@/types/database";

export const dynamic = "force-dynamic";

/**
 * ワンタイム復旧用: Webhook 欠損分を attendance_schedules（＋ logs）へ流し込む。
 * 実行前に日付・名前・店舗IDを編集してください。
 *
 * 使い方（ログイン済みブラウザ）:
 * GET /api/admin/fix-attendance?storeId=＜対象店舗UUID＞
 */

type FixInputStatus = "public_holiday" | "half_holiday" | "late" | "absent" | "absence";

type FixRow = {
  date: string;
  castName: string;
  /** absence は absent として扱う */
  status: FixInputStatus;
  reason: string;
};

/** ここを編集してからデプロイ／実行 */
const FIX_ROWS: FixRow[] = [
  { date: "2026-04-05", castName: "ユウ", status: "public_holiday", reason: "用意が間に合いませんでした。" },
  { date: "2026-04-05", castName: "カイト", status: "late", reason: "寝坊" },
  { date: "2026-04-05", castName: "ゆきな", status: "absence", reason: "" },
  {
    date: "2026-04-07",
    castName: "ゴウ",
    status: "public_holiday",
    reason: "出勤のつもりだったのですが胃が気持ち悪くてお休み頂きたいです。",
  },
  { date: "2026-04-07", castName: "ナナ。", status: "half_holiday", reason: "寝坊" },
  {
    date: "2026-04-08",
    castName: "リク",
    status: "absence",
    reason: "寝違えで腕が上がらないほど肩に激痛が走るのでお休みを頂きたいです",
  },
];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function normalizeStatus(s: FixInputStatus): AttendanceStatus | null {
  const t = String(s).trim().toLowerCase();
  if (t === "absence" || t === "absent") return "absent";
  if (t === "late") return "late";
  if (t === "public_holiday") return "public_holiday";
  if (t === "half_holiday") return "half_holiday";
  return null;
}

function buildSchedulePayload(
  storeId: string,
  castId: string,
  scheduledDate: string,
  rs: AttendanceStatus,
  reason: string
): Record<string, unknown> {
  const r = reason.trim();
  const nowIso = new Date().toISOString();
  const base: Record<string, unknown> = {
    store_id: storeId,
    cast_id: castId,
    scheduled_date: scheduledDate,
    response_status: rs,
    is_absent: rs === "absent",
    is_late: rs === "late",
    is_action_completed: true,
    pending_line_flow: null,
    pending_line_updated_at: null,
    updated_at: nowIso,
    public_holiday_reason: null,
    half_holiday_reason: null,
    late_reason: null,
    absent_reason: null,
  };

  if (rs === "public_holiday") base.public_holiday_reason = r || null;
  else if (rs === "half_holiday") base.half_holiday_reason = r || null;
  else if (rs === "late") base.late_reason = r || null;
  else if (rs === "absent") base.absent_reason = r || null;

  return base;
}

function buildLogPayload(
  storeId: string,
  castId: string,
  scheduleId: string,
  attendedDate: string,
  rs: AttendanceStatus,
  reason: string
): Record<string, unknown> {
  const r = reason.trim();
  const nowIso = new Date().toISOString();
  const row: Record<string, unknown> = {
    store_id: storeId,
    cast_id: castId,
    attendance_schedule_id: scheduleId,
    attended_date: attendedDate,
    status: rs,
    is_sabaki: false,
    has_reservation: null,
    reservation_details: null,
    responded_at: nowIso,
    updated_at: nowIso,
    public_holiday_reason: null,
    half_holiday_reason: null,
  };
  if (rs === "public_holiday") row.public_holiday_reason = r || null;
  else if (rs === "half_holiday") row.half_holiday_reason = r || null;
  return row;
}

/**
 * GET: FIX_ROWS を対象店舗に流し込む（要ログイン・店舗権限）
 */
export async function GET(request: Request) {
  const { user, error: authErr } = await getAuthedUserForAdminApi();
  if (authErr === "config") {
    return NextResponse.json({ error: "Supabase is not configured" }, { status: 500 });
  }
  if (!user) {
    return NextResponse.json(
      { error: "Unauthorized", hint: "管理画面にログインしたうえで同じブラウザから開いてください。" },
      { status: 401 }
    );
  }

  const url = new URL(request.url);
  const storeId = url.searchParams.get("storeId")?.trim() ?? "";
  if (!storeId || !isValidStoreId(storeId)) {
    return NextResponse.json(
      { error: "Query ?storeId=＜店舗UUID＞ が必要です" },
      { status: 400 }
    );
  }

  try {
    assertStoreIdMatchesRequest(request, storeId);
  } catch {
    return NextResponse.json(
      { error: "Forbidden（アクティブ店舗と storeId が一致しません）" },
      { status: 403 }
    );
  }

  if (!canUserEditStore(user, storeId)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()) {
    return NextResponse.json({ error: "Server configuration error (service role)" }, { status: 500 });
  }

  let admin: ReturnType<typeof createServiceRoleClient>;
  try {
    admin = createServiceRoleClient();
  } catch {
    return NextResponse.json({ error: "Server configuration error" }, { status: 500 });
  }

  const { data: storeRow } = await admin
    .from("stores")
    .select("id, name, business_type")
    .eq("id", storeId)
    .maybeSingle();

  const { data: castRows, error: castErr } = await admin
    .from("casts")
    .select("id, name")
    .eq("store_id", storeId)
    .eq("is_active", true);

  if (castErr) {
    return NextResponse.json({ error: castErr.message }, { status: 500 });
  }

  const byName = new Map<string, { id: string; name: string }[]>();
  for (const c of castRows ?? []) {
    const row = c as { id: string; name: string | null };
    const key = String(row.name ?? "").trim();
    if (!key) continue;
    const list = byName.get(key) ?? [];
    list.push({ id: row.id, name: key });
    byName.set(key, list);
  }

  const applied: { date: string; castName: string; castId: string; status: AttendanceStatus }[] = [];
  const skipped: { date: string; castName: string; status: string; reason: string }[] = [];
  const errors: { date: string; castName: string; message: string }[] = [];

  for (const raw of FIX_ROWS) {
    const { date, castName, status: rawStatus, reason } = raw;
    if (!DATE_RE.test(date)) {
      skipped.push({ date, castName, status: rawStatus, reason: "日付形式が不正" });
      continue;
    }

    const rs = normalizeStatus(rawStatus);
    if (!rs) {
      skipped.push({ date, castName, status: rawStatus, reason: "status が不正" });
      continue;
    }

    const key = castName.trim();
    const candidates = byName.get(key);
    if (!candidates || candidates.length === 0) {
      skipped.push({ date, castName, status: rawStatus, reason: "キャスト名に一致する行がない" });
      continue;
    }
    if (candidates.length > 1) {
      skipped.push({ date, castName, status: rawStatus, reason: "同じ表示名のキャストが複数いる" });
      continue;
    }

    const castId = candidates[0].id;
    const schedulePayload = buildSchedulePayload(storeId, castId, date, rs, reason);

    const { data: upserted, error: upErr } = await admin
      .from("attendance_schedules")
      .upsert(schedulePayload, { onConflict: "store_id,cast_id,scheduled_date" })
      .select("id")
      .single();

    if (upErr || !upserted?.id) {
      errors.push({
        date,
        castName,
        message: upErr?.message ?? "attendance_schedules upsert 失敗",
      });
      continue;
    }

    const logPayload = buildLogPayload(storeId, castId, upserted.id as string, date, rs, reason);
    const { error: logErr } = await admin.from("attendance_logs").upsert(logPayload, {
      onConflict: "store_id,cast_id,attended_date",
    });

    if (logErr) {
      errors.push({
        date,
        castName,
        message: `attendance_logs: ${logErr.message}`,
      });
      continue;
    }

    applied.push({ date, castName, castId, status: rs });
  }

  return NextResponse.json({
    ok: errors.length === 0,
    message:
      "ワンタイム復旧処理が完了しました。不要になったら本ルートの削除または FIX_ROWS の空配列化を推奨します。",
    store: storeRow
      ? {
          id: storeRow.id,
          name: (storeRow as { name?: string }).name ?? "",
          business_type: (storeRow as { business_type?: string }).business_type ?? null,
        }
      : null,
    totalInput: FIX_ROWS.length,
    appliedCount: applied.length,
    skippedCount: skipped.length,
    errorCount: errors.length,
    applied,
    skipped,
    errors,
  });
}
