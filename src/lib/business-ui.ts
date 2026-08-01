export type BusinessType = "cabaret" | "welfare_b" | "bar" | "fuzoku";

export function normalizeBusinessType(raw: string | null | undefined): BusinessType {
  if (raw === "welfare_b") return "welfare_b";
  if (raw === "bar") return "bar";
  if (raw === "fuzoku") return "fuzoku";
  return "cabaret";
}

export type BusinessTheme = {
  key: BusinessType;
  label: string;
  headerClass: string;
  navActiveClass: string;
  navMutedClass: string;
  pageBackgroundClass: string;
  cardAccentClass: string;
  reportStatCardClass: string;
  reportStatLabelClass: string;
};

/** 業態ごとの見た目。本文コントラストを優先し、淡色すぎない背景にする */
export const BUSINESS_THEME: Record<BusinessType, BusinessTheme> = {
  bar: {
    key: "bar",
    label: "BAR",
    headerClass: "border-slate-500/50 bg-slate-800 text-slate-50",
    navActiveClass: "bg-slate-800 text-white border-slate-600",
    navMutedClass: "bg-white text-slate-800 border-slate-300 hover:bg-slate-100",
    pageBackgroundClass: "bg-slate-200/80 text-slate-900",
    cardAccentClass: "border-slate-300 bg-white text-slate-900",
    reportStatCardClass: "border-slate-300 bg-white text-slate-900",
    reportStatLabelClass: "text-slate-700",
  },
  cabaret: {
    key: "cabaret",
    label: "キャバクラ",
    headerClass: "border-rose-300 bg-rose-100 text-rose-950",
    navActiveClass: "bg-rose-200 text-rose-950 border-rose-400 font-semibold",
    navMutedClass: "bg-white text-slate-800 border-slate-300 hover:bg-rose-50",
    pageBackgroundClass: "bg-rose-100/70 text-slate-900",
    cardAccentClass: "border-rose-200 bg-white text-slate-900",
    reportStatCardClass: "border-rose-300 bg-white text-slate-900",
    reportStatLabelClass: "text-rose-800",
  },
  welfare_b: {
    key: "welfare_b",
    label: "福祉",
    headerClass: "border-emerald-300 bg-emerald-100 text-emerald-950",
    navActiveClass: "bg-emerald-200 text-emerald-950 border-emerald-400 font-semibold",
    navMutedClass: "bg-white text-slate-800 border-slate-300 hover:bg-emerald-50",
    pageBackgroundClass: "bg-emerald-100/70 text-slate-900",
    cardAccentClass: "border-emerald-200 bg-white text-slate-900",
    reportStatCardClass: "border-emerald-300 bg-white text-slate-900",
    reportStatLabelClass: "text-emerald-800",
  },
  fuzoku: {
    key: "fuzoku",
    label: "風俗",
    headerClass: "border-fuchsia-300 bg-fuchsia-100 text-fuchsia-950",
    navActiveClass: "bg-fuchsia-200 text-fuchsia-950 border-fuchsia-400 font-semibold",
    navMutedClass: "bg-white text-slate-800 border-slate-300 hover:bg-fuchsia-50",
    pageBackgroundClass: "bg-fuchsia-100/70 text-slate-900",
    cardAccentClass: "border-fuchsia-200 bg-white text-slate-900",
    reportStatCardClass: "border-fuchsia-300 bg-white text-slate-900",
    reportStatLabelClass: "text-fuchsia-800",
  },
};
