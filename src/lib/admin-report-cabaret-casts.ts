import type { SupabaseClient } from "@supabase/supabase-js";
import type { AdminReportCastInput } from "@/lib/admin-report-aggregate";
import { isUndefinedColumnError, logPostgrestError } from "@/lib/postgrest-error";

/** レポート表示用: 源氏名があれば「源氏名（本名）」 */
export function formatCastReportDisplayName(
  name: string,
  displayName: string | null | undefined
): string {
  const d = displayName?.trim();
  return d ? `${d}（${name}）` : name;
}

/**
 * キャバクラ・BAR・風俗のレポート集計対象キャスト。
 * アクティブ全員 + 指定期間内に退店した非アクティブ（シフト実績の集計に含める）。
 */
export async function loadCabaretLikeReportCastInputs(
  admin: SupabaseClient,
  logContext: string,
  storeId: string,
  periodStartYmd: string,
  periodEndYmd: string
): Promise<{ casts: AdminReportCastInput[]; error: string | null }> {
  const { data: activeRows, error: activeErr } = await admin
    .from("casts")
    .select("id, name, display_name")
    .eq("store_id", storeId)
    .eq("is_active", true)
    .order("name");

  if (activeErr) {
    logPostgrestError(`${logContext} casts (active)`, activeErr);
    return { casts: [], error: activeErr.message };
  }

  const activeIds = new Set(
    (activeRows ?? []).map((r) => String((r as { id?: string }).id ?? "")).filter(Boolean)
  );

  const casts: AdminReportCastInput[] = (activeRows ?? []).map((r) => {
    const row = r as { id: string; name: string; display_name?: string | null };
    return {
      id: row.id,
      name: formatCastReportDisplayName(row.name, row.display_name),
      departed_at: null,
      departure_reason: null,
    };
  });

  const { data: departedRows, error: departedErr } = await admin
    .from("casts")
    .select("id, name, display_name, departed_at, departure_reason")
    .eq("store_id", storeId)
    .eq("is_active", false)
    .not("departed_at", "is", null)
    .gte("departed_at", periodStartYmd)
    .lte("departed_at", periodEndYmd)
    .order("departed_at", { ascending: true });

  if (departedErr) {
    if (isUndefinedColumnError(departedErr, "departed_at")) {
      return { casts, error: null };
    }
    logPostgrestError(`${logContext} casts (departed)`, departedErr);
    return { casts: [], error: departedErr.message };
  }

  for (const r of departedRows ?? []) {
    const row = r as {
      id: string;
      name: string;
      display_name?: string | null;
      departed_at: string;
      departure_reason?: string | null;
    };
    if (!row.id || activeIds.has(row.id)) continue;
    casts.push({
      id: row.id,
      name: formatCastReportDisplayName(row.name, row.display_name),
      departed_at: row.departed_at,
      departure_reason: row.departure_reason ?? null,
    });
  }

  return { casts, error: null };
}
