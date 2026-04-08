import Link from "next/link";
import { LogIn, Sparkles } from "lucide-react";

export default function HomePage() {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto max-w-4xl px-4 py-4">
          <p className="text-sm sm:text-base font-semibold tracking-wide text-slate-800">
            今まであったようでなかった出勤システム
          </p>
        </div>
      </header>

      <main className="flex-1 flex flex-col items-center justify-center px-4 py-12 sm:py-16">
        <div className="max-w-xl w-full text-center space-y-4 mb-10 sm:mb-14">
          <h1 className="text-2xl sm:text-4xl font-bold text-slate-900 leading-tight">
            今まであったようでなかった出勤システム
          </h1>
          <p className="text-slate-600 text-sm sm:text-base leading-relaxed">
            出勤・シフト・来客予定までをまとめて管理する、店舗向けスタッフポータルです。
          </p>
        </div>

        <div className="w-full max-w-md space-y-4 sm:space-y-5">
          <Link
            href="/login"
            className="group flex items-center gap-4 w-full rounded-xl border border-blue-200 bg-white hover:bg-blue-50 px-6 py-5 sm:py-6 transition-all duration-200 shadow-sm hover:shadow-md focus:outline-none focus:ring-2 focus:ring-blue-300"
          >
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-blue-200 bg-blue-50 text-blue-700 group-hover:border-blue-300">
              <LogIn className="h-6 w-6" aria-hidden />
            </span>
            <span className="text-left flex-1 min-w-0">
              <span className="block text-blue-700 font-semibold text-base sm:text-lg tracking-wide">
                ログイン
              </span>
              <span className="block text-slate-500 text-xs sm:text-sm mt-1">
                アカウントをお持ちの方（管理者・キャスト）
              </span>
            </span>
          </Link>

          <Link
            href="/guide"
            className="group flex items-center gap-4 w-full rounded-xl border border-slate-200 bg-white hover:bg-slate-50 px-6 py-5 sm:py-6 transition-all duration-200 shadow-sm hover:shadow-md focus:outline-none focus:ring-2 focus:ring-slate-300"
          >
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-slate-100 text-slate-700 group-hover:border-slate-300">
              <Sparkles className="h-6 w-6" aria-hidden />
            </span>
            <span className="text-left flex-1 min-w-0">
              <span className="block text-slate-800 font-semibold text-base sm:text-lg tracking-wide">
                はじめての方
              </span>
              <span className="block text-slate-500 text-xs sm:text-sm mt-1">
                LINE 出勤の流れとシステムの使い方
              </span>
            </span>
          </Link>
        </div>
      </main>

      <footer className="border-t border-slate-200 bg-white py-6 text-center text-xs text-slate-500">
        © raku-kyaba
      </footer>
    </div>
  );
}
