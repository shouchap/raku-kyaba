/**
 * SaaS 全体のメンテナンスモード判定（Middleware / Route / Webhook で共通利用）
 *
 * Vercel / Next.js: 環境変数 `MAINTENANCE_MODE` を `true` に設定
 */
export function isMaintenanceMode(): boolean {
  const v = process.env.MAINTENANCE_MODE?.trim().toLowerCase();
  return v === "true" || v === "1";
}

/** LINE Webhook 返信用（Reply API） */
export const MAINTENANCE_LINE_REPLY_TEXT =
  "🔧 現在システムメンテナンス中です。頂いたデータ（出勤・予約）は安全にお預かりしており、メンテナンス終了後に反映されます。";
