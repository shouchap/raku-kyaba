import { NextResponse } from "next/server";
import type { User } from "@supabase/supabase-js";
import { createServiceRoleClient } from "@/lib/supabase-service";
import { canUserEditStore, getAuthedUserForAdminApi } from "@/lib/admin-store-auth";
import { isValidStoreId, parseActiveStoreIdFromCookieHeader } from "@/lib/current-store";
import { isSuperAdminUser } from "@/lib/super-admin";
import { logPostgrestError } from "@/lib/postgrest-error";

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

type PutBody = {
  storeId?: string;
  staffName?: string;
  targetDate?: string;
  guideCount?: unknown;
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
  const guideCount =
    typeof body.guideCount === "number" && Number.isFinite(body.guideCount)
      ? Math.floor(body.guideCount)
      : NaN;

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
  if (!Number.isInteger(guideCount) || guideCount < 0 || guideCount > 9999) {
    return NextResponse.json({ error: "guideCount must be an integer from 0 to 9999" }, { status: 400 });
  }

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

  const { error: upErr } = await admin.from("daily_guide_results").upsert(
    {
      store_id: storeId,
      staff_name: staffName,
      target_date: targetDate,
      guide_count: guideCount,
      responded_at: respondedAt,
    },
    { onConflict: "store_id,staff_name,target_date" }
  );

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
  const guideCount =
    typeof body.guideCount === "number" && Number.isFinite(body.guideCount)
      ? Math.floor(body.guideCount)
      : NaN;

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
  if (!Number.isInteger(guideCount) || guideCount < 0 || guideCount > 9999) {
    return NextResponse.json({ error: "guideCount must be an integer from 0 to 9999" }, { status: 400 });
  }

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

  const { error: upErr } = await admin
    .from("daily_guide_results")
    .update({
      staff_name: staffName,
      target_date: targetDate,
      guide_count: guideCount,
      responded_at: respondedAt,
    })
    .eq("id", id)
    .eq("store_id", storeId);

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
