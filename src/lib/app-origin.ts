/**
 * ブラウザ・LINE に載せる絶対 URL のオリジン（末尾スラッシュなし）
 * NEXT_PUBLIC_APP_URL を優先（本番の正規ドメイン推奨）
 */
export function getAppOrigin(): string {
  const explicit = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (explicit) {
    return explicit.replace(/\/$/, "");
  }
  const vercel = process.env.VERCEL_URL?.trim();
  if (vercel) {
    const host = vercel.startsWith("http") ? vercel : `https://${vercel}`;
    return host.replace(/\/$/, "");
  }
  return "http://localhost:3000";
}
