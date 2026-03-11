import { createClient } from "@supabase/supabase-js";

/**
 * Supabase クライアント（サービスロール）
 *
 * 設計意図:
 * - WebhookはLINEからのサーバー間通信のため、ユーザー認証なしでサービスロールを使用
 * - RLSはバイパスされ、store_idによるテナントフィルタはアプリケーション層で実施
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
