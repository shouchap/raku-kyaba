/**
 * ミドルウェアで検証済みのユーザー情報を、レイアウトへ渡すための内部ヘッダ。
 * クライアントからの偽装を防ぐため、ミドルウェア側で必ず上書き・削除すること。
 */

export const ADMIN_AUTH_USER_ID_HEADER = "x-raku-admin-user-id";
export const ADMIN_AUTH_IS_SUPER_HEADER = "x-raku-admin-is-super";
export const ADMIN_AUTH_STORE_ID_HEADER = "x-raku-admin-store-id";

export type AdminAuthFromMiddleware = {
  userId: string;
  isSuperAdmin: boolean;
  /** 店長の場合のみ店舗 ID。スーパー管理者は null */
  storeAdminStoreId: string | null;
};

/** リクエストヘッダから、クライアント偽変可能な値を除去する */
export function clearAdminAuthHeaders(headers: Headers): void {
  headers.delete(ADMIN_AUTH_USER_ID_HEADER);
  headers.delete(ADMIN_AUTH_IS_SUPER_HEADER);
  headers.delete(ADMIN_AUTH_STORE_ID_HEADER);
}

export function setAdminAuthHeaders(
  headers: Headers,
  auth: AdminAuthFromMiddleware | null
): void {
  clearAdminAuthHeaders(headers);
  if (!auth) return;
  headers.set(ADMIN_AUTH_USER_ID_HEADER, auth.userId);
  headers.set(ADMIN_AUTH_IS_SUPER_HEADER, auth.isSuperAdmin ? "1" : "0");
  if (auth.storeAdminStoreId) {
    headers.set(ADMIN_AUTH_STORE_ID_HEADER, auth.storeAdminStoreId);
  }
}

export function readAdminAuthHeaders(
  headers: Headers
): AdminAuthFromMiddleware | null {
  const userId = headers.get(ADMIN_AUTH_USER_ID_HEADER)?.trim() ?? "";
  if (!userId) return null;
  const isSuperAdmin = headers.get(ADMIN_AUTH_IS_SUPER_HEADER) === "1";
  const storeAdminStoreId =
    headers.get(ADMIN_AUTH_STORE_ID_HEADER)?.trim().toLowerCase() || null;
  return {
    userId,
    isSuperAdmin,
    storeAdminStoreId,
  };
}
