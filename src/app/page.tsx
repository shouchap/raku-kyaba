import Image from "next/image";
import Link from "next/link";
import { BookOpen, LogIn } from "lucide-react";

export default function HomePage() {
  return (
    <div className="flex min-h-screen flex-col bg-slate-50 text-slate-900">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto max-w-4xl px-4 py-4">
          <p className="text-sm font-semibold tracking-wide text-slate-800 sm:text-base">
            今まであったようでなかった出勤システム
          </p>
        </div>
      </header>

      <main className="flex flex-1 flex-col items-center px-4 py-10 sm:py-14">
        <div className="mb-8 w-full max-w-xl space-y-4 text-center sm:mb-10">
          <h1 className="text-2xl font-bold leading-tight text-slate-900 sm:text-4xl">
            今まであったようでなかった出勤システム
          </h1>
          <p className="text-sm leading-relaxed text-slate-600 sm:text-base">
            出勤・シフト・来客予定までをまとめて管理する、店舗向けスタッフポータルです。
          </p>
        </div>

        <section
          aria-labelledby="home-pain-heading"
          className="mb-10 w-full max-w-2xl sm:mb-12"
        >
          <h2
            id="home-pain-heading"
            className="mb-5 text-center text-sm font-medium text-slate-700 sm:text-base"
          >
            出勤まわりの連絡や調整に、こんな負担を感じていませんか。
          </h2>
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 sm:gap-6">
            <figure className="flex flex-col items-center rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="relative aspect-square w-full max-w-[220px]">
                <Image
                  src="/images/home/pain-frustration.png"
                  alt="連絡や調整の負担を表すイラスト"
                  fill
                  className="object-contain"
                  sizes="(min-width: 640px) 220px, 55vw"
                  priority
                />
              </div>
              <figcaption className="mt-3 max-w-[16rem] text-center text-xs leading-relaxed text-slate-600 sm:text-sm">
                声かけ・電話・紙でのやりとりが続き、抜けやストレスがたまりやすい。
              </figcaption>
            </figure>
            <figure className="flex flex-col items-center rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="relative aspect-square w-full max-w-[220px]">
                <Image
                  src="/images/home/pain-resource.png"
                  alt="人員や予約の見通しへの不安を表すイラスト"
                  fill
                  className="object-contain"
                  sizes="(min-width: 640px) 220px, 55vw"
                />
              </div>
              <figcaption className="mt-3 max-w-[16rem] text-center text-xs leading-relaxed text-slate-600 sm:text-sm">
                予約や人員の見通しが立ちにくく、現場と事務の両方に負荷がかかる。
              </figcaption>
            </figure>
          </div>
          <p className="mt-5 text-center text-xs text-slate-500 sm:text-sm">
            LINE とブラウザをつなぎ、店舗の運用に合わせて整理します。
          </p>
        </section>

        <div className="w-full max-w-md space-y-4 sm:space-y-5">
          <Link
            href="/login"
            className="group flex w-full items-center gap-4 rounded-xl border border-blue-200 bg-white px-6 py-5 shadow-sm transition-all duration-200 hover:bg-blue-50 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-blue-300 sm:py-6"
          >
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-blue-200 bg-blue-50 text-blue-700 group-hover:border-blue-300">
              <LogIn className="h-6 w-6" aria-hidden />
            </span>
            <span className="min-w-0 flex-1 text-left">
              <span className="block text-base font-semibold tracking-wide text-blue-700 sm:text-lg">
                ログイン
              </span>
              <span className="mt-1 block text-xs text-slate-500 sm:text-sm">
                アカウントをお持ちの方（管理者・キャスト）
              </span>
            </span>
          </Link>

          <Link
            href="/guide"
            className="group flex w-full items-center gap-4 rounded-xl border border-slate-200 bg-white px-6 py-5 shadow-sm transition-all duration-200 hover:bg-slate-50 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-slate-300 sm:py-6"
          >
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-slate-700 group-hover:border-slate-300">
              <BookOpen className="h-6 w-6" aria-hidden />
            </span>
            <span className="min-w-0 flex-1 text-left">
              <span className="block text-base font-semibold tracking-wide text-slate-800 sm:text-lg">
                はじめての方
              </span>
              <span className="mt-1 block text-xs text-slate-500 sm:text-sm">
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
