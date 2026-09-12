import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchStoreLineTokenResult } from "@/lib/line-channel-token";
import { getAdminRecipientLineUserIds } from "@/lib/line-admin-recipients";
import { sendMulticastMessage } from "@/lib/line-reply";

const ALERT_REASONS = new Set(["token_fetch_failed", "exception", "fetch_error"]);

export type CronFailureItem = {
  storeId: string;
  reason: string;
  detail?: string;
};

function isAlertableReason(reason: string): boolean {
  const r = reason.trim();
  if (ALERT_REASONS.has(r)) return true;
  if (r.startsWith("token_fetch_failed")) return true;
  if (r.startsWith("fetch_error")) return true;
  if (r.startsWith("uncaught:") || r.startsWith("exception")) return true;
  return false;
}

/**
 * cron 配信の深刻な失敗をログに出し、可能ならトークンが取れた店舗の管理者 LINE へ通知する。
 */
export async function alertCronDeliveryFailures(opts: {
  logTag: string;
  failures: CronFailureItem[];
  supabase?: SupabaseClient;
  /** 通知に使う候補店舗（失敗していない／トークン取得済み）。未指定なら supabase から候補 storeId を試す */
  notifyFromStoreIds?: string[];
}): Promise<void> {
  const alertable = opts.failures.filter((f) => isAlertableReason(f.reason));
  if (alertable.length === 0) return;

  const summary = alertable
    .map((f) => `${f.storeId}:${f.reason}${f.detail ? `(${f.detail})` : ""}`)
    .join(" | ");
  console.error(
    `[ALERT] ${opts.logTag} 本日の配信に失敗した店舗があります (${alertable.length}件): ${summary}`
  );

  if (!opts.supabase) return;

  const candidateIds = (opts.notifyFromStoreIds ?? []).filter(Boolean);
  const text =
    `⚠️ 本日の配信に失敗した店舗があります\n` +
    `${opts.logTag}\n` +
    alertable
      .slice(0, 8)
      .map((f) => `・${f.storeId.slice(0, 8)}… ${f.reason}`)
      .join("\n") +
    (alertable.length > 8 ? `\n…他 ${alertable.length - 8} 件` : "");

  for (const storeId of candidateIds) {
    try {
      const tokenResult = await fetchStoreLineTokenResult(
        opts.supabase,
        storeId,
        `${opts.logTag}:alert`
      );
      if (!tokenResult.ok) continue;
      const adminIds = await getAdminRecipientLineUserIds(opts.supabase, storeId);
      if (adminIds.length === 0) continue;
      await sendMulticastMessage(adminIds, tokenResult.token, [{ type: "text", text }]);
      console.info(`[ALERT] ${opts.logTag} 管理者LINE通知送信 storeId=${storeId}`);
      return;
    } catch (e) {
      console.error(
        `[ALERT] ${opts.logTag} 管理者LINE通知失敗 storeId=${storeId}:`,
        e instanceof Error ? e.message : e
      );
    }
  }
}

/** results 配列から skipped / error を拾って失敗リストにする */
export function collectCronFailuresFromResults(
  results: Array<{
    storeId?: string;
    skipped?: string;
    error?: string;
  }>
): CronFailureItem[] {
  const out: CronFailureItem[] = [];
  for (const r of results) {
    const storeId = String(r.storeId ?? "").trim() || "(unknown)";
    const skipped = (r.skipped ?? "").trim();
    const error = (r.error ?? "").trim();
    if (isAlertableReason(skipped)) {
      out.push({ storeId, reason: skipped, detail: error || undefined });
      continue;
    }
    if (error && isAlertableReason(error)) {
      out.push({ storeId, reason: error });
    }
  }
  return out;
}
