/**
 * アクティブ店舗（テナント）の解決。
 *
 * - ブラウザ Cookie `raku_active_store_id`（スーパー管理者の切り替え）
 * - 未設定時は `NEXT_PUBLIC_DEFAULT_STORE_ID`
 *
 * サーバー（Route Handler / Middleware）では `resolveActiveStoreIdFromRequest` または
 * `getActiveStoreIdFromServerCookies` を使用。クライアントでは ActiveStoreContext の
 * `useActiveStoreId()` を使用。
 */

export const ACTIVE_STORE_COOKIE_NAME = "raku_active_store_id";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isValidStoreId(value: string | null | undefined): value is string {
  return !!value && UUID_RE.test(String(value).trim());
}

/** 環境変数のみ（Cookie なし）。ビルド時に埋め込まれる */
export function getDefaultStoreIdOrNull(): string | null {
  const id = process.env.NEXT_PUBLIC_DEFAULT_STORE_ID?.trim();
  return id && id.length > 0 ? id : null;
}

/**
 * @deprecated クライアントでは `useActiveStoreId()` を使う。サーバーでは `getActiveStoreIdFromServerCookies`。
 * 互換のため default のみ返す箇所向け。
 */
export function getCurrentStoreIdOrNull(): string | null {
  return getDefaultStoreIdOrNull();
}

/** Cookie ヘッダー文字列からアクティブ店舗 UUID を取得 */
export function parseActiveStoreIdFromCookieHeader(
  cookieHeader: string | null
): string | null {
  if (!cookieHeader?.trim()) return null;
  const parts = cookieHeader.split(";").map((s) => s.trim());
  const prefix = `${ACTIVE_STORE_COOKIE_NAME}=`;
  for (const p of parts) {
    if (p.startsWith(prefix)) {
      const raw = decodeURIComponent(p.slice(prefix.length));
      if (isValidStoreId(raw)) return raw.trim();
      return null;
    }
  }
  return null;
}

/**
 * Route Handler / Edge 向け: Request の Cookie から解決し、なければ環境変数。
 */
export function resolveActiveStoreIdFromRequest(request: Request): string {
  const fromCookie = parseActiveStoreIdFromCookieHeader(request.headers.get("cookie"));
  const fromEnv = getDefaultStoreIdOrNull();
  const id = fromCookie || fromEnv;
  if (!id) {
    throw new Error(
      "アクティブ店舗を解決できません。Cookie または NEXT_PUBLIC_DEFAULT_STORE_ID を設定してください。"
    );
  }
  return id;
}

/** リクエストボディの storeId が、Cookie/環境で解決したテナントと一致するか検証 */
export function assertStoreIdMatchesRequest(
  request: Request,
  requestStoreId: string | undefined | null
): void {
  const expected = resolveActiveStoreIdFromRequest(request);
  const got = requestStoreId?.trim();
  if (!got || got !== expected) {
    throw new Error("Forbidden: store_id mismatch");
  }
}

/** アクティブ店舗 Cookie 用オプション（Middleware / set-active-store 共通） */
export function getActiveStoreCookieOptions(): {
  path: string;
  maxAge: number;
  sameSite: "lax";
  httpOnly: boolean;
  secure: boolean;
} {
  return {
    path: "/",
    maxAge: 60 * 60 * 24 * 400,
    sameSite: "lax",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
  };
}
