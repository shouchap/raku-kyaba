import Image from "next/image";
import Link from "next/link";

function GuideFigure({
  src,
  width,
  height,
  alt,
  caption,
}: {
  src: string;
  width: number;
  height: number;
  alt: string;
  caption: string;
}) {
  return (
    <figure className="my-6">
      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <Image
          src={src}
          alt={alt}
          width={width}
          height={height}
          className="h-auto w-full"
          sizes="(min-width: 768px) 42rem, 100vw"
          priority={src.endsWith("overview-line-vs-web.svg")}
        />
      </div>
      <figcaption className="mt-2 text-xs leading-relaxed text-slate-500">{caption}</figcaption>
    </figure>
  );
}

export default function GuidePage() {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-800">
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 backdrop-blur-sm">
        <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <Link
            href="/"
            className="text-sm text-slate-600 transition-colors hover:text-slate-900"
          >
            ← トップへ戻る
          </Link>
          <Link
            href="/login"
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 transition-colors hover:bg-slate-50"
          >
            ログイン
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 pb-24 pt-10 sm:pt-14">
        <header className="border-b border-slate-200 pb-8">
          <p className="text-xs font-medium uppercase tracking-wider text-slate-500">利用ガイド</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">
            今まであったようでなかった出勤システム
          </h1>
          <p className="mt-4 max-w-2xl text-sm leading-relaxed text-slate-600 sm:text-base">
            出勤連携と店舗管理のためのポータルです。初めての方は、下の図と説明で全体像を把握してから利用してください。
          </p>
        </header>

        <section className="mt-10" aria-labelledby="two-entries">
          <h2 id="two-entries" className="text-lg font-semibold text-slate-900">
            2つの入り口
          </h2>
          <p className="mt-3 text-sm leading-relaxed text-slate-600 sm:text-base">
            <span className="font-medium text-slate-800">LINE</span>
            はキャスト・利用者向けの出勤連絡、
            <span className="font-medium text-slate-800">このサイトへのログイン</span>
            は主に管理者・店長向けです。役割に合わせて使い分けます。
          </p>
          <GuideFigure
            src="/guide/overview-line-vs-web.svg"
            width={880}
            height={300}
            alt="左がスマートフォン上のLINE、右がブラウザの管理画面であることを示す模式図"
            caption="左：LINEアプリでの連絡。右：ブラウザでログインしてシフトやレポートを扱う想定です。"
          />
        </section>

        <section className="mt-12" aria-labelledby="what-you-can-do">
          <h2 id="what-you-can-do" className="text-lg font-semibold text-slate-900">
            このシステムでできること
          </h2>
          <ul className="mt-4 list-disc space-y-2 pl-5 text-sm leading-relaxed text-slate-700 sm:text-base">
            <li>LINE から出勤・遅刻・欠勤などの連絡ができます（店舗の設定に依存します）。</li>
            <li>管理者はシフト入力・一覧・レポートなどをブラウザから確認できます。</li>
            <li>業態（キャバクラ・BAR・就労支援 B 型など）に応じて画面やフローが切り替わります。</li>
          </ul>
        </section>

        <section className="mt-12" aria-labelledby="line-users">
          <h2 id="line-users" className="text-lg font-semibold text-slate-900">
            キャスト・利用者の方（LINE）
          </h2>
          <GuideFigure
            src="/guide/line-attendance-flow.svg"
            width={720}
            height={220}
            alt="友だち追加、メッセージ受信、ボタンで回答の3ステップを示す模式図"
            caption="実際の文言やボタンは店舗設定により異なります。届いた画面の指示に従ってください。"
          />
          <ol className="mt-4 list-decimal space-y-3 pl-5 text-sm leading-relaxed text-slate-700 sm:text-base">
            <li>店舗の公式 LINE を友だち追加してください（初回はウェルカムメッセージが届きます）。</li>
            <li>リマインドや出勤確認の Flex メッセージが届いたら、表示どおりにボタンで回答します。</li>
            <li>
              来客予定のある店舗では、出勤後に予約人数・時間などのヒアリングが続く場合があります。文字入力が求められるときは、画面の案内に従ってください。
            </li>
            <li>遅刻・欠勤・半休・公休を選んだあと、理由を聞かれることがあります。</li>
          </ol>
        </section>

        <section className="mt-12" aria-labelledby="admin-users">
          <h2 id="admin-users" className="text-lg font-semibold text-slate-900">
            管理者の方（ブラウザログイン）
          </h2>
          <GuideFigure
            src="/guide/admin-browser.svg"
            width={640}
            height={260}
            alt="ブラウザのアドレスバーとログインフォームの模式図"
            caption="店舗から案内された URL とアカウントでサインインします。URL は運用で異なる場合があります。"
          />
          <ul className="mt-4 list-disc space-y-2 pl-5 text-sm leading-relaxed text-slate-700 sm:text-base">
            <li>トップの「ログイン」から、店舗から案内されたユーザー名（またはメール）とパスワードでサインインします。</li>
            <li>ログイン後は週間シフト入力・シフト一覧・キャスト管理・レポート・設定など、権限に応じたメニューが使えます。</li>
            <li>複数店舗を扱うスーパー管理者は、店舗の切り替えにご注意ください。</li>
          </ul>
        </section>

        <section className="mt-12 rounded-lg border border-amber-200/80 bg-amber-50/50 px-4 py-4 sm:px-5" aria-labelledby="notes">
          <h2 id="notes" className="text-base font-semibold text-slate-900">
            ご注意
          </h2>
          <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-relaxed text-slate-700">
            <li>利用可能な機能は店舗の契約・設定（業態・LINE・リマインドなど）により異なります。</li>
            <li>ログインや LINE がうまく動かないときは、店舗の管理者にお問い合わせください。</li>
          </ul>
        </section>

        <div className="mt-12 border border-slate-200 bg-white px-5 py-6 text-center shadow-sm sm:px-8">
          <p className="text-sm text-slate-600">アカウントをお持ちの方</p>
          <Link
            href="/login"
            className="mt-4 inline-flex min-h-[44px] w-full items-center justify-center rounded-md bg-slate-900 px-6 text-sm font-medium text-white transition-colors hover:bg-slate-800 sm:w-auto"
          >
            ログイン画面へ
          </Link>
        </div>
      </main>

      <footer className="border-t border-slate-200 bg-white py-8 text-center text-xs text-slate-500">
        <Link href="/" className="text-slate-600 hover:text-slate-900">
          トップへ
        </Link>
        <span className="mx-2 text-slate-300">·</span>© raku-kyaba
      </footer>
    </div>
  );
}
