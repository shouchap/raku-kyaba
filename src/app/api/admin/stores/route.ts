import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { createServiceRoleClient } from "@/lib/supabase-service";
import { isSuperAdminUser } from "@/lib/super-admin";

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

/** 全店舗一覧（ヘッダーセレクター用）。認証済みユーザー。 */
export async function GET() {
  const { user, error } = await getAuthedUser();
  if (error === "config") {
    return NextResponse.json({ error: "Supabase is not configured" }, { status: 500 });
  }
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const admin = createServiceRoleClient();
    const { data, error: qErr } = await admin
      .from("stores")
      .select("id, name, created_at")
      .order("name");

    if (qErr) {
      console.error("[admin/stores GET]", qErr);
      return NextResponse.json({ error: qErr.message }, { status: 500 });
    }

    return NextResponse.json({ stores: data ?? [] });
  } catch (e) {
    console.error("[admin/stores GET]", e);
    return NextResponse.json(
      { error: "SUPABASE_SERVICE_ROLE_KEY may be missing on the server" },
      { status: 500 }
    );
  }
}

type CreateBody = {
  name?: string;
  line_channel_secret?: string;
  line_channel_access_token?: string;
  line_channel_id?: string;
  line_bot_user_id?: string;
  admin_line_user_id?: string;
};

/** 店舗新規作成。スーパー管理者のみ。 */
export async function POST(request: Request) {
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

  let body: CreateBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const name = body.name?.trim();
  const line_channel_secret = body.line_channel_secret?.trim();
  const line_channel_access_token = body.line_channel_access_token?.trim() ?? "";

  if (!name) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }
  if (!line_channel_secret) {
    return NextResponse.json({ error: "line_channel_secret is required" }, { status: 400 });
  }

  try {
    const admin = createServiceRoleClient();
    const { data, error: insErr } = await admin
      .from("stores")
      .insert({
        name,
        line_channel_secret,
        line_channel_access_token: line_channel_access_token || null,
        line_channel_id: body.line_channel_id?.trim() || null,
        line_bot_user_id: body.line_bot_user_id?.trim() || null,
        admin_line_user_id: body.admin_line_user_id?.trim() || null,
      })
      .select("id, name")
      .single();

    if (insErr) {
      console.error("[admin/stores POST]", insErr);
      return NextResponse.json({ error: insErr.message }, { status: 400 });
    }

    return NextResponse.json({ store: data });
  } catch (e) {
    console.error("[admin/stores POST]", e);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
