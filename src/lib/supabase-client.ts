import { createBrowserClient } from "@supabase/ssr";

/**
 * クライアント用 Supabase クライアント
 * @supabase/ssr の createBrowserClient を使用し、セッションを cookie に保存。
 * これにより middleware でログイン状態をチェックできる。
 */
export function createBrowserSupabaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !key) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL and (NEXT_PUBLIC_SUPABASE_ANON_KEY or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) must be set"
    );
  }

  return createBrowserClient(url, key);
}
