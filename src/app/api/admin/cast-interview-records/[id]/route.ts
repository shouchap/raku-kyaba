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

type RouteCtx = { params: Promise<{ id: string }> };

/**
 * PATCH /api/admin/cast-interview-records/[id]?storeId=uuid
 * Body: { interviewDate?, content? }
 */
export async function PATCH(request: Request, ctx: RouteCtx) {
  const { user, error: authErr } = await getAuthedUserForAdminApi();
  if (authErr === "config") {
    return NextResponse.json({ error: "Supabase is not configured" }, { status: 500 });
  }
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await ctx.params;
  const recordId = id?.trim() ?? "";
  const storeId = new URL(request.url).searchParams.get("storeId")?.trim() ?? "";

  if (!isValidStoreId(storeId) || !isValidStoreId(recordId)) {
    return NextResponse.json({ error: "Valid storeId and record id are required" }, { status: 400 });
  }

  if (!canUserEditStore(user, storeId)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const cookieMismatch = storeIdForbiddenUnlessMatchesCookie(request, user, storeId);
  if (cookieMismatch) return cookieMismatch;

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

  const patch: Record<string, string> = {};
  if ("interviewDate" in body || "interview_date" in body) {
    const d = String(body.interviewDate ?? body.interview_date ?? "").trim();
    if (!DATE_RE.test(d)) {
      return NextResponse.json({ error: "Invalid interviewDate" }, { status: 400 });
    }
    patch.interview_date = d;
  }
  if ("content" in body) {
    const content = String(body.content ?? "").trim();
    if (!content) {
      return NextResponse.json({ error: "content cannot be empty" }, { status: 400 });
    }
    if (content.length > MAX_CONTENT_LEN) {
      return NextResponse.json(
        { error: `content must be at most ${MAX_CONTENT_LEN} characters` },
        { status: 400 }
      );
    }
    patch.content = content;
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  let admin: ReturnType<typeof createServiceRoleClient>;
  try {
    admin = createServiceRoleClient();
  } catch (e) {
    logPostgrestError("PATCH cast-interview-records createServiceRoleClient", e);
    return NextResponse.json({ error: "Server configuration error" }, { status: 500 });
  }

  const { data, error } = await admin
    .from("cast_interview_records")
    .update(patch)
    .eq("id", recordId)
    .eq("store_id", storeId)
    .select("id")
    .maybeSingle();

  if (error) {
    if (isUndefinedColumnError(error, "cast_interview_records")) {
      return NextResponse.json({ error: "Interview records table is not migrated yet (057)" }, { status: 503 });
    }
    logPostgrestError("PATCH cast-interview-records", error);
    return NextResponse.json(
      { error: "Failed to update interview record", details: error.message },
      { status: 500 }
    );
  }
  if (!data) {
    return NextResponse.json({ error: "Record not found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}

/**
 * DELETE /api/admin/cast-interview-records/[id]?storeId=uuid
 */
export async function DELETE(request: Request, ctx: RouteCtx) {
  const { user, error: authErr } = await getAuthedUserForAdminApi();
  if (authErr === "config") {
    return NextResponse.json({ error: "Supabase is not configured" }, { status: 500 });
  }
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await ctx.params;
  const recordId = id?.trim() ?? "";
  const storeId = new URL(request.url).searchParams.get("storeId")?.trim() ?? "";

  if (!isValidStoreId(storeId) || !isValidStoreId(recordId)) {
    return NextResponse.json({ error: "Valid storeId and record id are required" }, { status: 400 });
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
    logPostgrestError("DELETE cast-interview-records createServiceRoleClient", e);
    return NextResponse.json({ error: "Server configuration error" }, { status: 500 });
  }

  const { data, error } = await admin
    .from("cast_interview_records")
    .delete()
    .eq("id", recordId)
    .eq("store_id", storeId)
    .select("id")
    .maybeSingle();

  if (error) {
    if (isUndefinedColumnError(error, "cast_interview_records")) {
      return NextResponse.json({ error: "Interview records table is not migrated yet (057)" }, { status: 503 });
    }
    logPostgrestError("DELETE cast-interview-records", error);
    return NextResponse.json(
      { error: "Failed to delete interview record", details: error.message },
      { status: 500 }
    );
  }
  if (!data) {
    return NextResponse.json({ error: "Record not found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
