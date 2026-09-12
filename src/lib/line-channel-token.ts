import type { SupabaseClient } from "@supabase/supabase-js";
import { withSupabaseQueryRetry } from "@/lib/supabase-retry";

export type LineTokenSource = "store" | "env" | "none";

export type ResolveLineTokenOptions = {
  /**
   * マルチテナントでは原則 false。
   * true のときのみ、DB が空なら LINE_CHANNEL_ACCESS_TOKEN にフォールバックする。
   * （店舗間で別 LINE 公式アカウントを使うため、誤った OA から送信する事故を防ぐ）
   */
  allowEnvFallback?: boolean;
};

/**
 * 店舗の line_channel_access_token を解決する。
 * デフォルトでは env フォールバックしない（他店舗の OA へ誤送信する事故防止）。
 */
export function resolveLineChannelAccessToken(
  lineChannelAccessTokenFromDb: string | null | undefined,
  options?: ResolveLineTokenOptions
): { token: string; source: LineTokenSource; storeRawLength: number } {
  const raw = lineChannelAccessTokenFromDb;
  const asString = raw == null ? "" : String(raw).trim();
  const storeRawLength = raw == null ? 0 : String(raw).length;

  if (asString.length > 0) {
    return { token: asString, source: "store", storeRawLength };
  }

  if (options?.allowEnvFallback === true) {
    const fromEnv = process.env.LINE_CHANNEL_ACCESS_TOKEN?.trim() ?? "";
    if (fromEnv.length > 0) {
      return { token: fromEnv, source: "env", storeRawLength };
    }
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
 * 店舗ごとの Messaging API チャネルアクセストークンを解決（DB のみ）。
 * 取得失敗・未設定時は null（env へフォールバックしない＝他店舗 OA への誤送信防止）。
 */
export async function fetchResolvedLineChannelAccessTokenForStore(
  supabase: SupabaseClient,
  storeId: string,
  logTag = "[LineToken]"
): Promise<{ token: string; source: LineTokenSource } | null> {
  const { data, error } = await withSupabaseQueryRetry(
    () =>
      supabase
        .from("stores")
        .select("line_channel_access_token")
        .eq("id", storeId)
        .maybeSingle(),
    { label: `${logTag} store-token`, attempts: 3 }
  );

  if (error) {
    console.error(
      `${logTag} stores トークン取得失敗 storeId=${storeId}（envフォールバック禁止）:`,
      error.message
    );
    return null;
  }

  const resolved = resolveLineChannelAccessToken(
    (data as { line_channel_access_token?: string | null } | null)?.line_channel_access_token,
    { allowEnvFallback: false }
  );
  logResolvedLineToken(storeId, resolved, logTag);
  if (!resolved.token) {
    console.error(
      `${logTag} stores.line_channel_access_token 未設定 storeId=${storeId}（送信スキップ・envフォールバックなし）`
    );
    return null;
  }
  return { token: resolved.token, source: resolved.source };
}
