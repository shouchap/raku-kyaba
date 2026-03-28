import type { SupabaseClient } from "@supabase/supabase-js";

export type LineTokenSource = "store" | "env" | "none";

/**
 * DB の stores.line_channel_access_token が空なら環境変数 LINE_CHANNEL_ACCESS_TOKEN にフォールバック。
 * ログにはトークン本体を出さず source と長さのみ。
 */
export function resolveLineChannelAccessToken(
  lineChannelAccessTokenFromDb: string | null | undefined
): { token: string; source: LineTokenSource; storeRawLength: number } {
  const raw = lineChannelAccessTokenFromDb;
  const asString = raw == null ? "" : String(raw).trim();
  const storeRawLength = raw == null ? 0 : String(raw).length;

  if (asString.length > 0) {
    return { token: asString, source: "store", storeRawLength };
  }

  const fromEnv = process.env.LINE_CHANNEL_ACCESS_TOKEN?.trim() ?? "";
  if (fromEnv.length > 0) {
    return { token: fromEnv, source: "env", storeRawLength };
  }

  return { token: "", source: "none", storeRawLength };
}

export function logResolvedLineToken(
  storeId: string,
  resolved: ReturnType<typeof resolveLineChannelAccessToken>,
  logTag = "[LineToken]"
): void {
  const envPresent = (process.env.LINE_CHANNEL_ACCESS_TOKEN?.trim() ?? "").length > 0;
  console.log(
    `${logTag} LINE channel access token storeId=${storeId} source=${resolved.source} ` +
      `resolvedTokenLength=${resolved.token.length} storeColumnRawLength=${resolved.storeRawLength} env_LINE_CHANNEL_ACCESS_TOKEN_present=${envPresent}`
  );
}

/**
 * 店舗ごとの Messaging API チャネルアクセストークンを解決（DB優先・なければ env）。
 * 利用できない場合は null。
 */
export async function fetchResolvedLineChannelAccessTokenForStore(
  supabase: SupabaseClient,
  storeId: string,
  logTag = "[LineToken]"
): Promise<{ token: string; source: LineTokenSource } | null> {
  const { data, error } = await supabase
    .from("stores")
    .select("line_channel_access_token")
    .eq("id", storeId)
    .maybeSingle();

  if (error) {
    console.warn(`${logTag} stores 取得エラー storeId=${storeId}:`, error.message);
  }

  const resolved = resolveLineChannelAccessToken(
    (data as { line_channel_access_token?: string | null } | null)?.line_channel_access_token
  );
  logResolvedLineToken(storeId, resolved, logTag);
  if (!resolved.token) return null;
  return { token: resolved.token, source: resolved.source };
}
