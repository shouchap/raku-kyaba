import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import {
  ACTIVE_STORE_COOKIE_NAME,
  getActiveStoreCookieOptions,
  isValidStoreId,
} from "@/lib/current-store";
import { getStoreAdminStoreIdFromUser } from "@/lib/roles";
import { createServiceRoleClient } from "@/lib/supabase-service";
import { isSuperAdminUser } from "@/lib/super-admin";

export const dynamic = "force-dynamic";

/**
 * アクティブ店舗を Cookie に保存（管理画面のテナント切り替え）
 * POST { storeId: string }
 */
export async function POST(request: Request) {
  const cookieStore = await cookies();
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    return NextResponse.json({ error: "Supabase is not configured" }, { status: 500 });
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

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { storeId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const storeId = body.storeId?.trim();
  if (!storeId || !isValidStoreId(storeId)) {
    return NextResponse.json({ error: "Valid storeId (UUID) is required" }, { status: 400 });
  }

  if (!isSuperAdminUser(user)) {
    const assigned = getStoreAdminStoreIdFromUser(user);
    if (!assigned || assigned !== storeId) {
      return NextResponse.json(
        { error: "店舗の切り替えはスーパー管理者のみ可能です" },
        { status: 403 }
      );
    }
  }

  try {
    const admin = createServiceRoleClient();
    const { data: row, error } = await admin
      .from("stores")
      .select("id")
      .eq("id", storeId)
      .maybeSingle();

    if (error || !row) {
      return NextResponse.json({ error: "Store not found" }, { status: 404 });
    }
  } catch (e) {
    console.error("[set-active-store] service role:", e);
    return NextResponse.json(
      { error: "Server configuration error (service role)" },
      { status: 500 }
    );
  }

  const res = NextResponse.json({ ok: true, storeId });
  res.cookies.set(ACTIVE_STORE_COOKIE_NAME, storeId, getActiveStoreCookieOptions());

  return res;
}
