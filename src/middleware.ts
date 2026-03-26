import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { isSuperAdminUser } from "@/lib/super-admin";

/**
 * Supabase Auth を使った認証ガード
 * - /admin 以下: 未ログイン時は / へリダイレクト
 * - /: ログイン済み時は /admin/weekly へリダイレクト
 */
export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    return response;
  }

  const supabase = createServerClient(supabaseUrl, supabaseKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options)
        );
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const pathname = request.nextUrl.pathname;

  // /admin 以下: 未ログインはトップへ
  if (pathname.startsWith("/admin")) {
    if (!user) {
      return NextResponse.redirect(new URL("/", request.url));
    }

    // スーパー管理者専用: 店舗マスタ（許可リスト未設定時は制限なし）
    if (pathname.startsWith("/admin/stores")) {
      if (!isSuperAdminUser(user)) {
        return NextResponse.redirect(new URL("/admin/weekly", request.url));
      }
    }
  }

  // トップページ: ログイン済みは /admin/weekly へ
  if (pathname === "/") {
    if (user) {
      return NextResponse.redirect(new URL("/admin/weekly", request.url));
    }
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * 以下を除外:
     * - _next/static (静的ファイル)
     * - _next/image (画像最適化)
     * - favicon.ico
     * - /api (APIルート)
     * - 画像等の静的拡張子
     */
    "/((?!_next/static|_next/image|favicon.ico|api|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js)$).*)",
  ],
};
