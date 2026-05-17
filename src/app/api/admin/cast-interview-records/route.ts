import { NextResponse } from "next/server";
import type { User } from "@supabase/supabase-js";
import { createServiceRoleClient } from "@/lib/supabase-service";
import { isValidStoreId, parseActiveStoreIdFromCookieHeader } from "@/lib/current-store";
import { canUserEditStore, getAuthedUserForAdminApi } from "@/lib/admin-store-auth";
import { isSuperAdminUser } from "@/lib/super-admin";
import { isUndefinedColumnError, logPostgrestError } from "@/lib/postgrest-error";

export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_CONTENT_LEN = 10000;

export type CastInterviewRecordRow = {
  id: string;
  store_id: string;
  cast_id: string;
  cast_name: string;
  interview_date: string;
  content: string;
  created_at: string;
  updated_at: string;
};

function storeIdForbiddenUnlessMatchesCookie(
  request: Request,
  user: User,
  storeId: string
): NextResponse | null {
  if (isSuperAdminUser(user)) return null;
  const cookieStoreId = parseActiveStoreIdFromCookieHeader(request.headers.get("cookie"));
  if (cookieStoreId && storeId !== cookieStoreId) {
    return NextResponse.json(
      { error: "storeId must match active store (cookie)" },
      { status: 403 }
    );
  }
  return null;
}

async function assertCabaretStore(
  admin: ReturnType<typeof createServiceRoleClient>,
  storeId: string
): Promise<NextResponse | null> {
  const { data, error } = await admin
    .from("stores")
    .select("business_type")
    .eq("id", storeId)
    .maybeSingle();
  if (error) {
    logPostgrestError("cast-interview-records stores", error);
    return NextResponse.json({ error: "Failed to load store" }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "Store not found" }, { status: 404 });
  }
  if (String((data as { business_type?: string }).business_type ?? "cabaret") !== "cabaret") {
    return NextResponse.json(
      { error: "Interview records are only available for cabaret stores" },
      { status: 403 }
    );
  }
  return null;
}

function mapRows(
  rows: Array<Record<string, unknown>>,
  nameByCastId: Map<string, string>
): CastInterviewRecordRow[] {
  return rows.map((raw) => {
    const castId = String(raw.cast_id ?? "");
    return {
      id: String(raw.id ?? ""),
      store_id: String(raw.store_id ?? ""),
      cast_id: castId,
      cast_name: nameByCastId.get(castId) ?? "",
      interview_date: String(raw.interview_date ?? ""),
      content: String(raw.content ?? ""),
      created_at: String(raw.created_at ?? ""),
      updated_at: String(raw.updated_at ?? ""),
    };
  });
}

/**
 * GET /api/admin/cast-interview-records?storeId=uuid&start=YYYY-MM-DD&end=YYYY-MM-DD&castId=uuid(optional)
 */
export async function GET(request: Request) {
  const { user, error: authErr } = await getAuthedUserForAdminApi();
  if (authErr === "config") {
    return NextResponse.json({ error: "Supabase is not configured" }, { status: 500 });
  }
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sp = new URL(request.url).searchParams;
  const storeId = sp.get("storeId")?.trim() ?? "";
  const start = sp.get("start")?.trim() ?? "";
  const end = sp.get("end")?.trim() ?? "";
  const castIdFilter = sp.get("castId")?.trim() ?? "";

  if (!isValidStoreId(storeId)) {
    return NextResponse.json({ error: "Valid storeId is required" }, { status: 400 });
  }
  if (!DATE_RE.test(start) || !DATE_RE.test(end) || start > end) {
    return NextResponse.json(
      { error: "start and end must be YYYY-MM-DD with start <= end" },
      { status: 400 }
    );
  }
  if (castIdFilter && !isValidStoreId(castIdFilter)) {
    return NextResponse.json({ error: "Invalid castId" }, { status: 400 });
  }

  if (!canUserEditStore(user, storeId)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const cookieMismatch = storeIdForbiddenUnlessMatchesCookie(request, user, storeId);
  if (cookieMismatch) return cookieMismatch;

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()) {
    return NextResponse.json({ error: "Server configuration error" }, { status: 500 });
  }

  let admin: ReturnType<typeof createServiceRoleClient>;
  try {
    admin = createServiceRoleClient();
  } catch (e) {
    logPostgrestError("GET cast-interview-records createServiceRoleClient", e);
    return NextResponse.json({ error: "Server configuration error" }, { status: 500 });
  }

  const cabaretErr = await assertCabaretStore(admin, storeId);
  if (cabaretErr) return cabaretErr;

  let query = admin
    .from("cast_interview_records")
    .select("id, store_id, cast_id, interview_date, content, created_at, updated_at")
    .eq("store_id", storeId)
    .gte("interview_date", start)
    .lte("interview_date", end)
    .order("interview_date", { ascending: false })
    .order("created_at", { ascending: false });

  if (castIdFilter) {
    query = query.eq("cast_id", castIdFilter);
  }

  const { data: recordRows, error: recErr } = await query;

  if (recErr) {
    if (isUndefinedColumnError(recErr, "cast_interview_records")) {
      return NextResponse.json({ ok: true, rows: [] as CastInterviewRecordRow[] });
    }
    logPostgrestError("GET cast-interview-records", recErr);
    return NextResponse.json(
      { error: "Failed to load interview records", details: recErr.message },
      { status: 500 }
    );
  }

  const rows = (recordRows ?? []) as Record<string, unknown>[];
  const castIds = [...new Set(rows.map((r) => String(r.cast_id ?? "")).filter(Boolean))];
  const nameByCastId = new Map<string, string>();

  if (castIds.length > 0) {
    const { data: castRows, error: castErr } = await admin
      .from("casts")
      .select("id, name, display_name")
      .eq("store_id", storeId)
      .in("id", castIds);
    if (castErr) {
      logPostgrestError("GET cast-interview-records casts", castErr);
      return NextResponse.json(
        { error: "Failed to load cast names", details: castErr.message },
        { status: 500 }
      );
    }
    for (const c of castRows ?? []) {
      const row = c as { id?: string; name?: string; display_name?: string | null };
      if (!row.id) continue;
      const name = String(row.name ?? "");
      const d = row.display_name?.trim();
      nameByCastId.set(row.id, d ? `${d}（${name}）` : name);
    }
  }

  return NextResponse.json({ ok: true, rows: mapRows(rows, nameByCastId) });
}

/**
 * POST /api/admin/cast-interview-records
 * Body: { storeId, castId, interviewDate, content }
 */
export async function POST(request: Request) {
  const { user, error: authErr } = await getAuthedUserForAdminApi();
  if (authErr === "config") {
    return NextResponse.json({ error: "Supabase is not configured" }, { status: 500 });
  }
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let bodyRaw: unknown;
  try {
    bodyRaw = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (bodyRaw === null || typeof bodyRaw !== "object" || Array.isArray(bodyRaw)) {
    return NextResponse.json({ error: "JSON body required" }, { status: 400 });
  }
  const body = bodyRaw as Record<string, unknown>;

  const storeId = String(body.storeId ?? body.store_id ?? "").trim();
  const castId = String(body.castId ?? body.cast_id ?? "").trim();
  const interviewDate = String(body.interviewDate ?? body.interview_date ?? "").trim();
  const content = String(body.content ?? "").trim();

  if (!isValidStoreId(storeId) || !isValidStoreId(castId) || !DATE_RE.test(interviewDate)) {
    return NextResponse.json(
      { error: "Valid storeId, castId, and interviewDate (YYYY-MM-DD) are required" },
      { status: 400 }
    );
  }
  if (!content) {
    return NextResponse.json({ error: "content is required" }, { status: 400 });
  }
  if (content.length > MAX_CONTENT_LEN) {
    return NextResponse.json(
      { error: `content must be at most ${MAX_CONTENT_LEN} characters` },
      { status: 400 }
    );
  }

  if (!canUserEditStore(user, storeId)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const cookieMismatch = storeIdForbiddenUnlessMatchesCookie(request, user, storeId);
  if (cookieMismatch) return cookieMismatch;

  let admin: ReturnType<typeof createServiceRoleClient>;
  try {
    admin = createServiceRoleClient();
  } catch (e) {
    logPostgrestError("POST cast-interview-records createServiceRoleClient", e);
    return NextResponse.json({ error: "Server configuration error" }, { status: 500 });
  }

  const cabaretErr = await assertCabaretStore(admin, storeId);
  if (cabaretErr) return cabaretErr;

  const { data: castRow, error: castErr } = await admin
    .from("casts")
    .select("id")
    .eq("id", castId)
    .eq("store_id", storeId)
    .maybeSingle();

  if (castErr) {
    logPostgrestError("POST cast-interview-records cast lookup", castErr);
    return NextResponse.json({ error: "Failed to verify cast" }, { status: 500 });
  }
  if (!castRow) {
    return NextResponse.json({ error: "Cast not found in this store" }, { status: 404 });
  }

  const { data: inserted, error: insErr } = await admin
    .from("cast_interview_records")
    .insert({
      store_id: storeId,
      cast_id: castId,
      interview_date: interviewDate,
      content,
    })
    .select("id, store_id, cast_id, interview_date, content, created_at, updated_at")
    .single();

  if (insErr) {
    if (isUndefinedColumnError(insErr, "cast_interview_records")) {
      return NextResponse.json(
        { error: "Interview records table is not migrated yet (057)" },
        { status: 503 }
      );
    }
    logPostgrestError("POST cast-interview-records insert", insErr);
    return NextResponse.json(
      { error: "Failed to save interview record", details: insErr.message },
      { status: 500 }
    );
  }

  const { data: castNameRow } = await admin
    .from("casts")
    .select("name, display_name")
    .eq("id", castId)
    .maybeSingle();

  const nameByCastId = new Map<string, string>();
  if (castNameRow) {
    const c = castNameRow as { name?: string; display_name?: string | null };
    const name = String(c.name ?? "");
    const d = c.display_name?.trim();
    nameByCastId.set(castId, d ? `${d}（${name}）` : name);
  }

  const row = mapRows([inserted as Record<string, unknown>], nameByCastId)[0];
  return NextResponse.json({ ok: true, row });
}
