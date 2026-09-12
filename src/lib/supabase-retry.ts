/**
 * Supabase / PostgREST の一時的な Gateway Timeout 等に対する短いリトライ。
 * Cron・Webhook の店舗取得など、失敗すると業務通知が止まる箇所向け。
 */

const RETRYABLE_MESSAGE_RE =
  /gateway timeout|timeout|timed out|fetch failed|failed to fetch|cloudflare|522|524|503|502|500|internal server error|upstream|econnreset|socket hang up|aborted/i;

/** 決定的エラー（スキーマ不一致など）はリトライしない */
const NON_RETRYABLE_CODES = new Set(["42703", "42P01", "23505", "23503", "22P02", "PGRST116"]);

export function isRetryableSupabaseError(err: unknown): boolean {
  if (err == null) return false;
  if (typeof err === "string") return RETRYABLE_MESSAGE_RE.test(err);
  if (typeof err === "object") {
    const o = err as { message?: unknown; code?: unknown; details?: unknown; hint?: unknown };
    const code = String(o.code ?? "").trim();
    if (code && NON_RETRYABLE_CODES.has(code)) return false;
    const parts = [o.message, o.code, o.details, o.hint].map((v) => String(v ?? ""));
    return parts.some((p) => RETRYABLE_MESSAGE_RE.test(p));
  }
  return false;
}

export type WithRetryOptions = {
  /** 試行回数（初回含む）。既定 3 */
  attempts?: number;
  /** 初回待機 ms。既定 600。以降は倍増 */
  baseDelayMs?: number;
  label?: string;
};

export async function withRetries<T>(
  fn: (attempt: number) => Promise<T>,
  shouldRetry: (result: T, attempt: number) => boolean,
  options?: WithRetryOptions
): Promise<T> {
  const attempts = Math.max(1, options?.attempts ?? 3);
  const baseDelayMs = Math.max(50, options?.baseDelayMs ?? 600);
  const label = options?.label ?? "withRetries";

  let last: T | undefined;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    last = await fn(attempt);
    if (!shouldRetry(last, attempt) || attempt === attempts) {
      return last;
    }
    const delay = baseDelayMs * 2 ** (attempt - 1);
    console.warn(`[Retry] ${label} attempt=${attempt}/${attempts} retrying in ${delay}ms`);
    await new Promise((r) => setTimeout(r, delay));
  }
  return last as T;
}

/** PostgREST 風の { data, error } 結果向け */
export async function withSupabaseQueryRetry<T>(
  query: () => PromiseLike<{ data: T; error: { message?: string; code?: string; details?: string; hint?: string } | null }>,
  options?: WithRetryOptions
): Promise<{ data: T; error: { message?: string; code?: string; details?: string; hint?: string } | null }> {
  return withRetries(
    async () => query(),
    (res) => isRetryableSupabaseError(res.error),
    options
  );
}
