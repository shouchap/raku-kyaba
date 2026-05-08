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

export const BUSINESS_THEME: Record<BusinessType, BusinessTheme> = {
  bar: {
    key: "bar",
    label: "BAR",
    headerClass: "border-slate-400/40 bg-slate-700/95 text-slate-100",
    navActiveClass: "bg-slate-700 text-slate-100 border-slate-400",
    navMutedClass: "bg-slate-100 text-slate-700 border-slate-300 hover:bg-slate-200",
    pageBackgroundClass: "bg-slate-100 text-slate-900",
    cardAccentClass: "border-slate-300 bg-white text-slate-900",
    reportStatCardClass: "border-slate-300 bg-white text-slate-900",
    reportStatLabelClass: "text-slate-700",
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
  fuzoku: {
    key: "fuzoku",
    label: "風俗",
    headerClass: "border-fuchsia-200/80 bg-fuchsia-50/85 text-fuchsia-950",
    navActiveClass: "bg-fuchsia-100 text-fuchsia-900 border-fuchsia-300",
    navMutedClass: "bg-white text-slate-700 border-slate-200 hover:bg-fuchsia-50/70",
    pageBackgroundClass: "bg-fuchsia-50/40 text-slate-900",
    cardAccentClass: "border-fuchsia-200 bg-gradient-to-br from-fuchsia-50 to-rose-50 text-slate-900",
    reportStatCardClass: "border-fuchsia-200 bg-white text-slate-900",
    reportStatLabelClass: "text-fuchsia-700",
  },
};
