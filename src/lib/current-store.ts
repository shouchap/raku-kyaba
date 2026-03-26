/**
 * 現在のテナント（店舗）識別子。
 *
 * 当面は `NEXT_PUBLIC_DEFAULT_STORE_ID`（Club GOLD 等の UUID）で固定。
 * 将来は Supabase Auth の user_metadata / profiles の store_id に差し替え可能。
 *
 * クライアント・サーバー両方で import 可（NEXT_PUBLIC_* はビルド時に埋め込まれる）。
 */

/** 未設定時は null（画面でエラー表示に使う） */
export function getCurrentStoreIdOrNull(): string | null {
  const id = process.env.NEXT_PUBLIC_DEFAULT_STORE_ID?.trim();
  return id && id.length > 0 ? id : null;
}

/**
 * 必須で店舗 ID が欲しい API / サーバー処理用。
 * 未設定の場合は例外（デプロイ設定ミスを早期に検知）
 */
export function getCurrentStoreId(): string {
  const id = getCurrentStoreIdOrNull();
  if (!id) {
    throw new Error(
      "NEXT_PUBLIC_DEFAULT_STORE_ID が未設定です。SaaS ではアクティブ店舗の UUID を設定してください。"
    );
  }
  return id;
}

/** API でクライアントから渡された storeId が環境のテナントと一致するか検証 */
export function assertStoreIdMatchesRequest(requestStoreId: string | undefined | null): void {
  const expected = getCurrentStoreId();
  const got = requestStoreId?.trim();
  if (!got || got !== expected) {
    throw new Error("Forbidden: store_id mismatch");
  }
}
