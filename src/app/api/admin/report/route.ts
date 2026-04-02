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
 * 月間レポート用データ（B型は welfare_daily_logs + casts 名）
 * GET /api/admin/report?storeId=uuid&start=YYYY-MM-DD&end=YYYY-MM-DD
 * 単日: GET /api/admin/report?storeId=uuid&view=day&date=YYYY-MM-DD
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
  const view = sp.get("view")?.trim().toLowerCase() ?? "";

  let start: string;
  let end: string;

  if (view === "day") {
    const dayOnly = sp.get("date")?.trim() ?? "";
    if (!DATE_RE.test(dayOnly)) {
      return NextResponse.json(
        { error: "view=day requires date=YYYY-MM-DD (single JST calendar day)" },
        { status: 400 }
      );
    }
    start = dayOnly;
    end = dayOnly;
  } else {
    start = sp.get("start")?.trim() ?? "";
    end = sp.get("end")?.trim() ?? "";
    if (!DATE_RE.test(start) || !DATE_RE.test(end)) {
      return NextResponse.json(
        { error: "start and end must be YYYY-MM-DD (JST range as calendar dates)" },
        { status: 400 }
      );
    }
    if (start > end) {
      return NextResponse.json({ error: "start must be <= end" }, { status: 400 });
    }
  }

  if (!storeId || !isValidStoreId(storeId)) {
    return NextResponse.json({ error: "Valid storeId is required" }, { status: 400 });
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
    logPostgrestError("GET /api/admin/report createServiceRoleClient", e);
    return NextResponse.json(
      { error: "Server configuration error (service role)" },
      { status: 500 }
    );
  }

  const { data: storeRow, error: storeErr } = await admin
    .from("stores")
    .select("id, name, business_type")
    .eq("id", storeId)
    .maybeSingle();

  if (storeErr) {
    logPostgrestError("GET /api/admin/report stores", storeErr);
    return NextResponse.json(
      { error: "Failed to load store", details: storeErr.message },
      { status: 500 }
    );
  }
  if (!storeRow?.id) {
    return NextResponse.json({ error: "Store not found" }, { status: 404 });
  }

  const businessType = String(
    (storeRow as { business_type?: string | null }).business_type ?? "cabaret"
  );

  if (businessType !== "welfare_b") {
    return NextResponse.json({
      ok: true,
      business_type: "cabaret",
      store: { id: storeRow.id, name: String((storeRow as { name?: string }).name ?? "") },
      welfare_rows: null,
    });
  }

  const { data: logRows, error: logErr } = await admin
    .from("welfare_daily_logs")
    .select(
      "id, cast_id, work_date, started_at, ended_at, work_item, work_details, quantity, health_status, health_reason, health_notes"
    )
    .eq("store_id", storeId)
    .gte("work_date", start)
    .lte("work_date", end)
    .order("work_date", { ascending: false })
    .order("cast_id", { ascending: true });

  if (logErr) {
    logPostgrestError("GET /api/admin/report welfare_daily_logs", logErr);
    return NextResponse.json(
      { error: "Failed to load welfare daily logs", details: logErr.message, code: logErr.code },
      { status: 500 }
    );
  }

  const logs = (logRows ?? []) as Record<string, unknown>[];
  const castIds = [...new Set(logs.map((r) => String(r.cast_id ?? "")).filter(Boolean))];
  const nameByCastId = new Map<string, string>();
  if (castIds.length > 0) {
    const { data: castRows, error: castErr } = await admin
      .from("casts")
      .select("id, name")
      .eq("store_id", storeId)
      .in("id", castIds);
    if (castErr) {
      logPostgrestError("GET /api/admin/report casts", castErr);
      return NextResponse.json(
        { error: "Failed to load cast names", details: castErr.message },
        { status: 500 }
      );
    }
    for (const c of castRows ?? []) {
      const row = c as { id?: string; name?: string };
      if (row.id) nameByCastId.set(row.id, String(row.name ?? ""));
    }
  }

  const welfare_rows = logs.map((raw) => {
    const cid = String(raw.cast_id ?? "");
    return {
      id: String(raw.id ?? ""),
      cast_id: cid,
      cast_name: nameByCastId.get(cid) ?? "",
      work_date: String(raw.work_date ?? ""),
      started_at: (raw.started_at as string | null) ?? null,
      ended_at: (raw.ended_at as string | null) ?? null,
      work_item: (raw.work_item as string | null) ?? null,
      work_details: (raw.work_details as string | null) ?? null,
      quantity: typeof raw.quantity === "number" ? raw.quantity : null,
      health_status: (raw.health_status as string | null) ?? null,
      health_reason: (raw.health_reason as string | null) ?? null,
      health_notes: (raw.health_notes as string | null) ?? null,
    };
  });

  return NextResponse.json({
    ok: true,
    business_type: "welfare_b",
    store: { id: storeRow.id, name: String((storeRow as { name?: string }).name ?? "") },
    welfare_rows,
  });
}
