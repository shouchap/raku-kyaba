import { addCalendarDaysJst } from "@/lib/date-utils";
import { chunkDailyBarSummaryBody, DAILY_BAR_SUMMARY_MAX_CHUNK_LEN } from "@/lib/daily-bar-summary";

/** LINE テキスト分割に既存の上限を流用 */
export const WEEKLY_REPORT_MAX_CHUNK_LEN = DAILY_BAR_SUMMARY_MAX_CHUNK_LEN;

export type WeeklyReportBusinessType = "cabaret" | "welfare_b" | "bar";

/**
 * 送信日 JST の前日を終端とした過去7暦日 [startYmd, endYmd]（両端含む）。
 */
export function computeWeeklyReportPeriod(sendDateYmd: string): { startYmd: string; endYmd: string } {
  const endYmd = addCalendarDaysJst(sendDateYmd, -1);
  const startYmd = addCalendarDaysJst(endYmd, -6);
  return { startYmd, endYmd };
}

function formatJaYmd(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  if (!y || !m || !d) return ymd;
  return `${y}年${m}月${d}日`;
}

export function formatWeeklyPeriodLabelJa(startYmd: string, endYmd: string): string {
  const [ys, ms] = startYmd.split("-").map(Number);
  const [ye, me] = endYmd.split("-").map(Number);
  if (!ys || !ms || !ye || !me) return `${startYmd}〜${endYmd}`;
  const ds = Number(startYmd.split("-")[2]);
  const de = Number(endYmd.split("-")[2]);
  if (ys === ye && ms === me) {
    return `${ys}年${ms}月${ds}日〜${de}日`;
  }
  return `${formatJaYmd(startYmd)}〜${formatJaYmd(endYmd)}`;
}

/**
 * BAR の action_detail（例: 本指名(2), ドリンク(15)）を種別ごとの件数に分解する。
 */
export function mergeBarActionDetailCountsInto(
  target: Map<string, number>,
  actionDetail: string | null | undefined
): void {
  const raw = typeof actionDetail === "string" ? actionDetail.trim() : "";
  if (!raw) return;

  const segments = raw.split(/\s*,\s*/).map((s) => s.trim()).filter(Boolean);
  for (const seg of segments) {
    const m = seg.match(/^(.+?)\(([^)]*)\)\s*$/);
    if (!m) continue;
    const kind = m[1].trim();
    if (!kind) continue;
    const inner = m[2].trim();
    const numMatch = inner.match(/\d+/);
    const n = numMatch ? Number.parseInt(numMatch[0], 10) : 1;
    const add = Number.isFinite(n) && n > 0 ? n : 1;
    target.set(kind, (target.get(kind) ?? 0) + add);
  }
}

export type WeeklyReportCabaretSection = {
  totalGuideGroups: number;
  totalCompanionPairs: number;
};

export type WeeklyReportWelfareSection = {
  logCount: number;
  distinctCastCount: number;
  quantitySum: number;
};

export type WeeklyReportBarSection = {
  plannedGroupsSum: number;
  tentativeGroupsSum: number;
  castActionLines: Array<{ castName: string; summaryParts: string[] }>;
};

export type WeeklyReportBuildInput = {
  storeName: string;
  businessType: WeeklyReportBusinessType;
  periodStartYmd: string;
  periodEndYmd: string;
  termAttendance: string;
  termCast: string;
  /** cabaret/bar: 各キャストの出勤日数合計 / welfare: (cast,日) の組み合わせ数 */
  totalAttendanceDaysComposite: number;
  cabaret?: WeeklyReportCabaretSection;
  welfare?: WeeklyReportWelfareSection;
  bar?: WeeklyReportBarSection;
};

export function buildWeeklyReportBody(input: WeeklyReportBuildInput): string {
  const periodJa = formatWeeklyPeriodLabelJa(input.periodStartYmd, input.periodEndYmd);
  const ta = input.termAttendance.trim() || "出勤";
  const tc = input.termCast.trim() || "キャスト";

  const lines: string[] = [
    `【週間レポート】${input.storeName || "店舗"}`,
    `対象期間: ${periodJa}`,
    `全体の${ta}日数（合計）: ${input.totalAttendanceDaysComposite}`,
  ];

  if (input.businessType === "cabaret" && input.cabaret) {
    lines.push(`総案内組数: ${input.cabaret.totalGuideGroups}`);
    lines.push(`同伴組数（合計）: ${input.cabaret.totalCompanionPairs}`);
  }

  if (input.businessType === "welfare_b" && input.welfare) {
    lines.push(`${ta}記録件数: ${input.welfare.logCount}`);
    lines.push(`記録のあった${tc}数: ${input.welfare.distinctCastCount}`);
    lines.push(`数量の合計（入力がある場合）: ${input.welfare.quantitySum}`);
  }

  if (input.businessType === "bar" && input.bar) {
    lines.push(`${tc}別の確定組数合計: ${input.bar.plannedGroupsSum}`);
    lines.push(`仮予定組数合計: ${input.bar.tentativeGroupsSum}`);
    lines.push("");
    lines.push(`■ ${tc}別 行動サマリー`);
    if (input.bar.castActionLines.length === 0) {
      lines.push("（行動入力のある記録はありません）");
    } else {
      for (const row of input.bar.castActionLines) {
        const body =
          row.summaryParts.length > 0 ? row.summaryParts.join(" / ") : "—";
        lines.push(`・${row.castName}: ${body}`);
      }
    }
  }

  return lines.join("\n").trimEnd();
}

export function chunkWeeklyReportBody(body: string): string[] {
  return chunkDailyBarSummaryBody(body, WEEKLY_REPORT_MAX_CHUNK_LEN);
}
