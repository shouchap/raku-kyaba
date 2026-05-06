export type BusinessType = "cabaret" | "welfare_b" | "bar";

export function normalizeBusinessType(raw: string | null | undefined): BusinessType {
  if (raw === "welfare_b") return "welfare_b";
  if (raw === "bar") return "bar";
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

export const BUSINESS_THEME: Record<BusinessType, BusinessTheme> = {
  bar: {
    key: "bar",
    label: "BAR",
    headerClass: "border-slate-700/40 bg-slate-900/95 text-slate-100",
    navActiveClass: "bg-slate-800 text-slate-100 border-slate-500",
    navMutedClass: "bg-slate-800/30 text-slate-200 border-slate-600/50 hover:bg-slate-800/50",
    pageBackgroundClass: "bg-slate-950 text-slate-100",
    cardAccentClass: "border-slate-700 bg-slate-900/80 text-slate-100",
    reportStatCardClass: "border-slate-700 bg-slate-900 text-slate-100",
    reportStatLabelClass: "text-slate-300",
  },
  cabaret: {
    key: "cabaret",
    label: "キャバクラ",
    headerClass: "border-rose-200/80 bg-rose-50/85 text-rose-950",
    navActiveClass: "bg-rose-100 text-rose-900 border-rose-300",
    navMutedClass: "bg-white text-slate-700 border-slate-200 hover:bg-rose-50/70",
    pageBackgroundClass: "bg-rose-50/40 text-slate-900",
    cardAccentClass: "border-rose-200 bg-gradient-to-br from-rose-50 to-amber-50 text-slate-900",
    reportStatCardClass: "border-rose-200 bg-white text-slate-900",
    reportStatLabelClass: "text-rose-700",
  },
  welfare_b: {
    key: "welfare_b",
    label: "福祉",
    headerClass: "border-emerald-200/80 bg-emerald-50/90 text-emerald-950",
    navActiveClass: "bg-emerald-100 text-emerald-900 border-emerald-300",
    navMutedClass: "bg-white text-slate-700 border-slate-200 hover:bg-emerald-50/70",
    pageBackgroundClass: "bg-emerald-50/40 text-slate-900",
    cardAccentClass: "border-emerald-200 bg-gradient-to-br from-emerald-50 to-sky-50 text-slate-900",
    reportStatCardClass: "border-emerald-200 bg-white text-slate-900",
    reportStatLabelClass: "text-emerald-700",
  },
};
