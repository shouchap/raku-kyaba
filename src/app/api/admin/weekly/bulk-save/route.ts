import { NextResponse } from "next/server";
import type { User } from "@supabase/supabase-js";
import { createServiceRoleClient } from "@/lib/supabase-service";
import { canUserEditStore, getAuthedUserForAdminApi } from "@/lib/admin-store-auth";
import { isSuperAdminUser } from "@/lib/super-admin";
import { isValidStoreId, parseActiveStoreIdFromCookieHeader } from "@/lib/current-store";
import { normalizeYmdDateKey } from "@/lib/date-utils";
import { scheduleRowHasLineAttendanceData } from "@/lib/attendance-schedule-preserve";
import { buildWeeklyScheduleUpsertRows } from "@/lib/weekly-schedule-bulk-save";
import { logPostgrestError, postgrestErrorFields } from "@/lib/postgrest-error";

export const dynamic = "force-dynamic";

const UPSERT_CHUNK = 40;

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

type Matrix = Record<string, Record<string, string>>;
type BoolMatrix = Record<string, Record<string, boolean>>;

type Body = {
  storeId?: string;
  dates?: unknown;
  castIds?: unknown;
  matrix?: unknown;
  endMatrix?: unknown;
  dohan?: unknown;
  sabaki?: unknown;
};

function isMatrix(v: unknown): v is Matrix {
  if (v === null || typeof v !== "object" || Array.isArray(v)) return false;
  return true;
}

function isBoolMatrix(v: unknown): v is BoolMatrix {
  if (v === null || typeof v !== "object" || Array.isArray(v)) return false;
  return true;
}

export async function POST(request: Request) {
  try {
  const { user, error } = await getAuthedUserForAdminApi();
  if (error === "config") {
    return NextResponse.json({ error: "Supabase is not configured" }, { status: 500 });
  }
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as Body | null;
  if (!body) {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const storeId = body.storeId?.trim() ?? "";
  if (!storeId || !isValidStoreId(storeId)) {
    return NextResponse.json({ error: "Valid storeId is required" }, { status: 400 });
  }
  if (!canUserEditStore(user, storeId)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const mismatch = storeIdForbiddenUnlessMatchesCookie(request, user, storeId);
  if (mismatch) return mismatch;

  const datesRaw = body.dates;
  if (!Array.isArray(datesRaw) || datesRaw.length === 0 || datesRaw.length > 31) {
    return NextResponse.json({ error: "dates must be a non-empty array of YYYY-MM-DD" }, { status: 400 });
  }
  const dates: string[] = [];
  for (const d of datesRaw) {
    const ymd = normalizeYmdDateKey(d);
    if (!ymd) {
      return NextResponse.json({ error: "Each date must be YYYY-MM-DD" }, { status: 400 });
    }
    dates.push(ymd);
  }

  const castIdsRaw = body.castIds;
  if (!Array.isArray(castIdsRaw) || castIdsRaw.length === 0) {
    return NextResponse.json({ error: "castIds is required" }, { status: 400 });
  }
  const castIds: string[] = [];
  for (const id of castIdsRaw) {
    const s = typeof id === "string" ? id.trim() : "";
    if (!s || !isValidStoreId(s)) {
      return NextResponse.json({ error: "Each castId must be a valid UUID" }, { status: 400 });
    }
    castIds.push(s.toLowerCase());
  }

  if (!isMatrix(body.matrix) || !isMatrix(body.endMatrix) || !isBoolMatrix(body.dohan) || !isBoolMatrix(body.sabaki)) {
    return NextResponse.json({ error: "matrix, endMatrix, dohan, sabaki must be objects" }, { status: 400 });
  }

  let admin: ReturnType<typeof createServiceRoleClient>;
  try {
    admin = createServiceRoleClient();
  } catch (e) {
    logPostgrestError("weekly/bulk-save createServiceRoleClient", e);
    return NextResponse.json({ error: "Server configuration error (service role)" }, { status: 500 });
  }

  const { data: existingRows, error: fetchErr } = await admin
    .from("attendance_schedules")
    .select("*")
    .eq("store_id", storeId)
    .in("scheduled_date", dates);

  if (fetchErr) {
    logPostgrestError("weekly/bulk-save fetch existing", fetchErr);
    return NextResponse.json(
      { error: "Failed to load existing schedules", ...postgrestErrorFields(fetchErr) },
      { status: 500 }
    );
  }

  const existing = (existingRows ?? []) as Record<string, unknown>[];
  const toUpsert = buildWeeklyScheduleUpsertRows({
    storeId,
    castIds,
    dates,
    matrix: body.matrix,
    endMatrix: body.endMatrix,
    dohan: body.dohan,
    sabaki: body.sabaki,
    existingRows: existing,
  });

  const midnightSample = toUpsert.find((r) => String(r.scheduled_end_time ?? "") === "24:00:00");
  if (midnightSample) {
    console.info("[weekly/bulk-save] payload sample (midnight end → DB)", {
      cast_id: midnightSample.cast_id,
      scheduled_date: midnightSample.scheduled_date,
      scheduled_time: midnightSample.scheduled_time,
      scheduled_end_time: midnightSample.scheduled_end_time,
    });
  }

  for (let i = 0; i < toUpsert.length; i += UPSERT_CHUNK) {
    const chunk = toUpsert.slice(i, i + UPSERT_CHUNK);
    const { error: upErr } = await admin.from("attendance_schedules").upsert(chunk, {
      onConflict: "store_id,cast_id,scheduled_date",
    });
    if (upErr) {
      logPostgrestError(`weekly/bulk-save upsert chunk offset=${i}`, upErr);
      return NextResponse.json(
        {
          error: "Failed to save schedules",
          chunkOffset: i,
          chunkSize: chunk.length,
          ...postgrestErrorFields(upErr),
        },
        { status: 400 }
      );
    }
  }

  const nowIso = new Date().toISOString();
  const matrixHasTime = new Set<string>();
  for (const castId of castIds) {
    for (const dateStr of dates) {
      const time = body.matrix[castId]?.[dateStr]?.trim();
      if (time) matrixHasTime.add(`${castId}_${dateStr}`);
    }
  }

  for (const r of existing) {
    const cid = String(r.cast_id ?? "");
    const d = String(r.scheduled_date ?? "");
    const key = `${cid}_${d}`;
    if (matrixHasTime.has(key)) continue;

    const id = String(r.id ?? "");
    if (!id) continue;

    if (scheduleRowHasLineAttendanceData(r)) {
      const { error: clearErr } = await admin
        .from("attendance_schedules")
        .update({
          scheduled_time: null,
          scheduled_end_time: null,
          is_dohan: false,
          is_sabaki: false,
          updated_at: nowIso,
        })
        .eq("id", id);
      if (clearErr) {
        logPostgrestError("weekly/bulk-save clear row", clearErr);
        return NextResponse.json(
          { error: "Failed to clear a schedule row", ...postgrestErrorFields(clearErr) },
          { status: 400 }
        );
      }
    } else {
      const { error: delErr } = await admin.from("attendance_schedules").delete().eq("id", id);
      if (delErr) {
        logPostgrestError("weekly/bulk-save delete row", delErr);
        return NextResponse.json(
          { error: "Failed to delete an empty schedule row", ...postgrestErrorFields(delErr) },
          { status: 400 }
        );
      }
    }
  }

  return NextResponse.json({ ok: true, upserted: toUpsert.length });
  } catch (e) {
    console.error("[weekly/bulk-save] unexpected", e);
    return NextResponse.json(
      { error: "Unexpected server error", details: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}