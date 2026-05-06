import { NextResponse } from "next/server";
import type { User } from "@supabase/supabase-js";
import { createServiceRoleClient } from "@/lib/supabase-service";
import { isValidStoreId, parseActiveStoreIdFromCookieHeader } from "@/lib/current-store";
import { canUserEditStore, getAuthedUserForAdminApi } from "@/lib/admin-store-auth";
import { isSuperAdminUser } from "@/lib/super-admin";
import { logPostgrestError } from "@/lib/postgrest-error";

export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

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

/**
 * GET /api/admin/attendance-logs/lookup?storeId=&castId=&attended_date=YYYY-MM-DD
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
  const castId = sp.get("castId")?.trim() ?? "";
  const attendedDate = sp.get("attended_date")?.trim() ?? "";

  if (!isValidStoreId(storeId) || !isValidStoreId(castId) || !DATE_RE.test(attendedDate)) {
    return NextResponse.json(
      { error: "Valid storeId, castId, and attended_date (YYYY-MM-DD) are required" },
      { status: 400 }
    );
  }

  if (!canUserEditStore(user, storeId)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const cookieMismatch = storeIdForbiddenUnlessMatchesCookie(request, user, storeId);
  if (cookieMismatch) return cookieMismatch;

  let admin;
  try {
    admin = createServiceRoleClient();
  } catch (e) {
    logPostgrestError("GET attendance-logs/lookup createServiceRoleClient", e);
    return NextResponse.json({ error: "Server configuration error" }, { status: 500 });
  }

  const { data: cast, error: castErr } = await admin
    .from("casts")
    .select("id")
    .eq("id", castId)
    .eq("store_id", storeId)
    .eq("is_active", true)
    .maybeSingle();

  if (castErr || !cast) {
    return NextResponse.json({ error: "Cast not found" }, { status: 404 });
  }

  const { data: log, error: logErr } = await admin
    .from("attendance_logs")
    .select("*")
    .eq("store_id", storeId)
    .eq("cast_id", castId)
    .eq("attended_date", attendedDate)
    .maybeSingle();

  if (logErr) {
    logPostgrestError("GET attendance-logs/lookup", logErr);
    return NextResponse.json({ error: "Failed to load attendance log" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, attendance_log: log ?? null });
}
