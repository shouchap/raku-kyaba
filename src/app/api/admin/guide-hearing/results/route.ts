import { NextResponse } from "next/server";
import type { User } from "@supabase/supabase-js";
import { createServiceRoleClient } from "@/lib/supabase-service";
import { canUserEditStore, getAuthedUserForAdminApi } from "@/lib/admin-store-auth";
import { isValidStoreId, parseActiveStoreIdFromCookieHeader } from "@/lib/current-store";
import { isSuperAdminUser } from "@/lib/super-admin";
import { logPostgrestError } from "@/lib/postgrest-error";
import { isDailyGuideResultsMissingSekGoldColumns } from "@/lib/daily-guide-results-compat";
import {
  GUIDE_VENUE_IDS,
  emptyGuideVenueCounts,
  guideVenueCountsToDbColumns,
  sumGuideVenueCounts,
  type GuideVenueCounts,
  type GuideVenueId,
} from "@/lib/guide-venues";

export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function rejectStoreMismatch(
  request: Request,
  user: User,
  storeId: string
): NextResponse | null {
  if (isSuperAdminUser(user)) return null;
  const cookieStoreId = parseActiveStoreIdFromCookieHeader(request.headers.get("cookie"));
  if (cookieStoreId && cookieStoreId !== storeId) {
    return NextResponse.json({ error: "storeId must match active store (cookie)" }, { status: 403 });
  }
  return null;
}

function serviceRoleOk(): boolean {
  return Boolean(
    (process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL)?.trim() &&
      process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  );
}

async function fetchGuideStaffNames(admin: ReturnType<typeof createServiceRoleClient>, storeId: string): Promise<string[]> {
  const { data, error } = await admin.from("stores").select("guide_staff_names").eq("id", storeId).maybeSingle();
  if (error) {
    console.error("[guide-hearing/results] stores fetch:", error.message);
    return [];
  }
  const raw = data?.guide_staff_names;
  return Array.isArray(raw) ? raw.map((v: unknown) => String(v ?? "").trim()).filter(Boolean) : [];
}

function staffNameAllowed(staffName: string, allowed: string[]): boolean {
  const n = staffName.trim();
  if (!n) return false;
  return allowed.includes(n);
}

function floorInt(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? Math.floor(v) : NaN;
}

const BODY_VENUE_KEYS: Record<GuideVenueId, { g: string; p: string }> = {
  gold: { g: "goldGuideCount", p: "goldPeopleCount" },
  sek: { g: "sekGuideCount", p: "sekPeopleCount" },
  lounge: { g: "loungeGuideCount", p: "loungePeopleCount" },
  girls_bar: { g: "girlsBarGuideCount", p: "girlsBarPeopleCount" },
  concecafe: { g: "concecafeGuideCount", p: "concecafePeopleCount" },
  philippine_pub: { g: "philippinePubGuideCount", p: "philippinePubPeopleCount" },
};

/** 業態別カウント、または従来の guideCount/peopleCount（セクキャバのみとして保存） */
function parseGuideSplitCounts(body: Record<string, unknown>): NextResponse | {
  counts: GuideVenueCounts;
  guideCount: number;
  peopleCount: number;
} {
  const counts = emptyGuideVenueCounts();
  let anyVenueField = false;
  for (const id of GUIDE_VENUE_IDS) {
    const keys = BODY_VENUE_KEYS[id];
    const gRaw = body[keys.g];
    const pRaw = body[keys.p];
    if (gRaw === undefined && pRaw === undefined) continue;
    anyVenueField = true;
    const g = floorInt(gRaw ?? 0);
    const p = floorInt(pRaw ?? 0);
    if (!Number.isInteger(g) || !Number.isInteger(p) || g < 0 || g > 9999 || p < 0 || p > 9999) {
      return NextResponse.json(
        { error: `${keys.g} / ${keys.p} must be integers from 0 to 9999` },
        { status: 400 }
      );
    }
    counts[id] = { groups: g, people: p };
  }

  if (anyVenueField) {
    const totals = sumGuideVenueCounts(counts);
    return { counts, guideCount: totals.guideCount, peopleCount: totals.peopleCount };
  }

  const gc = floorInt(body.guideCount);
  const pc = floorInt(body.peopleCount);
  if (Number.isInteger(gc) && Number.isInteger(pc)) {
    if (gc < 0 || gc > 9999 || pc < 0 || pc > 9999) {
      return NextResponse.json(
        { error: "guideCount and peopleCount must be integers from 0 to 9999" },
        { status: 400 }
      );
    }
    counts.sek = { groups: gc, people: pc };
    return { counts, guideCount: gc, peopleCount: pc };
  }

  return NextResponse.json(
    {
      error:
        "業態別の組数・人数（例: goldGuideCount）が必要です（または従来どおり guideCount と peopleCount のみ）",
    },
    { status: 400 }
  );
}

type PutBody = {
  storeId?: string;
  staffName?: string;
  targetDate?: string;
  guideCount?: unknown;
  peopleCount?: unknown;
  sekGuideCount?: unknown;
  sekPeopleCount?: unknown;
  goldGuideCount?: unknown;
  goldPeopleCount?: unknown;
};

/**
 * 案内実績の Upsert（同一店舗・スタッフ名・日付で guide_count を更新／新規挿入）
 * PUT /api/admin/guide-hearing/results
 */
export async function PUT(request: Request) {
  const { user, error } = await getAuthedUserForAdminApi();
  if (error === "config") return NextResponse.json({ error: "Supabase is not configured" }, { status: 500 });
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!serviceRoleOk()) return NextResponse.json({ error: "Server configuration error" }, { status: 500 });

  const body = (await request.json().catch(() => null)) as PutBody | null;
  if (!body) return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });

  const storeId = typeof body.storeId === "string" ? body.storeId.trim() : "";
  const staffName = typeof body.staffName === "string" ? body.staffName.trim() : "";
  const targetDate = typeof body.targetDate === "string" ? body.targetDate.trim() : "";

  if (!isValidStoreId(storeId)) {
    return NextResponse.json({ error: "Valid storeId is required" }, { status: 400 });
  }
  if (!canUserEditStore(user, storeId)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const mismatch = rejectStoreMismatch(request, user, storeId);
  if (mismatch) return mismatch;

  if (!DATE_RE.test(targetDate)) {
    return NextResponse.json({ error: "targetDate must be YYYY-MM-DD" }, { status: 400 });
  }
  if (!staffName) {
    return NextResponse.json({ error: "staffName is required" }, { status: 400 });
  }

  const counts = parseGuideSplitCounts(body as Record<string, unknown>);
  if (counts instanceof NextResponse) return counts;

  let admin: ReturnType<typeof createServiceRoleClient>;
  try {
    admin = createServiceRoleClient();
  } catch (e) {
    logPostgrestError("PUT guide-hearing/results createServiceRoleClient", e);
    return NextResponse.json({ error: "Server configuration error (service role)" }, { status: 500 });
  }

  const allowedNames = await fetchGuideStaffNames(admin, storeId);
  if (allowedNames.length === 0) {
    return NextResponse.json(
      { error: "案内スタッフ名が未登録です。システム設定で登録してください。" },
      { status: 400 }
    );
  }
  if (!staffNameAllowed(staffName, allowedNames)) {
    return NextResponse.json(
      { error: "スタッフ名はシステム設定で登録された案内スタッフから選択してください。" },
      { status: 400 }
    );
  }

  const respondedAt = new Date().toISOString();

  const conflictKey = { onConflict: "store_id,staff_name,target_date" as const };
  let { error: upErr } = await admin.from("daily_guide_results").upsert(
    {
      store_id: storeId,
      staff_name: staffName,
      target_date: targetDate,
      ...guideVenueCountsToDbColumns(counts.counts),
      guide_count: counts.guideCount,
      people_count: counts.peopleCount,
      responded_at: respondedAt,
    },
    conflictKey
  );

  if (upErr && isDailyGuideResultsMissingSekGoldColumns(upErr.message)) {
    ({ error: upErr } = await admin.from("daily_guide_results").upsert(
      {
        store_id: storeId,
        staff_name: staffName,
        target_date: targetDate,
        guide_count: counts.guideCount,
        people_count: counts.peopleCount,
        responded_at: respondedAt,
      },
      conflictKey
    ));
  }

  if (upErr) {
    logPostgrestError("PUT guide-hearing/results upsert", upErr);
    return NextResponse.json(
      { error: "Failed to save guide result", details: upErr.message },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true });
}

type PatchBody = {
  storeId?: string;
  id?: string;
  staffName?: string;
  targetDate?: string;
  guideCount?: unknown;
  peopleCount?: unknown;
  sekGuideCount?: unknown;
  sekPeopleCount?: unknown;
  goldGuideCount?: unknown;
  goldPeopleCount?: unknown;
};

/**
 * 案内実績の更新（主キー id）
 * PATCH /api/admin/guide-hearing/results
 */
export async function PATCH(request: Request) {
  const { user, error } = await getAuthedUserForAdminApi();
  if (error === "config") return NextResponse.json({ error: "Supabase is not configured" }, { status: 500 });
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!serviceRoleOk()) return NextResponse.json({ error: "Server configuration error" }, { status: 500 });

  const body = (await request.json().catch(() => null)) as PatchBody | null;
  if (!body) return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });

  const storeId = typeof body.storeId === "string" ? body.storeId.trim() : "";
  const id = typeof body.id === "string" ? body.id.trim() : "";
  const staffName = typeof body.staffName === "string" ? body.staffName.trim() : "";
  const targetDate = typeof body.targetDate === "string" ? body.targetDate.trim() : "";

  if (!isValidStoreId(storeId) || !id) {
    return NextResponse.json({ error: "Valid storeId and id are required" }, { status: 400 });
  }
  if (!canUserEditStore(user, storeId)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const mismatch = rejectStoreMismatch(request, user, storeId);
  if (mismatch) return mismatch;

  if (!DATE_RE.test(targetDate)) {
    return NextResponse.json({ error: "targetDate must be YYYY-MM-DD" }, { status: 400 });
  }
  if (!staffName) {
    return NextResponse.json({ error: "staffName is required" }, { status: 400 });
  }

  const counts = parseGuideSplitCounts(body as Record<string, unknown>);
  if (counts instanceof NextResponse) return counts;

  let admin: ReturnType<typeof createServiceRoleClient>;
  try {
    admin = createServiceRoleClient();
  } catch (e) {
    logPostgrestError("PATCH guide-hearing/results createServiceRoleClient", e);
    return NextResponse.json({ error: "Server configuration error (service role)" }, { status: 500 });
  }

  const { data: existing, error: selErr } = await admin
    .from("daily_guide_results")
    .select("id, store_id")
    .eq("id", id)
    .maybeSingle();

  if (selErr) {
    logPostgrestError("PATCH guide-hearing/results select", selErr);
    return NextResponse.json({ error: "Failed to verify row", details: selErr.message }, { status: 500 });
  }
  if (!existing || existing.store_id !== storeId) {
    return NextResponse.json({ error: "Record not found" }, { status: 404 });
  }

  const allowedNames = await fetchGuideStaffNames(admin, storeId);
  if (allowedNames.length === 0) {
    return NextResponse.json(
      { error: "案内スタッフ名が未登録です。システム設定で登録してください。" },
      { status: 400 }
    );
  }
  if (!staffNameAllowed(staffName, allowedNames)) {
    return NextResponse.json(
      { error: "スタッフ名はシステム設定で登録された案内スタッフから選択してください。" },
      { status: 400 }
    );
  }

  const respondedAt = new Date().toISOString();

  let { error: upErr } = await admin
    .from("daily_guide_results")
    .update({
      staff_name: staffName,
      target_date: targetDate,
      ...guideVenueCountsToDbColumns(counts.counts),
      guide_count: counts.guideCount,
      people_count: counts.peopleCount,
      responded_at: respondedAt,
    })
    .eq("id", id)
    .eq("store_id", storeId);

  if (upErr && isDailyGuideResultsMissingSekGoldColumns(upErr.message)) {
    ({ error: upErr } = await admin
      .from("daily_guide_results")
      .update({
        staff_name: staffName,
        target_date: targetDate,
        guide_count: counts.guideCount,
        people_count: counts.peopleCount,
        responded_at: respondedAt,
      })
      .eq("id", id)
      .eq("store_id", storeId));
  }

  if (upErr) {
    logPostgrestError("PATCH guide-hearing/results update", upErr);
    const msg = upErr.message?.includes("duplicate") || upErr.code === "23505"
      ? "同じ日付・スタッフの組み合わせのデータが既に存在します。"
      : upErr.message;
    return NextResponse.json({ error: "Failed to update guide result", details: msg }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

type DeleteBody = {
  storeId?: string;
  id?: string;
};

/**
 * 案内実績の削除（主キー id）
 * DELETE /api/admin/guide-hearing/results  … body: { storeId, id }
 */
export async function DELETE(request: Request) {
  const { user, error } = await getAuthedUserForAdminApi();
  if (error === "config") return NextResponse.json({ error: "Supabase is not configured" }, { status: 500 });
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!serviceRoleOk()) return NextResponse.json({ error: "Server configuration error" }, { status: 500 });

  const body = (await request.json().catch(() => null)) as DeleteBody | null;
  if (!body) return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });

  const storeId = typeof body.storeId === "string" ? body.storeId.trim() : "";
  const id = typeof body.id === "string" ? body.id.trim() : "";

  if (!isValidStoreId(storeId) || !id) {
    return NextResponse.json({ error: "Valid storeId and id are required" }, { status: 400 });
  }
  if (!canUserEditStore(user, storeId)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const mismatch = rejectStoreMismatch(request, user, storeId);
  if (mismatch) return mismatch;

  let admin: ReturnType<typeof createServiceRoleClient>;
  try {
    admin = createServiceRoleClient();
  } catch (e) {
    logPostgrestError("DELETE guide-hearing/results createServiceRoleClient", e);
    return NextResponse.json({ error: "Server configuration error (service role)" }, { status: 500 });
  }

  const { data: row, error: selErr } = await admin
    .from("daily_guide_results")
    .select("id, store_id")
    .eq("id", id)
    .maybeSingle();

  if (selErr) {
    logPostgrestError("DELETE guide-hearing/results select", selErr);
    return NextResponse.json({ error: "Failed to verify row", details: selErr.message }, { status: 500 });
  }
  if (!row || row.store_id !== storeId) {
    return NextResponse.json({ error: "Record not found" }, { status: 404 });
  }

  const { error: delErr } = await admin.from("daily_guide_results").delete().eq("id", id).eq("store_id", storeId);

  if (delErr) {
    logPostgrestError("DELETE guide-hearing/results delete", delErr);
    return NextResponse.json({ error: "Failed to delete", details: delErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
