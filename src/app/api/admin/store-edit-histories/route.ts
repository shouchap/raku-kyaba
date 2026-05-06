import { NextResponse } from "next/server";
import type { User } from "@supabase/supabase-js";
import { createServiceRoleClient } from "@/lib/supabase-service";
import { isValidStoreId, parseActiveStoreIdFromCookieHeader } from "@/lib/current-store";
import { canUserEditStore, getAuthedUserForAdminApi } from "@/lib/admin-store-auth";
import { isSuperAdminUser } from "@/lib/super-admin";
import { logPostgrestError } from "@/lib/postgrest-error";
import {
  pickAttendedDateFromHistoryPayload,
  pickCastIdFromHistoryPayload,
  summarizeAttendanceEditHistoryDetail,
} from "@/lib/attendance-edit-history-detail";

export const dynamic = "force-dynamic";

const DEFAULT_LIMIT = 50;

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

type RpcHistoryRow = {
  id: string;
  subject_attendance_log_id: string;
  attendance_log_id: string | null;
  edited_by_admin_id: string;
  action_type: string;
  old_data: unknown;
  new_data: unknown;
  created_at: string;
};

/**
 * GET /api/admin/store-edit-histories?storeId=uuid&limit=50
 * 店舗に紐づく勤怠監査ログを新しい順に最大 limit 件（既定50）
 */
export async function GET(request: Request) {
  const { user, error: authErr } = await getAuthedUserForAdminApi();
  if (authErr === "config") {
    return NextResponse.json({ error: "Supabase is not configured" }, { status: 500 });
  }
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const storeId = url.searchParams.get("storeId")?.trim() ?? "";
  if (!storeId || !isValidStoreId(storeId)) {
    return NextResponse.json({ error: "Valid storeId is required" }, { status: 400 });
  }

  const limitRaw = url.searchParams.get("limit");
  let limit = DEFAULT_LIMIT;
  if (limitRaw !== null && limitRaw !== "") {
    const n = Number(limitRaw);
    if (!Number.isFinite(n) || n < 1) {
      return NextResponse.json({ error: "Invalid limit" }, { status: 400 });
    }
    limit = Math.min(Math.floor(n), 200);
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
    logPostgrestError("GET store-edit-histories createServiceRoleClient", e);
    return NextResponse.json({ error: "Server configuration error" }, { status: 500 });
  }

  const { data: rpcRows, error: rpcErr } = await admin.rpc("fetch_store_attendance_edit_histories", {
    p_store_id: storeId,
    p_limit: limit,
  });

  if (rpcErr) {
    logPostgrestError("GET store-edit-histories rpc", rpcErr);
    return NextResponse.json(
      {
        error: "Failed to load histories",
        details:
          rpcErr.message?.includes("fetch_store_attendance_edit_histories") ||
          rpcErr.code === "PGRST202"
            ? "データベースに関数 fetch_store_attendance_edit_histories が未適用の可能性があります（マイグレーション 047 を適用してください）。"
            : rpcErr.message,
      },
      { status: 500 }
    );
  }

  const rows = (rpcRows ?? []) as RpcHistoryRow[];

  const editorIds = [...new Set(rows.map((r) => String(r.edited_by_admin_id ?? "")))];
  const editorLabels = await resolveEditorLabels(admin, editorIds);

  const castIds = [
    ...new Set(
      rows
        .map((r) => pickCastIdFromHistoryPayload(r.old_data, r.new_data))
        .filter((id): id is string => Boolean(id))
    ),
  ];

  const castNameById = new Map<string, string>();
  if (castIds.length > 0) {
    const { data: casts, error: castErr } = await admin
      .from("casts")
      .select("id, name")
      .eq("store_id", storeId)
      .in("id", castIds);
    if (castErr) {
      logPostgrestError("GET store-edit-histories casts", castErr);
      return NextResponse.json({ error: "Failed to resolve cast names" }, { status: 500 });
    }
    for (const c of casts ?? []) {
      const row = c as { id?: string; name?: string | null };
      if (row.id) castNameById.set(row.id, String(row.name ?? "").trim() || "（名前なし）");
    }
  }

  const payload = rows.map((r) => {
    const castId = pickCastIdFromHistoryPayload(r.old_data, r.new_data);
    const attendedDate = pickAttendedDateFromHistoryPayload(r.old_data, r.new_data);
    const castName =
      castId && castNameById.has(castId) ? castNameById.get(castId)! : castId ? "（他店／削除済みキャスト）" : "—";

    return {
      id: r.id,
      created_at: r.created_at,
      action_type: r.action_type,
      edited_by_admin_id: r.edited_by_admin_id,
      editor_display_name: editorLabels.get(String(r.edited_by_admin_id ?? "")) ?? "—",
      cast_id: castId,
      cast_name: castName,
      attended_date: attendedDate,
      detail_summary: summarizeAttendanceEditHistoryDetail({
        action_type: r.action_type,
        old_data: r.old_data,
        new_data: r.new_data,
      }),
    };
  });

  return NextResponse.json({ ok: true, histories: payload });
}
