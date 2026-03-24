import { createBrowserClient } from "@supabase/ssr";

type CreateBrowserSupabaseOptions = {
  /** true のとき fetch に cache: 'no-store' を付与（シフト表など常に最新DBを表示したい画面用） */
  fetchNoStore?: boolean;
};

/**
 * クライアント用 Supabase クライアント
 * @supabase/ssr の createBrowserClient を使用し、セッションを cookie に保存。
 * これにより middleware でログイン状態をチェックできる。
 */
export function createBrowserSupabaseClient(options?: CreateBrowserSupabaseOptions) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !key) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL and (NEXT_PUBLIC_SUPABASE_ANON_KEY or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) must be set"
    );
  }

  const fetchImpl =
    options?.fetchNoStore === true
      ? (input: RequestInfo | URL, init?: RequestInit) =>
          fetch(input, { ...init, cache: "no-store" })
      : undefined;

  return createBrowserClient(url, key, fetchImpl ? { global: { fetch: fetchImpl } } : undefined);
}
