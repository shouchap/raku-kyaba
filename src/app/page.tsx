import Image from "next/image";
import Link from "next/link";
import { Zen_Kaku_Gothic_New } from "next/font/google";
import { BookOpen, LogIn } from "lucide-react";

const homeHero = Zen_Kaku_Gothic_New({
  weight: "900",
  subsets: ["latin"],
  display: "swap",
});

export default function HomePage() {
  return (
    <div className="flex min-h-[100dvh] min-h-screen flex-col bg-slate-50 text-slate-900">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto max-w-4xl pb-3 pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] pt-[max(0.75rem,env(safe-area-inset-top))] sm:px-6 sm:py-4">
          <p className="text-center text-[0.8125rem] font-semibold leading-snug tracking-wide text-slate-800 sm:text-left sm:text-base">
            あったようでなかった出勤システム
          </p>
        </div>
      </header>

      <main className="flex min-h-0 flex-1 flex-col items-center justify-center py-6 pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-[max(1rem,env(safe-area-inset-top))] sm:px-6 sm:py-10">
        <div className="mb-4 w-full max-w-4xl text-center sm:mb-8">
          <h1
            className={`${homeHero.className} mx-auto max-w-4xl text-balance text-[clamp(1.25rem,3.2vw+0.85rem,3rem)] leading-[1.15] tracking-tight text-slate-900 [text-shadow:0_2px_20px_rgba(15,23,42,0.12)] sm:text-4xl sm:leading-[1.18] md:text-5xl`}
          >
            <span className="block">もう仕事ができない部下を</span>
            <span className="mt-1 block sm:mt-2">怒らなくていい</span>
          </h1>
        </div>

        <section
          aria-label="サービス紹介と主要リンク"
          className="w-full max-w-4xl"
        >
          {/* 全幅で PC と同じ 左イラスト | ナビ | 右イラスト（狭い画面は縮小して同配置） */}
          <div className="mx-auto flex w-full max-w-4xl flex-row items-center justify-center gap-1 sm:gap-2 md:gap-3">
            <div className="flex min-h-0 min-w-0 flex-1 justify-center">
              <div className="relative aspect-square w-full max-w-[260px] bg-slate-50">
                <Image
                  src="/images/home/pain-frustration.png"
                  alt="連絡や調整の負担を表すイラスト"
                  fill
                  className="object-contain mix-blend-multiply"
                  sizes="(min-width: 1024px) 260px, 28vw"
                  priority
                />
              </div>
            </div>

            <nav
              className="flex w-[min(46%,268px)] min-w-0 shrink-0 flex-col gap-1.5 sm:gap-2 md:w-[268px] md:gap-2"
              aria-label="主要リンク"
            >
              <Link
                href="/login"
                className="group flex min-h-[44px] w-full items-center gap-1.5 rounded-lg border border-blue-200/90 bg-white/90 px-2 py-2 shadow-sm backdrop-blur-sm transition-all duration-200 hover:bg-blue-50 hover:shadow focus:outline-none focus:ring-2 focus:ring-blue-300 active:bg-blue-50/90 sm:gap-2.5 sm:px-3 sm:py-2.5"
              >
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-blue-200 bg-blue-50 text-blue-700 group-hover:border-blue-300 sm:h-8 sm:w-8">
                  <LogIn className="h-3.5 w-3.5 sm:h-4 sm:w-4" aria-hidden />
                </span>
                <span className="min-w-0 flex-1 text-left">
                  <span className="block text-xs font-semibold tracking-wide text-blue-700 sm:text-sm">
                    ログイン
                  </span>
                  <span className="mt-0.5 block text-[0.625rem] leading-tight text-slate-500 sm:text-[0.6875rem] sm:leading-snug">
                    <span className="block">アカウントをお持ちの方</span>
                    <span className="block">（管理者・キャスト）</span>
                  </span>
                </span>
              </Link>

              <Link
                href="/guide"
                className="group flex min-h-[44px] w-full items-center gap-1.5 rounded-lg border border-slate-200/90 bg-white/90 px-2 py-2 shadow-sm backdrop-blur-sm transition-all duration-200 hover:bg-slate-50 hover:shadow focus:outline-none focus:ring-2 focus:ring-slate-300 active:bg-slate-50/90 sm:gap-2.5 sm:px-3 sm:py-2.5"
              >
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-slate-200 bg-slate-50 text-slate-700 group-hover:border-slate-300 sm:h-8 sm:w-8">
                  <BookOpen className="h-3.5 w-3.5 sm:h-4 sm:w-4" aria-hidden />
                </span>
                <span className="min-w-0 flex-1 text-left">
                  <span className="block text-xs font-semibold tracking-wide text-slate-800 sm:text-sm">
                    はじめての方
                  </span>
                  <span className="mt-0.5 block text-[0.625rem] leading-tight text-slate-500 sm:text-[0.6875rem] sm:leading-snug">
                    <span className="block">LINE 出勤の流れと</span>
                    <span className="block">システムの使い方</span>
                  </span>
                </span>
              </Link>
            </nav>

            <div className="flex min-h-0 min-w-0 flex-1 justify-center">
              <div className="relative aspect-square w-full max-w-[260px] bg-slate-50">
                <Image
                  src="/images/home/pain-resource.png"
                  alt="人員や予約の見通しへの不安を表すイラスト"
                  fill
                  className="object-contain mix-blend-multiply"
                  sizes="(min-width: 1024px) 260px, 28vw"
                />
              </div>
            </div>
          </div>

          <p className="mx-auto mt-6 max-w-2xl text-pretty text-center text-[0.8125rem] font-medium leading-relaxed text-slate-700 sm:mt-10 sm:text-base">
            <span className="block px-0.5">出勤・シフト・来客予定・勤怠管理を一括管理</span>
            <span className="mt-2 block px-0.5">事業毎にわかりやすく</span>
            <span className="mt-2 block px-0.5">担当者の連絡忘れをなくすAI管理</span>
          </p>

          <p className="mx-auto mt-5 max-w-2xl text-balance px-1 text-center text-xs leading-relaxed text-slate-500 sm:mt-8 sm:text-sm">
            LINE とブラウザをつなぎ、店舗の運用に合わせて整理します。
          </p>
        </section>
      </main>

      <footer className="border-t border-slate-200 bg-white py-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] text-center text-xs text-slate-500 sm:py-6">
        © raku-kyaba
      </footer>
    </div>
  );
}
