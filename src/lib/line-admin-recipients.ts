import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * 管理者へのアラート送信先 LINE ユーザー ID を集める。
 *
 * 旧仕様の stores.admin_line_user_id と、casts の管理者フラグの両方を見て重複を除く。
 * 未返信アラート・作業開始未打刻アラートで共通。
 */
export async function getAdminRecipientLineUserIds(
  supabase: SupabaseClient,
  storeId: string
): Promise<string[]> {
  const ids = new Set<string>();

  const { data: storeRow, error: storeErr } = await supabase
    .from("stores")
    .select("admin_line_user_id")
    .eq("id", storeId)
    .maybeSingle();

  if (!storeErr) {
    const legacy = (storeRow as { admin_line_user_id?: string | null } | null)
      ?.admin_line_user_id;
    if (legacy && String(legacy).trim() !== "") {
      ids.add(String(legacy).trim());
    }
  }

  const { data: adminCasts } = await supabase
    .from("casts")
    .select("line_user_id")
    .eq("store_id", storeId)
    .eq("is_admin", true)
    .eq("is_active", true)
    .not("line_user_id", "is", null);

  for (const r of adminCasts ?? []) {
    const id = (r as { line_user_id?: string }).line_user_id;
    if (id && String(id).trim() !== "") ids.add(String(id).trim());
  }

  return [...ids];
}
