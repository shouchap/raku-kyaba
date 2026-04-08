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
    <div className="flex min-h-screen flex-col bg-slate-50 text-slate-900">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto max-w-4xl px-4 py-3 sm:py-4">
          <p className="text-center text-sm font-semibold leading-snug tracking-wide text-slate-800 sm:text-left sm:text-base">
            あったようでなかった出勤システム
          </p>
        </div>
      </header>

      <main className="flex flex-1 flex-col items-center px-4 py-10 sm:py-14">
        <div className="mb-2 w-full max-w-3xl space-y-4 text-center sm:mb-3">
          <h1
            className={`${homeHero.className} mx-auto max-w-[min(100%,22rem)] text-balance text-[1.65rem] leading-[1.2] tracking-tight text-slate-900 [text-shadow:0_2px_20px_rgba(15,23,42,0.12)] sm:max-w-4xl sm:text-4xl sm:leading-[1.18] md:text-5xl`}
          >
            <span className="block">もう仕事ができない部下を</span>
            <span className="mt-1 block sm:mt-2">怒らなくていい</span>
          </h1>
          <p className="mx-auto max-w-2xl text-pretty text-sm font-medium leading-relaxed text-slate-700 sm:text-base">
            <span className="block">出勤・シフト・来客予定・勤怠管理を一括管理</span>
            <span className="mt-2 block">事業毎にわかりやすく</span>
            <span className="mt-2 block">担当者の連絡忘れをなくすAI管理</span>
          </p>
        </div>

        <section
          aria-label="サービス紹介と主要リンク"
          className="w-full max-w-4xl pt-4 sm:pt-5"
        >
          <div className="flex flex-col items-center gap-4 md:flex-row md:items-center md:justify-center md:gap-2 lg:gap-3">
            <div className="flex w-full flex-col items-center md:max-w-[260px] md:flex-1">
              <div className="relative aspect-square w-full max-w-[260px] bg-slate-50">
                <Image
                  src="/images/home/pain-frustration.png"
                  alt="連絡や調整の負担を表すイラスト"
                  fill
                  className="object-contain mix-blend-multiply"
                  sizes="(min-width: 768px) 260px, 72vw"
                  priority
                />
              </div>
            </div>

            <nav
              className="flex w-full max-w-[min(100%,268px)] flex-col gap-2 md:w-[min(100%,268px)] md:flex-shrink-0 md:gap-2"
              aria-label="主要リンク"
            >
              <Link
                href="/login"
                className="group flex w-full items-center gap-2.5 rounded-lg border border-blue-200/90 bg-white/90 px-3 py-2.5 shadow-sm backdrop-blur-sm transition-all duration-200 hover:bg-blue-50 hover:shadow focus:outline-none focus:ring-2 focus:ring-blue-300"
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-blue-200 bg-blue-50 text-blue-700 group-hover:border-blue-300">
                  <LogIn className="h-4 w-4" aria-hidden />
                </span>
                <span className="min-w-0 flex-1 text-left">
                  <span className="block text-sm font-semibold tracking-wide text-blue-700">
                    ログイン
                  </span>
                  <span className="mt-0.5 block text-[0.6875rem] leading-snug text-slate-500">
                    <span className="block">アカウントをお持ちの方</span>
                    <span className="block">（管理者・キャスト）</span>
                  </span>
                </span>
              </Link>

              <Link
                href="/guide"
                className="group flex w-full items-center gap-2.5 rounded-lg border border-slate-200/90 bg-white/90 px-3 py-2.5 shadow-sm backdrop-blur-sm transition-all duration-200 hover:bg-slate-50 hover:shadow focus:outline-none focus:ring-2 focus:ring-slate-300"
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-slate-200 bg-slate-50 text-slate-700 group-hover:border-slate-300">
                  <BookOpen className="h-4 w-4" aria-hidden />
                </span>
                <span className="min-w-0 flex-1 text-left">
                  <span className="block text-sm font-semibold tracking-wide text-slate-800">
                    はじめての方
                  </span>
                  <span className="mt-0.5 block text-[0.6875rem] leading-snug text-slate-500">
                    <span className="block">LINE 出勤の流れと</span>
                    <span className="block">システムの使い方</span>
                  </span>
                </span>
              </Link>
            </nav>

            <div className="flex w-full flex-col items-center md:max-w-[260px] md:flex-1">
              <div className="relative aspect-square w-full max-w-[260px] bg-slate-50">
                <Image
                  src="/images/home/pain-resource.png"
                  alt="人員や予約の見通しへの不安を表すイラスト"
                  fill
                  className="object-contain mix-blend-multiply"
                  sizes="(min-width: 768px) 260px, 72vw"
                />
              </div>
            </div>
          </div>

          <p className="mx-auto mt-8 max-w-md text-balance px-2 text-center text-xs leading-relaxed text-slate-500 sm:mt-9 sm:max-w-lg sm:text-sm">
            LINE とブラウザをつなぎ、
            <br className="sm:hidden" />
            店舗の運用に合わせて整理します。
          </p>
        </section>
      </main>

      <footer className="border-t border-slate-200 bg-white py-6 text-center text-xs text-slate-500">
        © raku-kyaba
      </footer>
    </div>
  );
}
