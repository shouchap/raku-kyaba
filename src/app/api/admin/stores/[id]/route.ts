import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { createServiceRoleClient } from "@/lib/supabase-service";
import { isSuperAdminUser } from "@/lib/super-admin";
import { isValidStoreId } from "@/lib/current-store";

export const dynamic = "force-dynamic";

async function getAuthedUser() {
  const cookieStore = await cookies();
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    return { user: null, error: "config" as const };
  }

  const supabase = createServerClient(supabaseUrl, supabaseKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          );
        } catch {
          // ignore
        }
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { user, error: null };
}

type PatchBody = {
  name?: string;
  line_channel_secret?: string;
  line_channel_access_token?: string;
  line_channel_id?: string | null;
  line_bot_user_id?: string | null;
  admin_line_user_id?: string | null;
};

/** 店舗更新。スーパー管理者のみ。 */
export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { user, error } = await getAuthedUser();
  if (error === "config") {
    return NextResponse.json({ error: "Supabase is not configured" }, { status: 500 });
  }
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isSuperAdminUser(user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await context.params;
  if (!isValidStoreId(id)) {
    return NextResponse.json({ error: "Invalid store id" }, { status: 400 });
  }

  let body: PatchBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const updates: Record<string, unknown> = {};

  if (body.name !== undefined) {
    const n = String(body.name).trim();
    if (!n) {
      return NextResponse.json({ error: "name cannot be empty" }, { status: 400 });
    }
    updates.name = n;
  }
  if (body.line_channel_secret !== undefined) {
    const s = String(body.line_channel_secret).trim();
    if (!s) {
      return NextResponse.json({ error: "line_channel_secret cannot be empty" }, { status: 400 });
    }
    updates.line_channel_secret = s;
  }
  if (body.line_channel_access_token !== undefined) {
    updates.line_channel_access_token =
      String(body.line_channel_access_token).trim() || null;
  }
  if (body.line_channel_id !== undefined) {
    updates.line_channel_id = body.line_channel_id ? String(body.line_channel_id).trim() : null;
  }
  if (body.line_bot_user_id !== undefined) {
    updates.line_bot_user_id = body.line_bot_user_id
      ? String(body.line_bot_user_id).trim()
      : null;
  }
  if (body.admin_line_user_id !== undefined) {
    updates.admin_line_user_id = body.admin_line_user_id
      ? String(body.admin_line_user_id).trim()
      : null;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  updates.updated_at = new Date().toISOString();

  try {
    const admin = createServiceRoleClient();
    const { data, error: upErr } = await admin
      .from("stores")
      .update(updates)
      .eq("id", id)
      .select("id, name, line_channel_id, line_bot_user_id, admin_line_user_id, updated_at")
      .single();

    if (upErr) {
      console.error("[admin/stores PATCH]", upErr);
      return NextResponse.json({ error: upErr.message }, { status: 400 });
    }

    return NextResponse.json({ store: data });
  } catch (e) {
    console.error("[admin/stores PATCH]", e);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

/** 単一店舗の取得（編集フォーム用・機微フィールド含む）。スーパー管理者のみ。 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { user, error } = await getAuthedUser();
  if (error === "config") {
    return NextResponse.json({ error: "Supabase is not configured" }, { status: 500 });
  }
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isSuperAdminUser(user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await context.params;
  if (!isValidStoreId(id)) {
    return NextResponse.json({ error: "Invalid store id" }, { status: 400 });
  }

  try {
    const admin = createServiceRoleClient();
    const { data, error: qErr } = await admin
      .from("stores")
      .select(
        "id, name, line_channel_id, line_channel_secret, line_channel_access_token, line_bot_user_id, admin_line_user_id, created_at, updated_at"
      )
      .eq("id", id)
      .single();

    if (qErr || !data) {
      return NextResponse.json({ error: "Store not found" }, { status: 404 });
    }

    return NextResponse.json({ store: data });
  } catch (e) {
    console.error("[admin/stores GET id]", e);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
