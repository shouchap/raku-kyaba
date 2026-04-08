import Link from "next/link";
import { ArrowLeft, CheckCircle2, MessageCircle, Smartphone } from "lucide-react";

const GOLD = "#D4AF37";

const sections = [
  {
    title: "このシステムでできること",
    items: [
      "LINE から出勤・遅刻・欠勤などの連絡ができます（店舗の設定に依存します）。",
      "管理者はシフト入力・一覧・レポートなどをブラウザから確認できます。",
      "業態（キャバクラ・BAR・就労支援 B 型など）に応じて画面やフローが切り替わります。",
    ],
  },
  {
    title: "キャスト・利用者の方へ（LINE）",
    items: [
      "店舗の公式 LINE を友だち追加してください（初回はウェルカムメッセージが届きます）。",
      "リマインドや出勤確認の Flex メッセージが届いたら、表示どおりにボタンで回答します。",
      "来客予定のある店舗では、出勤後に予約人数・時間などのヒアリングが続く場合があります。文字入力が求められるときは、画面の案内に従ってください。",
      "遅刻・欠勤・半休・公休を選んだあと、理由を聞かれることがあります。",
    ],
  },
  {
    title: "管理者の方へ（ブラウザログイン）",
    items: [
      "トップの「ログイン」から、店舗から案内されたユーザー名（またはメール）とパスワードでサインインします。",
      "ログイン後は週間シフト入力・シフト一覧・キャスト管理・レポート・設定など、権限に応じたメニューが使えます。",
      "複数店舗を扱うスーパー管理者は、店舗の切り替えにご注意ください。",
    ],
  },
  {
    title: "ご注意",
    items: [
      "利用可能な機能は店舗の契約・設定（業態・LINE・リマインドなど）により異なります。",
      "ログインや LINE がうまく動かないときは、店舗の管理者にお問い合わせください。",
    ],
  },
];

export default function GuidePage() {
  return (
    <div className="min-h-screen bg-black text-gray-200">
      <div
        className="fixed inset-0 pointer-events-none opacity-[0.04]"
        style={{
          backgroundImage: `radial-gradient(circle at 50% 0%, ${GOLD} 0%, transparent 50%)`,
        }}
      />

      <header className="sticky top-0 z-20 border-b border-[#D4AF37]/20 bg-black/85 backdrop-blur-md">
        <div className="mx-auto max-w-3xl px-4 py-4 flex flex-wrap items-center justify-between gap-3">
          <Link
            href="/"
            className="inline-flex items-center gap-2 text-sm text-[#D4AF37]/85 hover:text-[#D4AF37] transition-colors"
          >
            <ArrowLeft className="h-4 w-4 shrink-0" aria-hidden />
            トップへ戻る
          </Link>
          <Link
            href="/login"
            className="text-sm text-[#D4AF37] border border-[#D4AF37]/50 rounded-lg px-4 py-2 hover:bg-[#D4AF37]/10 transition-colors"
          >
            ログイン
          </Link>
        </div>
      </header>

      <main className="relative z-10 mx-auto max-w-3xl px-4 py-10 sm:py-14 pb-24">
        <div className="text-center mb-10 sm:mb-12">
          <p
            className="text-[#D4AF37]/80 text-xs sm:text-sm tracking-[0.25em] uppercase mb-2"
            style={{ fontFamily: "'Cinzel', 'Georgia', serif" }}
          >
            Guide
          </p>
          <h1
            className="text-2xl sm:text-3xl font-light text-[#D4AF37] tracking-wide"
            style={{ fontFamily: "'Cinzel', 'Georgia', serif" }}
          >
            raku-kyaba の使い方
          </h1>
          <p className="mt-4 text-sm sm:text-base text-gray-500 leading-relaxed max-w-xl mx-auto">
            出勤連携と店舗管理のためのポータルです。まずは全体の流れをご確認ください。
          </p>
        </div>

        <div className="rounded-2xl border border-[#D4AF37]/20 bg-[#0a0a0a] p-6 sm:p-8 mb-10 flex gap-4">
          <div className="shrink-0 mt-0.5">
            <Smartphone className="h-8 w-8 text-[#D4AF37]/70" aria-hidden />
          </div>
          <div>
            <h2 className="text-[#D4AF37] font-medium text-sm sm:text-base mb-2">2つの入り口</h2>
            <p className="text-sm text-gray-400 leading-relaxed">
              <strong className="text-gray-300">LINE</strong>
              はキャスト・利用者向けの出勤連絡、
              <strong className="text-gray-300"> このサイトへのログイン</strong>
              は主に管理者・店長向けの操作です。役割に合わせてご利用ください。
            </p>
          </div>
        </div>

        <div className="space-y-10 sm:space-y-12">
          {sections.map((sec) => (
            <section key={sec.title}>
              <h2 className="flex items-center gap-2 text-lg sm:text-xl font-medium text-[#D4AF37] mb-4 pb-2 border-b border-[#D4AF37]/20">
                <MessageCircle className="h-5 w-5 opacity-80 shrink-0" aria-hidden />
                {sec.title}
              </h2>
              <ul className="space-y-3">
                {sec.items.map((line, i) => (
                  <li key={i} className="flex gap-3 text-sm sm:text-base text-gray-400 leading-relaxed">
                    <CheckCircle2 className="h-5 w-5 text-[#D4AF37]/45 shrink-0 mt-0.5" aria-hidden />
                    <span>{line}</span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>

        <div className="mt-14 sm:mt-16 rounded-xl border border-[#D4AF37]/25 bg-gradient-to-b from-[#D4AF37]/[0.06] to-transparent p-6 sm:p-8 text-center">
          <p className="text-gray-400 text-sm mb-4">アカウントをお持ちの方はこちら</p>
          <Link
            href="/login"
            className="inline-flex items-center justify-center min-h-[48px] px-8 rounded-lg border-2 border-[#D4AF37] text-[#D4AF37] font-medium tracking-wide hover:bg-[#D4AF37]/10 transition-colors w-full sm:w-auto"
          >
            ログイン画面へ
          </Link>
        </div>
      </main>

      <footer className="border-t border-[#D4AF37]/10 py-8 text-center text-xs text-gray-600">
        <Link href="/" className="text-[#D4AF37]/60 hover:text-[#D4AF37]">
          トップへ
        </Link>
        <span className="mx-2 text-gray-700">·</span>
        © raku-kyaba
      </footer>
    </div>
  );
}
