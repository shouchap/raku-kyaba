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
      <head>
        <link
          href="https://fonts.googleapis.com/css2?family=Cinzel:wght@400;600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
