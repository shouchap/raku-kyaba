import { NextResponse } from "next/server";
import type { User } from "@supabase/supabase-js";
import { createServiceRoleClient } from "@/lib/supabase-service";
import { isValidStoreId, parseActiveStoreIdFromCookieHeader } from "@/lib/current-store";
import { canUserEditStore, getAuthedUserForAdminApi } from "@/lib/admin-store-auth";
import { isSuperAdminUser } from "@/lib/super-admin";
import { logPostgrestError } from "@/lib/postgrest-error";
import { isDailyGuideResultsMissingSekGoldColumns } from "@/lib/daily-guide-results-compat";

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

const GUIDE_REPORT_SELECT_WITH_SEK_GOLD =
  "id, store_id, staff_name, target_date, sek_guide_count, sek_people_count, gold_guide_count, gold_people_count, guide_count, people_count, responded_at";

const GUIDE_REPORT_SELECT_LEGACY =
  "id, store_id, staff_name, target_date, guide_count, people_count, responded_at";

/** DB がマイグレーション040より前でも動くよう、合計をセク側へ寄せた行を返す */
function coerceLegacyGuideRows(
  rows: Array<{
    id: string;
    store_id: string;
    staff_name: string;
    target_date: string;
    guide_count: number;
    people_count: number | null;
    responded_at: string;
  }>
): Array<{
  id: string;
  store_id: string;
  staff_name: string;
  target_date: string;
  sek_guide_count: number;
  sek_people_count: number;
  gold_guide_count: number;
  gold_people_count: number;
  guide_count: number;
  people_count: number | null;
  responded_at: string;
}> {
  return rows.map((r) => {
    const people = typeof r.people_count === "number" ? r.people_count : 0;
    return {
      ...r,
      sek_guide_count: r.guide_count,
      sek_people_count: people,
      gold_guide_count: 0,
      gold_people_count: 0,
    };
  });
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

  let rowsFirst = await admin
    .from("daily_guide_results")
    .select(GUIDE_REPORT_SELECT_WITH_SEK_GOLD)
    .eq("store_id", storeId)
    .gte("target_date", start)
    .lte("target_date", end)
    .order("target_date", { ascending: false })
    .order("staff_name", { ascending: true });

  let outRows = rowsFirst.data ?? [];

  if (rowsFirst.error && isDailyGuideResultsMissingSekGoldColumns(rowsFirst.error.message)) {
    const legacy = await admin
      .from("daily_guide_results")
      .select(GUIDE_REPORT_SELECT_LEGACY)
      .eq("store_id", storeId)
      .gte("target_date", start)
      .lte("target_date", end)
      .order("target_date", { ascending: false })
      .order("staff_name", { ascending: true });

    if (legacy.error) {
      logPostgrestError("GET /api/admin/guide-report daily_guide_results (legacy)", legacy.error);
      return NextResponse.json(
        { error: "Failed to load guide results", details: legacy.error.message },
        { status: 500 }
      );
    }
    outRows = coerceLegacyGuideRows(legacy.data ?? []);
  } else if (rowsFirst.error) {
    logPostgrestError("GET /api/admin/guide-report daily_guide_results", rowsFirst.error);
    return NextResponse.json(
      { error: "Failed to load guide results", details: rowsFirst.error.message },
      { status: 500 }
    );
  }

  return NextResponse.json({
    ok: true,
    ym,
    period: { start, end },
    rows: outRows,
  });
}
