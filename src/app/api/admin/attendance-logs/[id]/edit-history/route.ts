import { NextResponse } from "next/server";
import type { User } from "@supabase/supabase-js";
import type { Json } from "@/types/database";
import { createServiceRoleClient } from "@/lib/supabase-service";
import { isValidStoreId, parseActiveStoreIdFromCookieHeader } from "@/lib/current-store";
import { canUserEditStore, getAuthedUserForAdminApi } from "@/lib/admin-store-auth";
import { isSuperAdminUser } from "@/lib/super-admin";
import { logPostgrestError } from "@/lib/postgrest-error";

export const dynamic = "force-dynamic";

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

async function resolveEditorLabels(
  admin: ReturnType<typeof createServiceRoleClient>,
  userIds: string[]
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  await Promise.all(
    userIds.map(async (uid) => {
      try {
        const { data, error } = await admin.auth.admin.getUserById(uid);
        if (error || !data?.user) {
          out.set(uid, uid.slice(0, 8) + "…");
          return;
        }
        const u = data.user;
        const meta = u.user_metadata as Record<string, unknown> | undefined;
        const name =
          (typeof meta?.full_name === "string" && meta.full_name.trim()) ||
          (typeof meta?.name === "string" && meta.name.trim()) ||
          "";
        out.set(uid, name || u.email?.trim() || uid.slice(0, 8) + "…");
      } catch {
        out.set(uid, uid.slice(0, 8) + "…");
      }
    })
  );
  return out;
}

/**
 * GET /api/admin/attendance-logs/[id]/edit-history?storeId=uuid
 * subject_attendance_log_id で監査行を取得（ログ削除後も参照可能）
 */
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
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
    logPostgrestError("GET edit-history createServiceRoleClient", e);
    return NextResponse.json({ error: "Server configuration error" }, { status: 500 });
  }

  const { data: subjectRows, error: subjectErr } = await admin
    .from("attendance_edit_histories")
    .select("id, old_data")
    .eq("subject_attendance_log_id", id.trim())
    .limit(1);

  if (subjectErr) {
    logPostgrestError("GET edit-history probe histories", subjectErr);
    return NextResponse.json({ error: "Failed to load histories" }, { status: 500 });
  }

  /** old_data.store_id でテナントを検証（削除済みログは attendance_logs が無いため） */
  const probeOld = subjectRows?.[0]?.old_data as Record<string, unknown> | undefined;
  const storeFromHistory =
    probeOld && typeof probeOld.store_id === "string" ? probeOld.store_id : null;

  let storeOk = false;
  if (storeFromHistory === storeId) {
    storeOk = true;
  } else {
    const { data: row } = await admin
      .from("attendance_logs")
      .select("store_id")
      .eq("id", id.trim())
      .maybeSingle();
    storeOk = row ? String((row as { store_id?: string }).store_id ?? "") === storeId : false;
  }

  if (!storeOk) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { data: histories, error: histErr } = await admin
    .from("attendance_edit_histories")
    .select(
      "id, subject_attendance_log_id, attendance_log_id, edited_by_admin_id, action_type, old_data, new_data, created_at"
    )
    .eq("subject_attendance_log_id", id.trim())
    .order("created_at", { ascending: false });

  if (histErr) {
    logPostgrestError("GET edit-history list", histErr);
    return NextResponse.json({ error: "Failed to load histories" }, { status: 500 });
  }

  const rows = histories ?? [];
  const editorIds = [...new Set(rows.map((r) => String(r.edited_by_admin_id ?? "")))];
  const labels = await resolveEditorLabels(admin, editorIds);

  const payload = rows.map((r) => ({
    id: r.id,
    created_at: r.created_at,
    action_type: r.action_type,
    edited_by_admin_id: r.edited_by_admin_id,
    editor_display_name: labels.get(String(r.edited_by_admin_id ?? "")) ?? "—",
    old_data: r.old_data as Json,
    new_data: r.new_data as Json | null,
  }));

  return NextResponse.json({ ok: true, histories: payload });
}
