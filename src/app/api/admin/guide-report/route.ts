import { NextResponse } from "next/server";
import type { User } from "@supabase/supabase-js";
import { createServiceRoleClient } from "@/lib/supabase-service";
import { isValidStoreId, parseActiveStoreIdFromCookieHeader } from "@/lib/current-store";
import { canUserEditStore, getAuthedUserForAdminApi } from "@/lib/admin-store-auth";
import { isSuperAdminUser } from "@/lib/super-admin";
import { logPostgrestError } from "@/lib/postgrest-error";

export const dynamic = "force-dynamic";

const YM_RE = /^\d{4}-\d{2}$/;

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

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function monthRangeFromYm(ym: string): { start: string; end: string } | null {
  if (!YM_RE.test(ym)) return null;
  const [yStr, mStr] = ym.split("-");
  const y = Number(yStr);
  const m = Number(mStr);
  if (m < 1 || m > 12 || y < 2000 || y > 2100) return null;
  const start = `${y}-${pad2(m)}-01`;
  const lastDay = new Date(y, m, 0).getDate();
  const end = `${y}-${pad2(m)}-${pad2(lastDay)}`;
  return { start, end };
}

/**
 * 案内数実績（daily_guide_results）を月単位で取得
 * GET /api/admin/guide-report?storeId=uuid&ym=YYYY-MM
 */
export async function GET(request: Request) {
  const { user, error } = await getAuthedUserForAdminApi();
  if (error === "config") {
    return NextResponse.json({ error: "Supabase is not configured" }, { status: 500 });
  }
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sp = new URL(request.url).searchParams;
  const storeId = sp.get("storeId")?.trim() ?? "";
  const ym = sp.get("ym")?.trim() ?? "";

  if (!storeId || !isValidStoreId(storeId)) {
    return NextResponse.json({ error: "Valid storeId is required" }, { status: 400 });
  }

  const range = monthRangeFromYm(ym);
  if (!range) {
    return NextResponse.json({ error: "ym must be YYYY-MM" }, { status: 400 });
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
    logPostgrestError("GET /api/admin/guide-report createServiceRoleClient", e);
    return NextResponse.json(
      { error: "Server configuration error (service role)" },
      { status: 500 }
    );
  }

  const { start, end } = range;

  const { data: rows, error: qErr } = await admin
    .from("daily_guide_results")
    .select("id, store_id, staff_name, target_date, guide_count, responded_at")
    .eq("store_id", storeId)
    .gte("target_date", start)
    .lte("target_date", end)
    .order("target_date", { ascending: false })
    .order("staff_name", { ascending: true });

  if (qErr) {
    logPostgrestError("GET /api/admin/guide-report daily_guide_results", qErr);
    return NextResponse.json(
      { error: "Failed to load guide results", details: qErr.message },
      { status: 500 }
    );
  }

  return NextResponse.json({
    ok: true,
    ym,
    period: { start, end },
    rows: rows ?? [],
  });
}
