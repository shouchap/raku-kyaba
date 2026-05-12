import { NextResponse } from "next/server";
import type { User } from "@supabase/supabase-js";
import { createServiceRoleClient } from "@/lib/supabase-service";
import { canUserEditStore, getAuthedUserForAdminApi } from "@/lib/admin-store-auth";
import { isValidStoreId, parseActiveStoreIdFromCookieHeader } from "@/lib/current-store";
import { isSuperAdminUser } from "@/lib/super-admin";
import { getTodayJst } from "@/lib/date-utils";
import { fetchSchedulesForPreOpenReport } from "@/lib/pre-open-report-fetch";
import { buildPreOpenReportMessageByBusinessType } from "@/lib/pre-open-report-message";
import { applyPreOpenReportCustomization } from "@/lib/pre-open-report-customization";

export const dynamic = "force-dynamic";

function rejectStoreMismatch(request: Request, user: User, storeId: string): NextResponse | null {
  if (isSuperAdminUser(user)) return null;
  const cookieStoreId = parseActiveStoreIdFromCookieHeader(request.headers.get("cookie"));
  if (cookieStoreId && cookieStoreId !== storeId) {
    return NextResponse.json({ error: "storeId must match active store (cookie)" }, { status: 403 });
  }
  return null;
}

function collectCastNames(rows: unknown[]): string[] {
  const names = new Set<string>();
  for (const row of rows) {
    const casts = (row as { casts?: unknown }).casts;
    const cast = Array.isArray(casts) ? casts[0] : casts;
    const n = (cast as { name?: string; display_name?: string | null } | null)?.display_name
      ?? (cast as { name?: string } | null)?.name;
    const t = typeof n === "string" ? n.trim() : "";
    if (t) names.add(t);
  }
  return [...names];
}

function anonymizeCastNames(message: string, rows: unknown[]): string {
  const names = collectCastNames(rows).sort((a, b) => b.length - a.length);
  let out = message;
  names.forEach((name, idx) => {
    out = out.replaceAll(name, `キャスト${idx + 1}`);
  });
  return out;
}

export async function GET(request: Request) {
  const { user, error } = await getAuthedUserForAdminApi();
  if (error === "config") return NextResponse.json({ error: "Supabase is not configured" }, { status: 500 });
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const params = new URL(request.url).searchParams;
  const storeId = params.get("storeId")?.trim() ?? "";
  const targetDateRaw = params.get("targetDate")?.trim() ?? "";
  const targetDate = /^\d{4}-\d{2}-\d{2}$/.test(targetDateRaw) ? targetDateRaw : getTodayJst();

  if (!isValidStoreId(storeId)) {
    return NextResponse.json({ error: "Valid storeId is required" }, { status: 400 });
  }
  if (!canUserEditStore(user, storeId)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const mismatch = rejectStoreMismatch(request, user, storeId);
  if (mismatch) return mismatch;

  const admin = createServiceRoleClient();
  const { data: store } = await admin
    .from("stores")
    .select("id, name, business_type")
    .eq("id", storeId)
    .maybeSingle();
  if (!store?.id) return NextResponse.json({ error: "Store not found" }, { status: 404 });

  const { data: schedules, error: schedErr } = await fetchSchedulesForPreOpenReport(
    admin,
    storeId,
    targetDate,
    "[admin/pre-open-report-preview]"
  );
  if (schedErr) {
    return NextResponse.json(
      { error: "シフト取得に失敗しました", details: schedErr.message },
      { status: 500 }
    );
  }

  const base = buildPreOpenReportMessageByBusinessType(
    store.business_type,
    store.name ?? "店舗",
    targetDate,
    schedules ?? []
  );
  const baseMessage = anonymizeCastNames(base, schedules ?? []);
  const { data: cfgRow } = await admin
    .from("system_settings")
    .select("value")
    .eq("store_id", storeId)
    .eq("key", "reminder_config")
    .maybeSingle();
  const cfg = (cfgRow?.value ?? {}) as Record<string, unknown>;
  const message = applyPreOpenReportCustomization(baseMessage, cfg);

  return NextResponse.json({
    ok: true,
    targetDate,
    baseMessage,
    message,
  });
}

