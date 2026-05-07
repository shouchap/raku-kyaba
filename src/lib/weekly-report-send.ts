import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchResolvedLineChannelAccessTokenForStore } from "@/lib/line-channel-token";
import { sendMulticastMessage } from "@/lib/line-reply";
import { buildWeeklyReportBody, chunkWeeklyReportBody } from "@/lib/line-weekly-report";
import { loadWeeklyReportBuildInput } from "@/lib/weekly-report-data";
import { logPostgrestError, isUndefinedColumnError } from "@/lib/postgrest-error";

async function fetchAdminLineUserIds(admin: SupabaseClient, storeId: string): Promise<string[]> {
  const { data: adminCasts } = await admin
    .from("casts")
    .select("line_user_id")
    .eq("store_id", storeId)
    .eq("is_admin", true)
    .eq("is_active", true)
    .not("line_user_id", "is", null);

  const fromCasts = (adminCasts ?? [])
    .map((r: { line_user_id?: string }) => r.line_user_id)
    .filter((id): id is string => !!id && id.trim() !== "");

  if (fromCasts.length > 0) return fromCasts;

  const { data: store } = await admin.from("stores").select("admin_line_user_id").eq("id", storeId).single();

  const legacyId = (store as { admin_line_user_id?: string | null } | null)?.admin_line_user_id;
  if (legacyId && String(legacyId).trim() !== "") return [legacyId];

  return [];
}

export type WeeklyReportSendResult =
  | { ok: true; skipped?: string; chunkCount: number }
  | { ok: false; error: string };

/**
 * 週間レポートを管理者へ送信。skipIdempotency=false のとき送信成功後に last_weekly_report_sent_date を更新する。
 */
export async function sendWeeklyReportForStore(
  admin: SupabaseClient,
  opts: {
    storeId: string;
    sendDateYmd: string;
    skipIdempotency: boolean;
    logPrefix?: string;
  }
): Promise<WeeklyReportSendResult> {
  const { storeId, sendDateYmd, skipIdempotency } = opts;
  const prefix = opts.logPrefix ?? "[weekly-report]";

  if (!skipIdempotency) {
    const { data: row, error } = await admin
      .from("stores")
      .select("last_weekly_report_sent_date")
      .eq("id", storeId)
      .maybeSingle();

    if (error && !isUndefinedColumnError(error, "last_weekly_report_sent_date")) {
      logPostgrestError(`${prefix} stores last_weekly_report_sent_date`, error);
      return { ok: false, error: error.message };
    }

    const last = (row as { last_weekly_report_sent_date?: string | null } | null)?.last_weekly_report_sent_date;
    if (last === sendDateYmd) {
      return { ok: true, skipped: "already_sent_for_run_date", chunkCount: 0 };
    }
  }

  const tokenPack = await fetchResolvedLineChannelAccessTokenForStore(admin, storeId, prefix);
  if (!tokenPack?.token) {
    return { ok: false, error: "no_line_token" };
  }

  const adminIds = await fetchAdminLineUserIds(admin, storeId);
  if (adminIds.length === 0) {
    return { ok: false, error: "no_admin_recipients" };
  }

  const loaded = await loadWeeklyReportBuildInput(admin, { storeId, sendDateYmd });
  if (!loaded.ok) {
    return { ok: false, error: loaded.error };
  }

  const body = buildWeeklyReportBody(loaded.input);
  const chunks = chunkWeeklyReportBody(body);

  for (const chunk of chunks) {
    await sendMulticastMessage(adminIds, tokenPack.token, [{ type: "text", text: chunk }]);
  }

  if (!skipIdempotency) {
    const upd = await admin
      .from("stores")
      .update({
        last_weekly_report_sent_date: sendDateYmd,
        updated_at: new Date().toISOString(),
      })
      .eq("id", storeId);

    if (upd.error) {
      if (isUndefinedColumnError(upd.error, "last_weekly_report_sent_date")) {
        console.warn(`${prefix} stores.last_weekly_report_sent_date 未適用。049 を適用してください。`);
      } else {
        logPostgrestError(`${prefix} stores update last_weekly_report_sent_date`, upd.error);
        return { ok: false, error: upd.error.message };
      }
    }
  }

  console.log(`${prefix} sent store=${storeId} sendDate=${sendDateYmd} chunks=${chunks.length}`);
  return { ok: true, chunkCount: chunks.length };
}
