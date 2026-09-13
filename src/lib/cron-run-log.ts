import type { SupabaseClient } from "@supabase/supabase-js";

export type CronRunLogStatus = "sent" | "skipped" | "failed";

export type CronRunLogRow = {
  job: string;
  store_id?: string | null;
  store_name?: string | null;
  status: CronRunLogStatus;
  reason?: string | null;
  detail?: string | null;
  target_count?: number;
  success_count?: number;
  failure_count?: number;
  jst_date: string;
  jst_hour: number;
};

const DETAIL_MAX = 1000;

/** トークン・LINEユーザーID等を detail に残さない */
export function sanitizeCronDetail(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  let s = String(raw);
  // LINE user id (U + 32 hex)
  s = s.replace(/\bU[0-9a-fA-F]{32}\b/g, "[redacted_line_user]");
  // Bearer / long token-like strings
  s = s.replace(/Bearer\s+[A-Za-z0-9._\-/=+]{20,}/gi, "Bearer [redacted]");
  s = s.replace(/\b[A-Za-z0-9._\-/=+]{80,}\b/g, "[redacted_token]");
  s = s.replace(/line_channel_access_token["\s:=]+[^,\s}"]+/gi, "line_channel_access_token=[redacted]");
  if (s.length > DETAIL_MAX) s = s.slice(0, DETAIL_MAX);
  return s;
}

/**
 * cron 実行結果をまとめて記録する。失敗しても例外を投げず console.error のみ。
 * 30日超の掃除は JST 4時台の記録時のみ行う（毎時の無駄な DELETE を避ける）。
 */
export async function recordCronRuns(
  supabase: SupabaseClient,
  rows: CronRunLogRow[]
): Promise<void> {
  if (!rows.length) return;

  const payload = rows.map((r) => ({
    job: r.job,
    store_id: r.store_id && r.store_id.length > 10 ? r.store_id : null,
    store_name: r.store_name ?? null,
    status: r.status,
    reason: r.reason ?? null,
    detail: sanitizeCronDetail(r.detail),
    target_count: r.target_count ?? 0,
    success_count: r.success_count ?? 0,
    failure_count: r.failure_count ?? 0,
    jst_date: r.jst_date,
    jst_hour: r.jst_hour,
  }));

  try {
    const { error } = await supabase.from("cron_run_logs").insert(payload);
    if (error) {
      console.error("[cron_run_logs] insert failed:", error.message, error.code ?? "");
    }
  } catch (e) {
    console.error(
      "[cron_run_logs] insert threw:",
      e instanceof Error ? e.message : String(e)
    );
  }

  // 任意: 30日より古い行を掃除（失敗しても本処理に影響しない）
  try {
    const cutoff = new Date();
    cutoff.setUTCDate(cutoff.getUTCDate() - 30);
    const { error: delErr } = await supabase
      .from("cron_run_logs")
      .delete()
      .lt("created_at", cutoff.toISOString());
    if (delErr) {
      console.error("[cron_run_logs] cleanup failed:", delErr.message);
    }
  } catch (e) {
    console.error(
      "[cron_run_logs] cleanup threw:",
      e instanceof Error ? e.message : String(e)
    );
  }
}

/** 店舗が特定できないジョブ単位の失敗・スキップ用 */
export function jobLevelCronLog(opts: {
  job: string;
  status: CronRunLogStatus;
  reason: string;
  detail?: string | null;
  jstDate: string;
  jstHour: number;
}): CronRunLogRow {
  return {
    job: opts.job,
    store_id: null,
    store_name: null,
    status: opts.status,
    reason: opts.reason,
    detail: sanitizeCronDetail(opts.detail),
    target_count: 0,
    success_count: 0,
    failure_count: opts.status === "failed" ? 1 : 0,
    jst_date: opts.jstDate,
    jst_hour: opts.jstHour,
  };
}

/** 店舗結果1件を cron_run_logs 行に変換 */
export function storeResultToCronLog(opts: {
  job: string;
  storeId: string;
  storeName?: string | null;
  skipped?: string | null;
  error?: string | null;
  sent?: boolean;
  targetCount?: number;
  successCount?: number;
  failureCount?: number;
  jstDate: string;
  jstHour: number;
}): CronRunLogRow {
  const skipped = (opts.skipped ?? "").trim();
  const error = (opts.error ?? "").trim();
  const success = opts.successCount ?? (opts.sent === true ? 1 : 0);
  const failure = opts.failureCount ?? 0;
  const target = opts.targetCount ?? success + failure;

  if (skipped) {
    return {
      job: opts.job,
      store_id: opts.storeId,
      store_name: opts.storeName,
      status: "skipped",
      reason: skipped,
      detail: error || null,
      target_count: target,
      success_count: 0,
      failure_count: 0,
      jst_date: opts.jstDate,
      jst_hour: opts.jstHour,
    };
  }

  if (success > 0) {
    return {
      job: opts.job,
      store_id: opts.storeId,
      store_name: opts.storeName,
      status: "sent",
      reason: failure > 0 ? "partial" : null,
      detail: error || null,
      target_count: target,
      success_count: success,
      failure_count: failure,
      jst_date: opts.jstDate,
      jst_hour: opts.jstHour,
    };
  }

  if (failure > 0 || error) {
    const reason =
      error.startsWith("token_fetch") || error === "token_fetch_failed"
        ? "token_fetch_failed"
        : error.startsWith("fetch_error")
          ? "fetch_error"
          : error.startsWith("uncaught") || error === "exception"
            ? "exception"
            : "push_failed";
    return {
      job: opts.job,
      store_id: opts.storeId,
      store_name: opts.storeName,
      status: "failed",
      reason,
      detail: error || null,
      target_count: target,
      success_count: 0,
      failure_count: failure || 1,
      jst_date: opts.jstDate,
      jst_hour: opts.jstHour,
    };
  }

  return {
    job: opts.job,
    store_id: opts.storeId,
    store_name: opts.storeName,
    status: "skipped",
    reason: "no_targets",
    target_count: 0,
    success_count: 0,
    failure_count: 0,
    jst_date: opts.jstDate,
    jst_hour: opts.jstHour,
  };
}
