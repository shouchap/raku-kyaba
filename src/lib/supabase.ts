import { createClient } from "@supabase/supabase-js";

/**
 * Supabase クライアント（サービスロール）
 *
 * 設計意図:
 * - WebhookはLINEからのサーバー間通信のため、ユーザー認証なしでサービスロールを使用
 * - service_role は RLS をバイパスする。テナント分離は API / Webhook 側で store_id を検証
 * - 管理画面ブラウザは anon＋ログイン JWT 経由。RLS は JWT の store_admin / super_admin を参照（021 マイグレーション）
 * - 型は簡易的に指定。本格運用時は `supabase gen types typescript` で生成を推奨
 */
export function createSupabaseClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set");
  }

  return createClient(url, key);
}
