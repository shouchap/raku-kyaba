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
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, viewport-fit=cover"
        />
      </head>
      <body className="min-h-screen overflow-x-hidden antialiased">
        {children}
      </body>
    </html>
  );
}
