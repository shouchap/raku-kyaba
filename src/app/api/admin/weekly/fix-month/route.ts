import { NextResponse } from "next/server";
import type { User } from "@supabase/supabase-js";
import { createServiceRoleClient } from "@/lib/supabase-service";
import { canUserEditStore, getAuthedUserForAdminApi } from "@/lib/admin-store-auth";
import { isSuperAdminUser } from "@/lib/super-admin";
import { isValidStoreId, parseActiveStoreIdFromCookieHeader } from "@/lib/current-store";
import { getWeekdayJst } from "@/lib/date-utils";
import {
  mergeScheduleRowForWeeklyUpsert,
  scheduleRowHasLineAttendanceData,
} from "@/lib/attendance-schedule-preserve";
import { normalizeDbTimeToShiftOption, parseShiftTimeStepMinutes } from "@/lib/time-options";
import { logPostgrestError } from "@/lib/postgrest-error";

export const dynamic = "force-dynamic";

type Body = {
  storeId?: string;
  year?: number;
  month?: number;
};

function storeIdForbiddenUnlessMatchesCookie(
  request: Request,
  user: User,
  storeId: string
): NextResponse | null {
  if (isSuperAdminUser(user)) return null;
  const cookieStoreId = parseActiveStoreIdFromCookieHeader(request.headers.get("cookie"));
  if (cookieStoreId && storeId !== cookieStoreId) {
    return NextResponse.json({ error: "storeId must match active store (cookie)" }, { status: 403 });
  }
  return null;
}

function buildMonthDates(year: number, month: number): string[] {
  const lastDay = new Date(year, month, 0).getDate();
  const m = String(month).padStart(2, "0");
  const out: string[] = [];
  for (let d = 1; d <= lastDay; d++) {
    out.push(`${year}-${m}-${String(d).padStart(2, "0")}`);
  }
  return out;
}

export async function POST(request: Request) {
  const { user, error } = await getAuthedUserForAdminApi();
  if (error === "config") return NextResponse.json({ error: "Supabase is not configured" }, { status: 500 });
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as Body | null;
  if (!body) return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });

  const storeId = body.storeId?.trim() ?? "";
  const year = Number(body.year);
  const month = Number(body.month);

  if (!storeId || !isValidStoreId(storeId)) {
    return NextResponse.json({ error: "Valid storeId is required" }, { status: 400 });
  }
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    return NextResponse.json({ error: "year must be an integer between 2000 and 2100" }, { status: 400 });
  }
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    return NextResponse.json({ error: "month must be an integer between 1 and 12" }, { status: 400 });
  }
  if (!canUserEditStore(user, storeId)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const mismatch = storeIdForbiddenUnlessMatchesCookie(request, user, storeId);
  if (mismatch) return mismatch;

  let admin: ReturnType<typeof createServiceRoleClient>;
  try {
    admin = createServiceRoleClient();
  } catch (e) {
    logPostgrestError("weekly/fix-month createServiceRoleClient", e);
    return NextResponse.json({ error: "Server configuration error (service role)" }, { status: 500 });
  }

  let store:
    | {
        id: string;
        regular_holidays?: number[] | null;
        regular_start_time?: string | null;
        shift_time_step_minutes?: unknown;
      }
    | null = null;

  const storeFull = await admin
    .from("stores")
    .select("id, regular_holidays, regular_start_time, shift_time_step_minutes")
    .eq("id", storeId)
    .maybeSingle();

  if (storeFull.error) {
    if (String(storeFull.error.message ?? "").includes("shift_time_step_minutes")) {
      const fb = await admin
        .from("stores")
        .select("id, regular_holidays, regular_start_time")
        .eq("id", storeId)
        .maybeSingle();
      if (fb.error) {
        logPostgrestError("weekly/fix-month stores", fb.error);
        return NextResponse.json({ error: "Failed to load store", details: fb.error.message }, { status: 500 });
      }
      store = fb.data
        ? { ...(fb.data as { id: string; regular_holidays?: number[] | null; regular_start_time?: string | null }), shift_time_step_minutes: 15 }
        : null;
    } else {
      logPostgrestError("weekly/fix-month stores", storeFull.error);
      return NextResponse.json(
        { error: "Failed to load store", details: storeFull.error.message },
        { status: 500 }
      );
    }
  } else {
    store = storeFull.data as typeof store;
  }

  if (!store?.id) return NextResponse.json({ error: "Store not found" }, { status: 404 });

  const fixMonthShiftStep = parseShiftTimeStepMinutes(
    (store as { shift_time_step_minutes?: unknown }).shift_time_step_minutes
  );
  const regularStart = normalizeDbTimeToShiftOption(
    (store as { regular_start_time?: string | null }).regular_start_time ?? null,
    fixMonthShiftStep
  );
  if (!regularStart) {
    return NextResponse.json(
      { error: "regular_start_time is not configured in store settings" },
      { status: 400 }
    );
  }

  const closedDaysRaw = (store as { regular_holidays?: number[] | null }).regular_holidays;
  const closedDays = Array.isArray(closedDaysRaw)
    ? [...new Set(closedDaysRaw.filter((n) => Number.isInteger(n) && n >= 0 && n <= 6))]
    : [];

  const { data: regularCasts, error: castErr } = await admin
    .from("casts")
    .select("id")
    .eq("store_id", storeId)
    .eq("is_active", true)
    .eq("employment_type", "regular");
  if (castErr) {
    logPostgrestError("weekly/fix-month casts", castErr);
    return NextResponse.json({ error: "Failed to load regular casts", details: castErr.message }, { status: 500 });
  }

  const castIds = (regularCasts ?? [])
    .map((r) => String((r as { id?: string }).id ?? "").trim())
    .filter(Boolean);
  if (castIds.length === 0) {
    return NextResponse.json({ ok: true, upserted: 0, skippedExisting: 0, skippedHoliday: 0, targetCasts: 0 });
  }

  const monthDates = buildMonthDates(year, month);
  const targetDates = monthDates.filter((d) => !closedDays.includes(getWeekdayJst(d)));
  const skippedHoliday = monthDates.length - targetDates.length;
  if (targetDates.length === 0) {
    return NextResponse.json({
      ok: true,
      upserted: 0,
      skippedExisting: 0,
      skippedHoliday,
      targetCasts: castIds.length,
    });
  }

  const { data: existingRows, error: existingErr } = await admin
    .from("attendance_schedules")
    .select("*")
    .eq("store_id", storeId)
    .in("cast_id", castIds)
    .gte("scheduled_date", targetDates[0])
    .lte("scheduled_date", targetDates[targetDates.length - 1]);
  if (existingErr) {
    logPostgrestError("weekly/fix-month attendance_schedules", existingErr);
    return NextResponse.json({ error: "Failed to load existing schedules", details: existingErr.message }, { status: 500 });
  }

  const existingByKey = new Map<string, Record<string, unknown>>();
  for (const row of existingRows ?? []) {
    const r = row as Record<string, unknown>;
    const cid = String(r.cast_id ?? "");
    const d = String(r.scheduled_date ?? "");
    if (cid && d) existingByKey.set(`${cid}_${d}`, r);
  }

  const upserts: Record<string, unknown>[] = [];
  let skippedExisting = 0;

  for (const castId of castIds) {
    for (const date of targetDates) {
      const key = `${castId}_${date}`;
      const prev = existingByKey.get(key);
      if (prev) {
        const hasManualTime = String(prev.scheduled_time ?? "").trim() !== "";
        if (hasManualTime || scheduleRowHasLineAttendanceData(prev)) {
          skippedExisting += 1;
          continue;
        }
      }

      const base = {
        store_id: storeId,
        cast_id: castId,
        scheduled_date: date,
        scheduled_time: `${regularStart}:00`,
        is_dohan: false,
        is_sabaki: false,
      };
      upserts.push(mergeScheduleRowForWeeklyUpsert(base, prev));
    }
  }

  if (upserts.length > 0) {
    const { error: upErr } = await admin
      .from("attendance_schedules")
      .upsert(upserts, { onConflict: "store_id,cast_id,scheduled_date" });
    if (upErr) {
      logPostgrestError("weekly/fix-month upsert", upErr);
      return NextResponse.json({ error: "Failed to save schedules", details: upErr.message }, { status: 500 });
    }
  }

  return NextResponse.json({
    ok: true,
    upserted: upserts.length,
    skippedExisting,
    skippedHoliday,
    targetCasts: castIds.length,
  });
}
