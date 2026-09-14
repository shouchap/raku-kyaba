import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchStoreLineTokenResult } from "@/lib/line-channel-token";
import { getAdminRecipientLineUserIds } from "@/lib/line-admin-recipients";
import { sendMulticastMessage } from "@/lib/line-reply";
import { recordCronRuns, sanitizeCronDetail } from "@/lib/cron-run-log";

const ALERT_REASONS = new Set(["token_fetch_failed", "exception", "fetch_error", "claim_failed"]);

export type CronFailureItem = {
  storeId: string;
  storeName?: string | null;
  reason: string;
  detail?: string;
};

function isAlertableReason(reason: string): boolean {
  const r = reason.trim();
  if (ALERT_REASONS.has(r)) return true;
  if (r.startsWith("token_fetch_failed")) return true;
  if (r.startsWith("fetch_error")) return true;
  if (r.startsWith("claim_failed")) return true;
  if (r.startsWith("uncaught:") || r.startsWith("exception")) return true;
  if (/gateway timeout|timed out|timeout/i.test(r)) return true;
  return false;
}

async function enrichStoreNames(
  supabase: SupabaseClient,
  failures: CronFailureItem[]
): Promise<CronFailureItem[]> {
  const missingIds = [
    ...new Set(
      failures
        .filter((f) => !String(f.storeName ?? "").trim() && f.storeId.length > 10)
        .map((f) => f.storeId)
    ),
  ];
  if (missingIds.length === 0) return failures;

  try {
    const { data, error } = await supabase
      .from("stores")
      .select("id, name")
      .in("id", missingIds);
    if (error || !data) return failures;
    const map = new Map(
      data.map((r) => [String((r as { id: string }).id), (r as { name?: string | null }).name ?? null])
    );
    return failures.map((f) => ({
      ...f,
      storeName: f.storeName?.trim() || map.get(f.storeId) || f.storeName,
    }));
  } catch {
    return failures;
  }
}

async function alreadyAlertedToday(
  supabase: SupabaseClient,
  job: string,
  reason: string,
  jstDate: string
): Promise<boolean> {
  try {
    const { data, error } = await supabase
      .from("cron_run_logs")
      .select("id")
      .eq("job", job)
      .eq("jst_date", jstDate)
      .eq("reason", `__alert_sent__:${reason}`)
      .limit(1)
      .maybeSingle();
    if (error) {
      console.error("[ALERT] alreadyAlertedToday query failed:", error.message);
      return false;
    }
    return !!data;
  } catch (e) {
    console.error(
      "[ALERT] alreadyAlertedToday threw:",
      e instanceof Error ? e.message : e
    );
    return false;
  }
}

/**
 * cron 配信の深刻な失敗をログに出し、失敗した各店舗の管理者 LINE へ通知する。
 * 同一 job × reason は1日1回まで。
 */
export async function alertCronDeliveryFailures(opts: {
  logTag: string;
  job: string;
  jstDate: string;
  jstHour: number;
  failures: CronFailureItem[];
  supabase?: SupabaseClient;
}): Promise<void> {
  const alertable = opts.failures.filter((f) => isAlertableReason(f.reason));
  if (alertable.length === 0) return;

  const namedForLog = opts.supabase
    ? await enrichStoreNames(opts.supabase, alertable)
    : alertable;

  const summary = namedForLog
    .map(
      (f) =>
        `${f.storeName?.trim() || f.storeId}:${f.reason}${f.detail ? `(${f.detail})` : ""}`
    )
    .join(" | ");
  console.error(
    `[ALERT] ${opts.logTag} 本日の配信に失敗した店舗があります (${namedForLog.length}件): ${summary}`
  );

  if (!opts.supabase) return;

  const alertableNamed = namedForLog;

  // job × reason 単位で1日1回
  const reasonsSeen = new Set<string>();
  for (const f of alertableNamed) {
    const reasonKey = f.reason.trim();
    if (reasonsSeen.has(reasonKey)) continue;
    reasonsSeen.add(reasonKey);

    if (await alreadyAlertedToday(opts.supabase, opts.job, reasonKey, opts.jstDate)) {
      console.info(
        `[ALERT] ${opts.logTag} skip duplicate alert job=${opts.job} reason=${reasonKey} date=${opts.jstDate}`
      );
      continue;
    }

    const sameReason = alertableNamed.filter((x) => x.reason.trim() === reasonKey);
    let notified = false;

    for (const item of sameReason) {
      const storeId = item.storeId;
      if (!storeId || storeId.length < 10) continue;
      try {
        const tokenResult = await fetchStoreLineTokenResult(
          opts.supabase,
          storeId,
          `${opts.logTag}:alert`
        );
        if (!tokenResult.ok) {
          console.warn(
            `[ALERT] ${opts.logTag} 店舗トークン不可のため管理者通知スキップ storeId=${storeId} reason=${tokenResult.reason}`
          );
          continue;
        }
        const adminIds = await getAdminRecipientLineUserIds(opts.supabase, storeId);
        if (adminIds.length === 0) continue;

        const lines = sameReason
          .slice(0, 8)
          .map((x) => {
            const label = String(x.storeName ?? "").trim() || "（店舗名不明）";
            return `・${label} ${x.reason}`;
          })
          .join("\n");
        const text =
          `⚠️ 本日の配信に失敗した店舗があります\n` +
          `${opts.logTag}\n` +
          lines +
          (sameReason.length > 8 ? `\n…他 ${sameReason.length - 8} 件` : "");

        await sendMulticastMessage(adminIds, tokenResult.token, [{ type: "text", text }]);
        console.info(`[ALERT] ${opts.logTag} 管理者LINE通知送信 store=${item.storeName ?? storeId}`);
        notified = true;
        // 失敗店舗ごとにその店の管理者へ送る（最初の1店で止めない）
      } catch (e) {
        console.error(
          `[ALERT] ${opts.logTag} 管理者LINE通知失敗 storeId=${storeId}:`,
          e instanceof Error ? e.message : e
        );
      }
    }

    if (notified) {
      await recordCronRuns(opts.supabase, [
        {
          job: opts.job,
          status: "failed",
          reason: `__alert_sent__:${reasonKey}`,
          detail: sanitizeCronDetail(
            `alerted stores=${sameReason.map((s) => s.storeName ?? s.storeId).join(",")}`
          ),
          jst_date: opts.jstDate,
          jst_hour: opts.jstHour,
          target_count: sameReason.length,
          success_count: 0,
          failure_count: sameReason.length,
        },
      ]);
    }
  }
}

/** results 配列から skipped / error を拾って失敗リストにする */
export function collectCronFailuresFromResults(
  results: Array<{
    storeId?: string;
    storeName?: string | null;
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
      out.push({
        storeId,
        storeName: r.storeName,
        reason: skipped,
        detail: error || undefined,
      });
      continue;
    }
    if (error && isAlertableReason(error)) {
      out.push({ storeId, storeName: r.storeName, reason: error });
    }
  }
  return out;
}
