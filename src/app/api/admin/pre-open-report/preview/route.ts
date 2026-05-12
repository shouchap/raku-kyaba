import { NextResponse } from "next/server";
import type { User } from "@supabase/supabase-js";
import { createServiceRoleClient } from "@/lib/supabase-service";
import { canUserEditStore, getAuthedUserForAdminApi } from "@/lib/admin-store-auth";
import { isValidStoreId, parseActiveStoreIdFromCookieHeader } from "@/lib/current-store";
import { isSuperAdminUser } from "@/lib/super-admin";
import { getTodayJst } from "@/lib/date-utils";
import { fetchSchedulesForPreOpenReport } from "@/lib/pre-open-report-fetch";
import { buildPreOpenReportMessageByBusinessType } from "@/lib/pre-open-report-message";

export const dynamic = "force-dynamic";

function rejectStoreMismatch(request: Request, user: User, storeId: string): NextResponse | null {
  if (isSuperAdminUser(user)) return null;
  const cookieStoreId = parseActiveStoreIdFromCookieHeader(request.headers.get("cookie"));
  if (cookieStoreId && cookieStoreId !== storeId) {
    return NextResponse.json({ error: "storeId must match active store (cookie)" }, { status: 403 });
  }
  return null;
}

function applyPreOpenMessageCustomization(
  base: string,
  cfg: Record<string, unknown> | null | undefined
): string {
  const pre = typeof cfg?.pre_open_report_prefix === "string" ? cfg.pre_open_report_prefix.trim() : "";
  const post = typeof cfg?.pre_open_report_suffix === "string" ? cfg.pre_open_report_suffix.trim() : "";
  return [pre, base, post].filter(Boolean).join("\n");
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
  const { data: cfgRow } = await admin
    .from("system_settings")
    .select("value")
    .eq("store_id", storeId)
    .eq("key", "reminder_config")
    .maybeSingle();
  const cfg = (cfgRow?.value ?? {}) as Record<string, unknown>;
  const message = applyPreOpenMessageCustomization(base, cfg);

  return NextResponse.json({
    ok: true,
    targetDate,
    message,
  });
}

