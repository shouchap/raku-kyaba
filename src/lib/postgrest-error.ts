import type { PostgrestError } from "@supabase/supabase-js";

/** Vercel ログ用: PostgREST / DB エラーを構造化して出力 */
export function logPostgrestError(context: string, err: unknown): void {
  if (err === null || err === undefined) {
    console.error(`[${context}]`, "(null/undefined)");
    return;
  }
  if (typeof err === "object" && err !== null && "message" in err) {
    const pe = err as PostgrestError;
    console.error(`[${context}] PostgREST/DB`, {
      message: pe.message,
      code: pe.code,
      details: pe.details,
      hint: pe.hint,
    });
    return;
  }
  if (err instanceof Error) {
    console.error(`[${context}]`, err.message, err.stack);
    return;
  }
  console.error(`[${context}]`, String(err));
}

/**
 * stores.remind_time など未マイグレーション時（column does not exist / 42703）
 */
export function isUndefinedColumnError(err: unknown, columnHint?: string): boolean {
  const pe = err as PostgrestError | undefined;
  if (!pe?.message) return false;
  const m = pe.message.toLowerCase();
  if (pe.code === "42703") return true;
  if (m.includes("does not exist") && m.includes("column")) return true;
  if (columnHint && m.includes(columnHint.toLowerCase())) return true;
  return false;
}
