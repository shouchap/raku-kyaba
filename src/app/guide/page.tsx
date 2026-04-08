import Image from "next/image";
import Link from "next/link";

function GuideFigure({
  src,
  width,
  height,
  alt,
  caption,
  priority,
}: {
  src: string;
  width: number;
  height: number;
  alt: string;
  caption: string;
  priority?: boolean;
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
          priority={priority}
        />
      </div>
      <figcaption className="mt-2 text-xs leading-relaxed text-slate-500">{caption}</figcaption>
    </figure>
  );
}

const keyPoints = [
  {
    title: "現場は LINE で完結しやすい",
    body: "スマホがあれば、出勤・遅刻・欠勤などの連絡をボタン操作で済ませられます（店舗の設定による）。",
  },
  {
    title: "店舗ごとに画面や流れが変わる",
    body: "業態や契約内容に合わせて、届くメッセージや入力項目が異なります。迷ったら店舗の案内を優先してください。",
  },
  {
    title: "まとめて見るのはブラウザ",
    body: "シフト・来客・レポートなどを扱うのは主に管理者向け。PC・タブレットのブラウザからログインします。",
  },
];

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
          <p className="text-xs font-medium uppercase tracking-wider text-slate-500">はじめての方へ · 利用ガイド</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">
            仕組みと使い方を、図でサッと理解する
          </h1>
          <p className="mt-4 max-w-2xl text-sm leading-relaxed text-slate-600 sm:text-base">
            出勤連絡と店舗管理をつなぐポータルです。下では「誰が何をどこで行うか」を整理し、LINE
            利用の流れと管理者ログインの流れを順に説明します。最後にログインへ進めます。
          </p>
        </header>

        <section className="mt-10 rounded-xl border border-blue-100 bg-gradient-to-b from-blue-50/80 to-white px-4 py-5 sm:px-6" aria-labelledby="why-use">
          <h2 id="why-use" className="text-base font-semibold text-slate-900">
            なぜ使うと楽になるか
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-slate-700 sm:text-base">
            声かけ・電話・紙の往復は、抜け・遅れ・担当者の負担が出やすいものです。LINE
            とブラウザを組み合わせることで、<strong className="font-medium text-slate-900">現場のタップ入力</strong>
            と<strong className="font-medium text-slate-900">店舗側の一覧・記録</strong>
            をつなぎ、運用の見通しを揃えやすくします。利用できる機能は
            <strong className="font-medium text-slate-900">契約・店舗設定</strong>により異なります。
          </p>
        </section>

        <section className="mt-10" aria-labelledby="three-keys">
          <h2 id="three-keys" className="text-lg font-semibold text-slate-900">
            最初に押さえる 3 つのポイント
          </h2>
          <ul className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
            {keyPoints.map((item) => (
              <li
                key={item.title}
                className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm"
              >
                <p className="text-sm font-semibold text-slate-900">{item.title}</p>
                <p className="mt-2 text-xs leading-relaxed text-slate-600 sm:text-sm">{item.body}</p>
              </li>
            ))}
          </ul>
        </section>

        <section className="mt-12" aria-labelledby="flow-concept">
          <h2 id="flow-concept" className="text-lg font-semibold text-slate-900">
            ざっくり全体の流れ（概念図）
          </h2>
          <p className="mt-3 text-sm leading-relaxed text-slate-600 sm:text-base">
            スタッフが LINE で回答した内容が、店舗のルールに沿って扱われ、管理者がブラウザで確認する——という関係をイメージしてください。
          </p>
          <GuideFigure
            src="/guide/journey-at-a-glance.svg"
            width={800}
            height={200}
            alt="スタッフがLINEでタップし、システムが記録し、管理者がブラウザで確認する流れの概念図"
            caption="実際の画面名・メニュー名は権限と店舗設定により異なります。"
            priority
          />
        </section>

        <section className="mt-12" aria-labelledby="checklist">
          <h2 id="checklist" className="text-lg font-semibold text-slate-900">
            はじめる前のチェック（キャスト・利用者向け）
          </h2>
          <p className="mt-3 text-sm leading-relaxed text-slate-600 sm:text-base">
            トラブルを減らすため、次をそろえてから操作するとスムーズです。
          </p>
          <GuideFigure
            src="/guide/checklist-before-start.svg"
            width={640}
            height={280}
            alt="公式LINE追加・通知オン・問い合わせ先の3チェックを示す図"
            caption="ログインや契約の窓口は店舗の運用に従ってください。"
          />
        </section>

        <section className="mt-12" aria-labelledby="two-entries">
          <h2 id="two-entries" className="text-lg font-semibold text-slate-900">
            2 つの入り口（役割ごと）
          </h2>
          <p className="mt-3 text-sm leading-relaxed text-slate-600 sm:text-base">
            <span className="font-medium text-slate-800">LINE</span>
            はキャスト・利用者向け、
            <span className="font-medium text-slate-800">このサイトへのログイン</span>
            は主に管理者・店長向けです。
          </p>
          <GuideFigure
            src="/guide/overview-line-vs-web.svg"
            width={880}
            height={300}
            alt="左がスマートフォン上のLINE、右がブラウザの管理画面であることを示す模式図"
            caption="左：LINE アプリでの連絡。右：ブラウザでシフトやレポートを扱うイメージです。"
          />
        </section>

        <section className="mt-12" aria-labelledby="what-you-can-do">
          <h2 id="what-you-can-do" className="text-lg font-semibold text-slate-900">
            このシステムでできること（概要）
          </h2>
          <ul className="mt-4 space-y-3 text-sm leading-relaxed text-slate-700 sm:text-base">
            <li className="flex gap-3">
              <span className="mt-0.5 font-mono text-xs text-blue-600">01</span>
              <span>
                <strong className="font-medium text-slate-900">LINE から</strong>
                出勤・遅刻・欠勤・半休などの申告（店舗の設定・業態により選択肢が変わります）。
              </span>
            </li>
            <li className="flex gap-3">
              <span className="mt-0.5 font-mono text-xs text-blue-600">02</span>
              <span>
                <strong className="font-medium text-slate-900">管理者はブラウザから</strong>
                週間シフト入力・一覧・キャスト情報・レポート・各種設定など（権限に応じて表示されます）。
              </span>
            </li>
            <li className="flex gap-3">
              <span className="mt-0.5 font-mono text-xs text-blue-600">03</span>
              <span>
                <strong className="font-medium text-slate-900">業態に応じた画面</strong>
                キャバクラ・BAR・就労支援 B 型など、店舗の種類に合わせてフローが切り替わります。
              </span>
            </li>
          </ul>
        </section>

        <section className="mt-12" aria-labelledby="line-users">
          <h2 id="line-users" className="text-lg font-semibold text-slate-900">
            キャスト・利用者の方（LINE の流れ）
          </h2>
          <GuideFigure
            src="/guide/line-attendance-flow.svg"
            width={720}
            height={220}
            alt="友だち追加、メッセージ受信、ボタンで回答の3ステップを示す模式図"
            caption="文言・ボタンは店舗設定により異なります。届いた画面の指示を最優先にしてください。"
          />
          <ol className="mt-6 space-y-4 border-l-2 border-blue-200 pl-5 text-sm leading-relaxed text-slate-700 sm:text-base">
            <li>
              <span className="font-medium text-slate-900">友だち追加</span>
              <br />
              店舗の公式 LINE を追加します。初回はウェルカムメッセージが届くことがあります。
            </li>
            <li>
              <span className="font-medium text-slate-900">届いたメッセージに答える</span>
              <br />
              リマインドや出勤確認の Flex メッセージでは、表示どおりにボタンを押して回答します。
            </li>
            <li>
              <span className="font-medium text-slate-900">追加の入力がある場合</span>
              <br />
              来客予定のある店舗では、出勤後に人数・時間などのヒアリングが続くことがあります。文字入力が出たら案内に従ってください。
            </li>
            <li>
              <span className="font-medium text-slate-900">遅刻・欠勤などを選んだあと</span>
              <br />
              理由を聞かれることがあります。内容は店舗ルールに従います。
            </li>
          </ol>
        </section>

        <section className="mt-12" aria-labelledby="admin-users">
          <h2 id="admin-users" className="text-lg font-semibold text-slate-900">
            管理者の方（ブラウザでログイン）
          </h2>
          <GuideFigure
            src="/guide/admin-browser.svg"
            width={640}
            height={260}
            alt="ブラウザのアドレスバーとログインフォームの模式図"
            caption="URL とアカウントは店舗から案内されたものをお使いください。"
          />
          <ul className="mt-6 space-y-3 text-sm leading-relaxed text-slate-700 sm:text-base">
            <li className="flex gap-3">
              <span className="text-slate-400">—</span>
              トップの「ログイン」から、案内されたユーザー名（またはメール）とパスワードでサインインします。
            </li>
            <li className="flex gap-3">
              <span className="text-slate-400">—</span>
              ログイン後は、権限に応じて週間シフト・一覧・キャスト管理・レポート・設定などが利用できます。
            </li>
            <li className="flex gap-3">
              <span className="text-slate-400">—</span>
              複数店舗を扱う場合は、画面の店舗切り替えに注意してください。
            </li>
          </ul>
        </section>

        <section className="mt-12" aria-labelledby="faq">
          <h2 id="faq" className="text-lg font-semibold text-slate-900">
            よくある質問
          </h2>
          <dl className="mt-4 space-y-3 text-sm text-slate-700">
            <div className="rounded-lg border border-slate-200 bg-white px-4 py-3">
              <dt className="font-medium text-slate-900">スマホだけで完結しますか？</dt>
              <dd className="mt-1 leading-relaxed text-slate-600">
                キャスト・利用者の出勤連絡は LINE 上で完結しやすい設計です。管理者向けの詳細操作はブラウザ（PC
                やタブレット推奨）から行います。
              </dd>
            </div>
            <div className="rounded-lg border border-slate-200 bg-white px-4 py-3">
              <dt className="font-medium text-slate-900">ログインできません</dt>
              <dd className="mt-1 leading-relaxed text-slate-600">
                ID・パスワードの誤り、店舗の無効化、権限の範囲などが考えられます。必ず店舗の管理者へお問い合わせください。
              </dd>
            </div>
            <div className="rounded-lg border border-slate-200 bg-white px-4 py-3">
              <dt className="font-medium text-slate-900">店舗として導入・契約を検討したい</dt>
              <dd className="mt-1 leading-relaxed text-slate-600">
                契約条件・お見積り・運用設計は、貴店の窓口または当サービスの営業・サポート担当へご相談ください（このサイトから契約手続きが完結するとは限りません）。
              </dd>
            </div>
          </dl>
        </section>

        <section className="mt-12 rounded-lg border border-amber-200/80 bg-amber-50/50 px-4 py-4 sm:px-5" aria-labelledby="notes">
          <h2 id="notes" className="text-base font-semibold text-slate-900">
            ご注意
          </h2>
          <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-relaxed text-slate-700">
            <li>利用可能な機能は店舗の契約・設定（業態・LINE・リマインドなど）により異なります。</li>
            <li>不具合や不明点は、店舗の管理者へ連絡してください。</li>
          </ul>
        </section>

        <div className="mt-12 space-y-4">
          <div className="border border-slate-200 bg-white px-5 py-6 text-center shadow-sm sm:px-8">
            <p className="text-sm font-medium text-slate-800">すでにアカウントがある方</p>
            <p className="mt-1 text-xs text-slate-500">シフト確認や管理画面はこちらから</p>
            <Link
              href="/login"
              className="mt-4 inline-flex min-h-[48px] w-full items-center justify-center rounded-md bg-slate-900 px-6 text-sm font-medium text-white transition-colors hover:bg-slate-800 sm:w-auto"
            >
              ログイン画面へ
            </Link>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50/80 px-5 py-5 text-center sm:px-8">
            <p className="text-sm font-medium text-slate-800">店舗として導入を検討されている方</p>
            <p className="mt-2 text-xs leading-relaxed text-slate-600 sm:text-sm">
              契約・料金・カスタマイズは、御社の担当窓口または営業へのお問い合わせが確実です。デモや要件整理をご希望の場合も、まずはそちらへご相談ください。
            </p>
            <Link
              href="/"
              className="mt-4 inline-flex min-h-[44px] w-full items-center justify-center rounded-md border border-slate-300 bg-white px-6 text-sm font-medium text-slate-800 transition-colors hover:bg-slate-50 sm:w-auto"
            >
              トップページへ戻る
            </Link>
          </div>
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
