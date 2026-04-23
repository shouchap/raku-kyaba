import type { ReactNode } from "react";
import Link from "next/link";
import {
  BookOpen,
  Cpu,
  HeartHandshake,
  ShieldCheck,
  Sparkles,
  UserPlus,
} from "lucide-react";

export type TreatmentImprovementCategory = {
  id: string;
  title: string;
  icon: ReactNode;
  items: readonly string[];
};

const DEFAULT_CATEGORIES: readonly TreatmentImprovementCategory[] = [
  {
    id: "recruitment",
    title: "入職促進に向けた取組",
    icon: <UserPlus className="h-5 w-5 shrink-0" aria-hidden />,
    items: [
      "他産業からの転職者、主婦層、中高年齢者等、経験者・有資格者等にこだわらない幅広い採用の仕組みの構築",
      "職業体験の受入れや地域行事への参加や主催等による職業魅力向上の取組の実施",
    ],
  },
  {
    id: "development",
    title: "資質の向上やキャリアアップに向けた支援",
    icon: <BookOpen className="h-5 w-5 shrink-0" aria-hidden />,
    items: [
      "働きながら国家資格等の取得を目指す者に対する研修受講支援や、業務関連専門技術研修の受講支援等",
    ],
  },
  {
    id: "work-life",
    title: "両立支援・多様な働き方の推進",
    icon: <HeartHandshake className="h-5 w-5 shrink-0" aria-hidden />,
    items: [
      "職員の事情等の状況に応じた勤務シフトや短時間正規職員制度の導入、非正規職員から正規職員への転換の制度等の整備",
      "有給休暇の取得促進のため、情報共有や複数担当制等により、業務の属人化の解消、業務配分の偏りの解消に取り組んでいる",
    ],
  },
  {
    id: "health",
    title: "腰痛を含む心身の健康管理",
    icon: <ShieldCheck className="h-5 w-5 shrink-0" aria-hidden />,
    items: [
      "事故・トラブルへの対応マニュアル等の作成等の体制の整備",
      "5S活動等の実践による職場環境の整備を行っている",
    ],
  },
  {
    id: "productivity",
    title: "生産性向上のための取組",
    icon: <Cpu className="h-5 w-5 shrink-0" aria-hidden />,
    items: [
      "業務支援ソフト、情報端末（タブレット端末等）の導入",
      "協働化を通じた職場環境の改善に向けた取組の実施",
    ],
  },
  {
    id: "motivation",
    title: "やりがい・働きがいの醸成",
    icon: <Sparkles className="h-5 w-5 shrink-0" aria-hidden />,
    items: [
      "支援の好事例や、利用者やその家族からの謝意等の情報を共有する機会の提供",
    ],
  },
] as const;

export type TreatmentImprovementProps = {
  /** 外側ラッパー用（LPセクション幅・背景の調整など） */
  className?: string;
  /** セクションの DOM id（アンカーリンク用） */
  id?: string;
  /** 見出しレベル（ページ構造に合わせて h2 / h3 を選べる） */
  headingLevel?: 2 | 3;
  categories?: readonly TreatmentImprovementCategory[];
  /** 求人応募への導線を表示する */
  showCta?: boolean;
  ctaHref?: string;
  ctaLabel?: string;
  ctaDescription?: string;
};

function Heading({
  level,
  id,
  children,
}: {
  level: 2 | 3;
  id: string;
  children: ReactNode;
}) {
  const cls =
    "text-balance text-lg font-bold leading-snug tracking-tight text-slate-900 sm:text-xl";
  if (level === 3) {
    return (
      <h3 id={id} className={cls}>
        {children}
      </h3>
    );
  }
  return (
    <h2 id={id} className={cls}>
      {children}
    </h2>
  );
}

/**
 * 福祉・介護職員等処遇改善加算に基づく「職場環境等要件（見える化要件）」の取組を表示するブロック。
 * LP のセクションや求人ページの一部としてそのまま差し込める。
 */
export function TreatmentImprovement({
  className = "",
  id = "treatment-improvement-workplace",
  headingLevel = 2,
  categories = DEFAULT_CATEGORIES,
  showCta = true,
  ctaHref = "/careers",
  ctaLabel = "募集要項・応募はこちら",
  ctaDescription = "未経験・ブランク歓迎。まずは気軽にお問い合わせください。",
}: TreatmentImprovementProps) {
  const titleId = `${id}-title`;
  const introId = `${id}-intro`;

  return (
    <section
      id={id}
      aria-labelledby={titleId}
      className={`text-slate-800 ${className}`.trim()}
    >
      <div className="mx-auto w-full max-w-3xl px-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] py-8 sm:py-10">
        <header className="mb-6 sm:mb-8">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-teal-700 sm:text-[0.8125rem]">
            職場環境等要件（見える化）
          </p>
          <Heading level={headingLevel} id={titleId}>
            福祉・介護職員等処遇改善加算に基づく取組
          </Heading>
          <p
            id={introId}
            className="mt-3 text-pretty text-sm leading-relaxed text-slate-600 sm:mt-4 sm:text-[0.9375rem]"
          >
            当施設では、処遇改善加算の要件である職場環境の整備に向けた取組を継続しています。採用・研修・両立支援から安全・生産性・やりがいまで、職員が安心して長く働ける環境づくりを進めています。
          </p>
        </header>

        <ul className="grid list-none gap-4 p-0 sm:gap-5">
          {categories.map((cat) => (
            <li key={cat.id}>
              <article
                className="rounded-xl border border-slate-200/90 bg-white p-4 shadow-sm sm:p-5"
                aria-labelledby={`${id}-${cat.id}-heading`}
              >
                <div className="flex items-start gap-3">
                  <span
                    className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-teal-100 bg-teal-50 text-teal-800"
                    aria-hidden
                  >
                    {cat.icon}
                  </span>
                  <div className="min-w-0 flex-1">
                    <h3
                      id={`${id}-${cat.id}-heading`}
                      className="text-base font-semibold leading-snug text-slate-900 sm:text-[1.0625rem]"
                    >
                      {cat.title}
                    </h3>
                    <ul className="mt-3 list-disc space-y-2 pl-4 text-sm leading-relaxed text-slate-700 marker:text-teal-600 sm:text-[0.9375rem]">
                      {cat.items.map((text) => (
                        <li key={text} className="pl-0.5">
                          {text}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </article>
            </li>
          ))}
        </ul>

        {showCta ? (
          <div className="mt-8 rounded-xl border border-teal-200/80 bg-gradient-to-b from-teal-50/90 to-white p-4 sm:mt-10 sm:p-6">
            <p className="text-pretty text-sm font-medium leading-relaxed text-slate-800 sm:text-base">
              経験や資格に関わらず、一緒に働く仲間を募集しています。職場の取組内容についても面接・見学の際にご説明します。
            </p>
            {ctaHref ? (
              <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-xs leading-relaxed text-slate-600 sm:text-sm">
                  {ctaDescription}
                </p>
                <Link
                  href={ctaHref}
                  className="inline-flex min-h-[44px] shrink-0 items-center justify-center rounded-lg bg-teal-700 px-4 py-2.5 text-center text-sm font-semibold text-white shadow-sm transition-colors hover:bg-teal-800 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:ring-offset-2 active:bg-teal-900 sm:px-5"
                >
                  {ctaLabel}
                </Link>
              </div>
            ) : (
              <p className="mt-3 text-xs text-slate-600 sm:text-sm">{ctaDescription}</p>
            )}
          </div>
        ) : null}

        <p className="mt-6 text-xs leading-relaxed text-slate-500 sm:text-sm">
          表示内容は処遇改善加算の職場環境等要件（見える化要件）に沿った取組の一例です。詳細は採用担当までお問い合わせください。
        </p>
      </div>
    </section>
  );
}
