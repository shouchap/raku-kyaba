import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import {
  clearAdminAuthHeaders,
  setAdminAuthHeaders,
} from "@/lib/admin-auth-headers";
import {
  ACTIVE_STORE_COOKIE_NAME,
  getActiveStoreCookieOptions,
} from "@/lib/current-store";
import { isMaintenanceMode } from "@/lib/maintenance";
import { getStoreAdminStoreIdFromUser } from "@/lib/roles";
import { isSuperAdminUser } from "@/lib/super-admin";

/**
 * Supabase Auth を使った認証ガード
 * - メンテナンスモード: 画面は /maintenance へ、/api/admin/* は 503
 * - /admin 以下: 未ログイン時は /login へリダイレクト
 * - / /login: ログイン済み時は /admin/weekly へリダイレクト（/guide は公開）
 */
export async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  /** Cloud Scheduler 用: /api/cron/* は認証・メンテ判定を一切通さず素通し */
  if (pathname.startsWith("/api/cron/")) {
    return NextResponse.next();
  }

  /** 管理 API: メンテナンス中は DB 不整合防止のため一括拒否 */
  if (pathname.startsWith("/api/admin")) {
    if (isMaintenanceMode()) {
      return NextResponse.json({ error: "maintenance_mode" }, { status: 503 });
    }
    return NextResponse.next();
  }

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-pathname", pathname);
  // クライアントからの偽装ヘッダを必ず除去（後で検証済み値だけを載せる）
  clearAdminAuthHeaders(requestHeaders);

  /** 画面: メンテナンス中は専用ページ以外へアクセスさせない */
  if (isMaintenanceMode()) {
    if (pathname === "/maintenance" || pathname.startsWith("/maintenance/")) {
      return NextResponse.next({
        request: { headers: requestHeaders },
      });
    }
    const url = request.nextUrl.clone();
    url.pathname = "/maintenance";
    url.search = "";
    return NextResponse.redirect(url);
  }

  /** 認証不要ページではセッション取得を省略し Edge の待ち時間を短縮 */
  const skipAuthSession =
    pathname === "/guide" ||
    pathname.startsWith("/guide/") ||
    pathname.startsWith("/cast/special-shift/");
  if (skipAuthSession) {
    return NextResponse.next({
      request: { headers: requestHeaders },
    });
  }

  let response = NextResponse.next({
    request: { headers: requestHeaders },
  });

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

  // レイアウト側の二重 getUser() を避けるため、検証済みロール情報を内部ヘッダで渡す
  if (user) {
    const isSuper = isSuperAdminUser(user);
    setAdminAuthHeaders(requestHeaders, {
      userId: user.id,
      isSuperAdmin: isSuper,
      storeAdminStoreId: isSuper ? null : getStoreAdminStoreIdFromUser(user),
    });
  }

  // getUser 後に載せたヘッダを RSC へ確実に渡すため、レスポンスを作り直す
  // （cookie 更新は getUser 中に response へ書かれているので引き継ぐ）
  const forwarded = NextResponse.next({
    request: { headers: requestHeaders },
  });
  for (const cookie of response.cookies.getAll()) {
    forwarded.cookies.set(cookie);
  }
  response = forwarded;

  if (pathname.startsWith("/admin")) {
    if (!user && !pathname.startsWith("/admin/view/submit")) {
      return NextResponse.redirect(new URL("/login", request.url));
    }

    if (user) {
      const isSuper = isSuperAdminUser(user);
      if (pathname.startsWith("/admin/stores")) {
        if (!isSuper) {
          return NextResponse.redirect(new URL("/admin/weekly", request.url));
        }
      }

      if (!isSuper) {
        const tenantId = getStoreAdminStoreIdFromUser(user);
        if (tenantId) {
          response.cookies.set(
            ACTIVE_STORE_COOKIE_NAME,
            tenantId,
            getActiveStoreCookieOptions()
          );
        }
      }
    }
  }

  if (pathname === "/" || pathname === "/login") {
    if (user) {
      return NextResponse.redirect(new URL("/admin/weekly", request.url));
    }
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * ページ等（api は除外）
     */
    "/((?!_next/static|_next/image|favicon.ico|api|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js)$).*)",
    "/api/admin/:path*",
    "/api/cron/:path*",
  ],
};
