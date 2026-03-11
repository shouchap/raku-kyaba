import { createClient } from "@supabase/supabase-js";

/**
 * クライアント用 Supabase クライアント
 * NEXT_PUBLIC_ プレフィックスでブラウザから利用可能
 */
export function createBrowserSupabaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY must be set"
    );
  }

  return createClient(url, key);
}
