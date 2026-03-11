import type { ReactNode } from "react";
import "./globals.css";

/**
 * ルートレイアウト（APIのみのため最小構成）
 * ダッシュボード等のフロントを追加する場合はここを拡張
 */
export default function RootLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
