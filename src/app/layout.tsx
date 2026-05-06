import type { ReactNode } from "react";
import { Inter, Noto_Sans_JP } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const notoSansJp = Noto_Sans_JP({
  subsets: ["latin"],
  variable: "--font-noto-jp",
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
        className={`${inter.variable} ${notoSansJp.variable} min-h-screen overflow-x-hidden antialiased font-sans`}
      >
        {children}
      </body>
    </html>
  );
}
