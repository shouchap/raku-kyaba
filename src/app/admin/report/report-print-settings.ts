export type ReportPrintLayout = "standard" | "compact" | "fit" | "landscape";

const STORAGE_KEY = "raku-kyaba-report-print-layout";

const LAYOUT_CLASS_PREFIX = "report-print-layout-";

const ALL_LAYOUT_CLASSES = [
  `${LAYOUT_CLASS_PREFIX}standard`,
  `${LAYOUT_CLASS_PREFIX}compact`,
  `${LAYOUT_CLASS_PREFIX}fit`,
  `${LAYOUT_CLASS_PREFIX}landscape`,
] as const;

export const REPORT_PRINT_LAYOUT_OPTIONS: ReadonlyArray<{
  value: ReportPrintLayout;
  label: string;
  description: string;
}> = [
  {
    value: "standard",
    label: "標準（A4縦）",
    description: "通常サイズ。表はページ幅に合わせて折り返します。",
  },
  {
    value: "compact",
    label: "コンパクト",
    description: "文字・余白を小さくし、列の多い表のはみ出しを抑えます。",
  },
  {
    value: "fit",
    label: "縮小フィット",
    description: "内容を少し縮小して1ページ幅に収めやすくします。",
  },
  {
    value: "landscape",
    label: "横向き（A4横）",
    description: "B型日報など列数が多いレイアウト向け。",
  },
];

function isReportPrintLayout(v: string): v is ReportPrintLayout {
  return v === "standard" || v === "compact" || v === "fit" || v === "landscape";
}

export function loadReportPrintLayout(): ReportPrintLayout {
  if (typeof window === "undefined") return "standard";
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw && isReportPrintLayout(raw)) return raw;
  } catch {
    /* ignore */
  }
  return "standard";
}

export function saveReportPrintLayout(layout: ReportPrintLayout): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, layout);
  } catch {
    /* ignore */
  }
}

/** 印刷ダイアログ用に html/body にレイアウトクラスを付与 */
export function applyReportPrintLayout(layout: ReportPrintLayout): void {
  if (typeof document === "undefined") return;
  const cls = `${LAYOUT_CLASS_PREFIX}${layout}`;
  for (const c of ALL_LAYOUT_CLASSES) {
    document.documentElement.classList.remove(c);
    document.body.classList.remove(c);
  }
  document.documentElement.classList.add(cls);
  document.body.classList.add(cls);
}

export function clearReportPrintLayout(): void {
  if (typeof document === "undefined") return;
  for (const c of ALL_LAYOUT_CLASSES) {
    document.documentElement.classList.remove(c);
    document.body.classList.remove(c);
  }
}

/** 現在の表示内容からおすすめレイアウトを推定 */
export function suggestReportPrintLayout(input: {
  reportTab: "cast" | "guide";
  businessType: "cabaret" | "welfare_b" | "bar" | "fuzoku";
  viewMode: "month" | "week" | "day";
  castSubTab: "basic" | "bar_actions" | "interviews";
}): ReportPrintLayout {
  if (input.reportTab === "guide") return "compact";
  if (input.businessType === "welfare_b" && input.viewMode !== "day") {
    return "landscape";
  }
  if (input.castSubTab === "bar_actions") return "landscape";
  if (input.castSubTab === "basic") return "compact";
  return "standard";
}
