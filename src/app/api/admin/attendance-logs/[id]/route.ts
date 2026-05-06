import { NextResponse } from "next/server";
import type { User } from "@supabase/supabase-js";
import type { Database, Json } from "@/types/database";
import { createServiceRoleClient } from "@/lib/supabase-service";
import { isValidStoreId, parseActiveStoreIdFromCookieHeader } from "@/lib/current-store";
import { canUserEditStore, getAuthedUserForAdminApi } from "@/lib/admin-store-auth";
import { isSuperAdminUser } from "@/lib/super-admin";
import { logPostgrestError } from "@/lib/postgrest-error";

export const dynamic = "force-dynamic";

const VALID_STATUS = new Set([
  "attending",
  "absent",
  "late",
  "public_holiday",
  "half_holiday",
]);

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

function cloneRowJson(row: Record<string, unknown>): Json {
  return JSON.parse(JSON.stringify(row)) as Json;
}

function buildPatchFromBody(raw: unknown): {
  patch: Record<string, unknown>;
  error: string | null;
} {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return { patch: {}, error: "JSON body required" };
  }
  const body = raw as Record<string, unknown>;
  const patch: Record<string, unknown> = {};

  if ("status" in body) {
    const st = body.status;
    if (typeof st !== "string" || !VALID_STATUS.has(st)) {
      return { patch: {}, error: "Invalid status" };
    }
    patch.status = st;
  }

  if ("planned_groups" in body) {
    const v = body.planned_groups;
    if (v === null) {
      patch.planned_groups = null;
    } else if (typeof v === "number" && Number.isFinite(v)) {
      patch.planned_groups = v;
    } else if (typeof v === "string" && v.trim() !== "") {
      const n = Number(v);
      if (!Number.isFinite(n)) return { patch: {}, error: "Invalid planned_groups" };
      patch.planned_groups = n;
    } else {
      return { patch: {}, error: "Invalid planned_groups" };
    }
  }

  if ("tentative_groups" in body) {
    const v = body.tentative_groups;
    let n: number;
    if (typeof v === "number" && Number.isFinite(v)) n = Math.trunc(v);
    else if (typeof v === "string" && v.trim() !== "") {
      const p = Number(v);
      if (!Number.isFinite(p)) return { patch: {}, error: "Invalid tentative_groups" };
      n = Math.trunc(p);
    } else {
      return { patch: {}, error: "Invalid tentative_groups" };
    }
    patch.tentative_groups = Math.max(0, n);
  }

  if ("action_type" in body) {
    const v = body.action_type;
    patch.action_type = v === null || v === "" ? null : String(v).trim().slice(0, 64);
  }

  if ("action_detail" in body) {
    const v = body.action_detail;
    patch.action_detail = v === null || v === "" ? null : String(v).trim().slice(0, 255);
  }

  if ("is_sabaki" in body) {
    patch.is_sabaki = Boolean(body.is_sabaki);
  }

  if ("public_holiday_reason" in body) {
    const v = body.public_holiday_reason;
    patch.public_holiday_reason =
      v === null || v === "" ? null : String(v).trim().slice(0, 1024);
  }

  if ("half_holiday_reason" in body) {
    const v = body.half_holiday_reason;
    patch.half_holiday_reason =
      v === null || v === "" ? null : String(v).trim().slice(0, 1024);
  }

  if ("has_reservation" in body) {
    const v = body.has_reservation;
    patch.has_reservation =
      v === null ? null : typeof v === "boolean" ? v : Boolean(v);
  }

  if ("reservation_details" in body) {
    const v = body.reservation_details;
    patch.reservation_details =
      v === null || v === "" ? null : String(v).trim().slice(0, 2048);
  }

  return { patch, error: null };
}

/**
 * PATCH /api/admin/attendance-logs/[id]?storeId=uuid
 * DELETE /api/admin/attendance-logs/[id]?storeId=uuid
 */
export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!id?.trim()) {
    return NextResponse.json({ error: "Missing attendance log id" }, { status: 400 });
  }

  const { user, error: authErr } = await getAuthedUserForAdminApi();
  if (authErr === "config") {
    return NextResponse.json({ error: "Supabase is not configured" }, { status: 500 });
  }
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const storeId = new URL(request.url).searchParams.get("storeId")?.trim() ?? "";
  if (!storeId || !isValidStoreId(storeId)) {
    return NextResponse.json({ error: "Valid storeId is required" }, { status: 400 });
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

  const { patch, error: patchErr } = buildPatchFromBody(bodyRaw);
  if (patchErr) {
    return NextResponse.json({ error: patchErr }, { status: 400 });
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  let admin;
  try {
    admin = createServiceRoleClient();
  } catch (e) {
    logPostgrestError("PATCH attendance-logs createServiceRoleClient", e);
    return NextResponse.json({ error: "Server configuration error" }, { status: 500 });
  }

  const { data: existing, error: fetchErr } = await admin
    .from("attendance_logs")
    .select("*")
    .eq("id", id.trim())
    .maybeSingle();

  if (fetchErr) {
    logPostgrestError("PATCH attendance-logs fetch", fetchErr);
    return NextResponse.json({ error: "Failed to load attendance log" }, { status: 500 });
  }
  if (!existing || String((existing as { store_id?: string }).store_id ?? "") !== storeId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const oldSnap = cloneRowJson(existing as Record<string, unknown>);

  const { data: updated, error: updErr } = await admin
    .from("attendance_logs")
    .update(patch as Database["public"]["Tables"]["attendance_logs"]["Update"])
    .eq("id", id.trim())
    .select("*")
    .single();

  if (updErr || !updated) {
    logPostgrestError("PATCH attendance-logs update", updErr ?? new Error("no row"));
    return NextResponse.json({ error: "Failed to update attendance log" }, { status: 500 });
  }

  const newSnap = cloneRowJson(updated as Record<string, unknown>);

  const { error: histErr } = await admin.from("attendance_edit_histories").insert({
    subject_attendance_log_id: id.trim(),
    attendance_log_id: id.trim(),
    edited_by_admin_id: user.id,
    action_type: "UPDATE",
    old_data: oldSnap,
    new_data: newSnap,
  });

  if (histErr) {
    logPostgrestError("PATCH attendance-logs insert history", histErr);
    return NextResponse.json(
      { error: "Updated log but failed to record audit history", details: histErr.message },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true, attendance_log: updated });
}

export async function DELETE(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!id?.trim()) {
    return NextResponse.json({ error: "Missing attendance log id" }, { status: 400 });
  }

  const { user, error: authErr } = await getAuthedUserForAdminApi();
  if (authErr === "config") {
    return NextResponse.json({ error: "Supabase is not configured" }, { status: 500 });
  }
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const storeId = new URL(request.url).searchParams.get("storeId")?.trim() ?? "";
  if (!storeId || !isValidStoreId(storeId)) {
    return NextResponse.json({ error: "Valid storeId is required" }, { status: 400 });
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
    logPostgrestError("DELETE attendance-logs createServiceRoleClient", e);
    return NextResponse.json({ error: "Server configuration error" }, { status: 500 });
  }

  const { data: existing, error: fetchErr } = await admin
    .from("attendance_logs")
    .select("*")
    .eq("id", id.trim())
    .maybeSingle();

  if (fetchErr) {
    logPostgrestError("DELETE attendance-logs fetch", fetchErr);
    return NextResponse.json({ error: "Failed to load attendance log" }, { status: 500 });
  }
  if (!existing || String((existing as { store_id?: string }).store_id ?? "") !== storeId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const oldSnap = cloneRowJson(existing as Record<string, unknown>);

  const { error: histErr } = await admin.from("attendance_edit_histories").insert({
    subject_attendance_log_id: id.trim(),
    attendance_log_id: id.trim(),
    edited_by_admin_id: user.id,
    action_type: "DELETE",
    old_data: oldSnap,
    new_data: null,
  });

  if (histErr) {
    logPostgrestError("DELETE attendance-logs insert history", histErr);
    return NextResponse.json(
      { error: "Failed to record audit history", details: histErr.message },
      { status: 500 }
    );
  }

  const { error: delErr } = await admin.from("attendance_logs").delete().eq("id", id.trim());

  if (delErr) {
    logPostgrestError("DELETE attendance-logs delete", delErr);
    return NextResponse.json({ error: "Failed to delete attendance log" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
