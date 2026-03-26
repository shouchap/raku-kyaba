import { createClient } from "@supabase/supabase-js";

/** RLS バイパス（店舗一覧・店舗管理 API 等）。サーバー専用。 */
export function createServiceRoleClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url?.trim()) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_URL");
  }
  if (!key?.trim()) {
    throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY (required for server-side admin APIs)");
  }
  return createClient(url.trim(), key.trim());
}
