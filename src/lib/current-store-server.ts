import { cookies } from "next/headers";
import {
  ACTIVE_STORE_COOKIE_NAME,
  getDefaultStoreIdOrNull,
  isValidStoreId,
} from "@/lib/current-store";

/**
 * App Router の Server Component / Server Action から Cookie を読み、
 * アクティブ店舗 ID を返す。Cookie が無い・不正なときは環境変数にフォールバック。
 */
export async function getActiveStoreIdFromServerCookies(): Promise<string> {
  const id = await tryGetActiveStoreIdFromServerCookies();
  if (!id) {
    throw new Error(
      "NEXT_PUBLIC_DEFAULT_STORE_ID が未設定で、アクティブ店舗 Cookie もありません。"
    );
  }
  return id;
}

export async function tryGetActiveStoreIdFromServerCookies(): Promise<string | null> {
  const cookieStore = await cookies();
  const raw = cookieStore.get(ACTIVE_STORE_COOKIE_NAME)?.value;
  const fromCookie = isValidStoreId(raw) ? raw!.trim() : null;
  const fromEnv = getDefaultStoreIdOrNull();
  return fromCookie || fromEnv || null;
}
