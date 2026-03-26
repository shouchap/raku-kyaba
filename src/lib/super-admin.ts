import type { User } from "@supabase/supabase-js";

/**
 * カンマ区切りの許可リストを正規化（小文字・トリム）
 */
function parseAllowList(raw: string | undefined): string[] {
  if (!raw?.trim()) return [];
  return raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * ログイン識別子として使える「ユーザー名」を推定する。
 * - user_metadata の username / user_name / preferred_username
 * - メールが `*@raku-kyaba.internal` のときはローカル部（ログイン画面のユーザー名ログインと同じ）
 */
export function resolveUsernameFromUser(user: User | null): string | null {
  if (!user) return null;

  const meta = user.user_metadata as Record<string, unknown> | undefined;
  for (const key of ["username", "user_name", "preferred_username"] as const) {
    const v = meta?.[key];
    if (typeof v === "string" && v.trim()) {
      return v.trim().toLowerCase();
    }
  }

  const email = user.email ?? "";
  const m = email.match(/^([^@]+)@raku-kyaba\.internal$/i);
  if (m?.[1]?.trim()) {
    return m[1].trim().toLowerCase();
  }

  return null;
}

/**
 * スーパー管理者（全店舗の閲覧・店舗マスタ編集）の判定。
 *
 * - `SUPER_ADMIN_EMAILS` と `SUPER_ADMIN_USERNAMES` の**両方とも未設定または空**のときは、
 *   全員スーパー管理者扱い（開発用）。
 * - いずれかに値があるときは、ログインユーザーのメールがメール許可リストに含まれる、
 *   またはユーザー名がユーザー名許可リストに含まれる、のいずれかで許可。
 */
export function isSuperAdminUser(user: User | null): boolean {
  const emailList = parseAllowList(process.env.SUPER_ADMIN_EMAILS);
  const usernameList = parseAllowList(process.env.SUPER_ADMIN_USERNAMES);

  if (emailList.length === 0 && usernameList.length === 0) {
    return true;
  }

  if (!user) {
    return false;
  }

  const email = user.email?.toLowerCase() ?? "";
  if (emailList.length > 0 && email && emailList.includes(email)) {
    return true;
  }

  const username = resolveUsernameFromUser(user);
  if (usernameList.length > 0 && username && usernameList.includes(username)) {
    return true;
  }

  return false;
}
