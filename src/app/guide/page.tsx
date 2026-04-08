import Link from "next/link";
import { ArrowLeft, CheckCircle2, MessageCircle, Smartphone } from "lucide-react";

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
    <div className="min-h-screen bg-slate-50 text-slate-800">
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/90 backdrop-blur-md">
        <div className="mx-auto max-w-3xl px-4 py-4 flex flex-wrap items-center justify-between gap-3">
          <Link href="/" className="inline-flex items-center gap-2 text-sm text-slate-600 hover:text-slate-900 transition-colors">
            <ArrowLeft className="h-4 w-4 shrink-0" aria-hidden />
            トップへ戻る
          </Link>
          <Link href="/login" className="text-sm text-blue-700 border border-blue-200 rounded-lg px-4 py-2 hover:bg-blue-50 transition-colors">
            ログイン
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-10 sm:py-14 pb-24">
        <div className="text-center mb-10 sm:mb-12">
          <p className="text-xs sm:text-sm tracking-[0.25em] uppercase mb-2 text-blue-600">Guide</p>
          <h1 className="text-2xl sm:text-3xl font-bold text-slate-900">今まであったようでなかった出勤システム</h1>
          <p className="mt-4 text-sm sm:text-base text-slate-600 leading-relaxed max-w-xl mx-auto">
            出勤連携と店舗管理のためのポータルです。まずは全体の流れをご確認ください。
          </p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-6 sm:p-8 mb-10 flex gap-4 shadow-sm">
          <div className="shrink-0 mt-0.5">
            <Smartphone className="h-8 w-8 text-blue-600" aria-hidden />
          </div>
          <div>
            <h2 className="text-slate-900 font-semibold text-sm sm:text-base mb-2">2つの入り口</h2>
            <p className="text-sm text-slate-600 leading-relaxed">
              <strong className="text-slate-800">LINE</strong>
              はキャスト・利用者向けの出勤連絡、
              <strong className="text-slate-800"> このサイトへのログイン</strong>
              は主に管理者・店長向けの操作です。役割に合わせてご利用ください。
            </p>
          </div>
        </div>

        <div className="space-y-10 sm:space-y-12">
          {sections.map((sec) => (
            <section key={sec.title}>
              <h2 className="flex items-center gap-2 text-lg sm:text-xl font-semibold text-slate-900 mb-4 pb-2 border-b border-slate-200">
                <MessageCircle className="h-5 w-5 text-blue-600 shrink-0" aria-hidden />
                {sec.title}
              </h2>
              <ul className="space-y-3">
                {sec.items.map((line, i) => (
                  <li key={i} className="flex gap-3 text-sm sm:text-base text-slate-700 leading-relaxed">
                    <CheckCircle2 className="h-5 w-5 text-blue-500 shrink-0 mt-0.5" aria-hidden />
                    <span>{line}</span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>

        <div className="mt-14 sm:mt-16 rounded-xl border border-blue-200 bg-blue-50 p-6 sm:p-8 text-center">
          <p className="text-slate-700 text-sm mb-4">アカウントをお持ちの方はこちら</p>
          <Link
            href="/login"
            className="inline-flex items-center justify-center min-h-[48px] px-8 rounded-lg bg-blue-600 text-white font-medium hover:bg-blue-700 transition-colors w-full sm:w-auto"
          >
            ログイン画面へ
          </Link>
        </div>
      </main>

      <footer className="border-t border-slate-200 bg-white py-8 text-center text-xs text-slate-500">
        <Link href="/" className="text-slate-600 hover:text-slate-900">トップへ</Link>
        <span className="mx-2 text-slate-300">·</span>
        © raku-kyaba
      </footer>
    </div>
  );
}
