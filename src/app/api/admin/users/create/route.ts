import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { isValidStoreId } from "@/lib/current-store";
import { ROLE_STORE_ADMIN } from "@/lib/roles";
import { createServiceRoleClient } from "@/lib/supabase-service";
import { isSuperAdminUser } from "@/lib/super-admin";

export const dynamic = "force-dynamic";

/** 内部ログイン用ユーザー名（小文字英数・先頭英数、3〜32文字） */
const STORE_ADMIN_USERNAME_RE = /^[a-z0-9][a-z0-9_-]{2,31}$/;

const MIN_PASSWORD_LEN = 8;

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

type Body = {
  storeId?: string;
  username?: string;
  password?: string;
};

/**
 * 店長用ログインアカウントを発行（スーパー管理者のみ）
 * POST { storeId, username, password }
 * メール: `{username}@raku-kyaba.internal`
 */
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

  let body: Body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const storeId = body.storeId?.trim();
  const rawUser = body.username?.trim() ?? "";
  const password = body.password ?? "";

  if (!storeId || !isValidStoreId(storeId)) {
    return NextResponse.json(
      { error: "有効な店舗 ID が必要です", code: "invalid_store" },
      { status: 400 }
    );
  }

  if (!rawUser) {
    return NextResponse.json(
      { error: "ユーザー名を入力してください", code: "username_required" },
      { status: 400 }
    );
  }

  const username = rawUser.toLowerCase();
  if (rawUser.includes("@")) {
    return NextResponse.json(
      {
        error: "ユーザー名に @ は使えません（メール形式は自動で付与されます）",
        code: "invalid_username",
      },
      { status: 400 }
    );
  }
  if (!STORE_ADMIN_USERNAME_RE.test(username)) {
    return NextResponse.json(
      {
        error:
          "ユーザー名は 3〜32 文字の英小文字・数字・-_ で、先頭は英数字にしてください",
        code: "invalid_username",
      },
      { status: 400 }
    );
  }

  if (password.length < MIN_PASSWORD_LEN) {
    return NextResponse.json(
      {
        error: `パスワードは ${MIN_PASSWORD_LEN} 文字以上にしてください`,
        code: "weak_password",
      },
      { status: 400 }
    );
  }

  let admin;
  try {
    admin = createServiceRoleClient();
  } catch (e) {
    console.error("[users/create] service role:", e);
    return NextResponse.json(
      { error: "サーバー設定エラー（Service Role）", code: "config" },
      { status: 500 }
    );
  }

  const { data: storeRow, error: storeErr } = await admin
    .from("stores")
    .select("id")
    .eq("id", storeId)
    .maybeSingle();

  if (storeErr || !storeRow) {
    return NextResponse.json(
      { error: "指定した店舗が見つかりません", code: "store_not_found" },
      { status: 404 }
    );
  }

  const email = `${username}@raku-kyaba.internal`;

  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: {
      username,
      store_id: storeId,
      role: ROLE_STORE_ADMIN,
    },
  });

  if (createErr) {
    const msg = createErr.message ?? "";
    const lower = msg.toLowerCase();
    if (
      lower.includes("already") ||
      lower.includes("registered") ||
      lower.includes("exists") ||
      createErr.status === 422
    ) {
      return NextResponse.json(
        {
          error: "このユーザー名（メール）は既に登録されています",
          code: "user_exists",
        },
        { status: 409 }
      );
    }
    console.error("[users/create] createUser:", createErr);
    return NextResponse.json(
      { error: msg || "ユーザーの作成に失敗しました", code: createErr.code ?? "create_failed" },
      { status: 400 }
    );
  }

  return NextResponse.json({
    ok: true,
    userId: created.user?.id ?? null,
    email,
    username,
    storeId,
  });
}
