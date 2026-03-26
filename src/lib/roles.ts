import type { User } from "@supabase/supabase-js";
import { isValidStoreId } from "@/lib/current-store";

/** user_metadata.role: 店舗に紐づく管理者（店長） */
export const ROLE_STORE_ADMIN = "store_admin" as const;

/**
 * 店長アカウントかつ有効な store_id を metadata から取得。
 * ログイン後ミドルウェアでテナント Cookie に使用する。
 */
export function getStoreAdminStoreIdFromUser(user: User | null): string | null {
  if (!user) return null;
  const meta = user.user_metadata as Record<string, unknown> | undefined;
  if (meta?.role !== ROLE_STORE_ADMIN) return null;
  const id = meta.store_id;
  if (typeof id === "string" && isValidStoreId(id)) return id.trim();
  return null;
}
