import Link from "next/link";
import { LogIn, Sparkles } from "lucide-react";

const GOLD = "#D4AF37";

export default function HomePage() {
  return (
    <div className="min-h-screen bg-black text-white relative overflow-hidden flex flex-col">
      <div className="absolute inset-0 pointer-events-none">
        <div
          className="absolute inset-0 opacity-[0.04]"
          style={{
            backgroundImage: `radial-gradient(circle at 30% 20%, ${GOLD} 0%, transparent 45%),
              radial-gradient(circle at 70% 80%, ${GOLD} 0%, transparent 40%)`,
          }}
        />
        <div
          className="absolute inset-0 opacity-[0.03]"
          style={{
            backgroundImage: `radial-gradient(circle at 50% 50%, ${GOLD} 1px, transparent 1px)`,
            backgroundSize: "48px 48px",
          }}
        />
      </div>

      <header className="relative z-10 border-b border-[#D4AF37]/20 bg-black/40 backdrop-blur-sm">
        <div className="mx-auto max-w-4xl px-4 py-4 flex items-center justify-between">
          <p
            className="text-[#D4AF37] text-sm sm:text-base tracking-[0.2em] font-light"
            style={{ fontFamily: "'Cinzel', 'Georgia', serif" }}
          >
            Raku-Raku STAFF PORTAL
          </p>
        </div>
      </header>

      <main className="relative z-10 flex-1 flex flex-col items-center justify-center px-4 py-12 sm:py-16">
        <div className="max-w-lg w-full text-center space-y-4 mb-10 sm:mb-14">
          <h1
            className="text-2xl sm:text-4xl font-light text-[#D4AF37] tracking-wide leading-tight"
            style={{ fontFamily: "'Cinzel', 'Georgia', serif" }}
          >
            raku-kyaba
          </h1>
          <p className="text-gray-400 text-sm sm:text-base leading-relaxed">
            出勤・シフト・来客予定までをまとめて管理する、店舗向けスタッフポータルです。
          </p>
        </div>

        <div className="w-full max-w-md space-y-4 sm:space-y-5">
          <Link
            href="/login"
            className="group flex items-center gap-4 w-full rounded-xl border-2 border-[#D4AF37] bg-[#D4AF37]/5 hover:bg-[#D4AF37]/10 px-6 py-5 sm:py-6 transition-all duration-200 shadow-[0_0_24px_rgba(212,175,55,0.12)] hover:shadow-[0_0_32px_rgba(212,175,55,0.2)] focus:outline-none focus:ring-2 focus:ring-[#D4AF37]/50"
          >
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-[#D4AF37]/40 bg-black/60 text-[#D4AF37] group-hover:border-[#D4AF37]/70">
              <LogIn className="h-6 w-6" aria-hidden />
            </span>
            <span className="text-left flex-1 min-w-0">
              <span className="block text-[#D4AF37] font-medium text-base sm:text-lg tracking-wide">
                ログイン
              </span>
              <span className="block text-gray-500 text-xs sm:text-sm mt-1">
                アカウントをお持ちの方（管理者・キャスト）
              </span>
            </span>
          </Link>

          <Link
            href="/guide"
            className="group flex items-center gap-4 w-full rounded-xl border border-[#D4AF37]/35 bg-black/60 hover:bg-[#D4AF37]/[0.07] px-6 py-5 sm:py-6 transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-[#D4AF37]/40"
          >
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-[#D4AF37]/25 bg-black/80 text-[#D4AF37]/90 group-hover:border-[#D4AF37]/50">
              <Sparkles className="h-6 w-6" aria-hidden />
            </span>
            <span className="text-left flex-1 min-w-0">
              <span className="block text-[#D4AF37]/95 font-medium text-base sm:text-lg tracking-wide">
                はじめての方
              </span>
              <span className="block text-gray-500 text-xs sm:text-sm mt-1">
                LINE 出勤の流れとシステムの使い方
              </span>
            </span>
          </Link>
        </div>
      </main>

      <footer className="relative z-10 border-t border-[#D4AF37]/15 py-6 text-center text-xs text-gray-600">
        © raku-kyaba
      </footer>
    </div>
  );
}
