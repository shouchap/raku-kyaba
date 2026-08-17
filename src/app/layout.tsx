import type { ReactNode } from "react";
import { Inter } from "next/font/google";
import "./globals.css";

/**
 * 日本語は OS 標準フォント（globals.css の font-family）に任せる。
 * Noto Sans JP は latin サブセットしか配信されず日本語描画に使われないため、
 * 読み込むだけ初回表示が遅くなる。
 */
const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

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
      <body
        className={`${inter.variable} min-h-screen overflow-x-hidden antialiased font-sans`}
      >
        {children}
      </body>
    </html>
  );
}
