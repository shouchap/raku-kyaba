/**
 * スーパー管理者（全店舗の閲覧・店舗マスタ編集）の判定。
 * `SUPER_ADMIN_EMAILS` にカンマ区切りでメールを列挙。未設定のときは全員スーパー管理者扱い（開発用）。
 */
export function isSuperAdminEmail(email: string | undefined | null): boolean {
  const raw = process.env.SUPER_ADMIN_EMAILS?.trim();
  if (!raw) return true;
  const list = raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (list.length === 0) return true;
  if (!email) return false;
  return list.includes(email.toLowerCase());
}
