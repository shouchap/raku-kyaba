/**
 * マイグレーション040（sek/gold カラム）未適用の DB に対するフォールバック判定。
 */
export function isDailyGuideResultsMissingSekGoldColumns(message: string | undefined): boolean {
  const m = message ?? "";
  return (
    m.includes("sek_guide_count") ||
    m.includes("sek_people_count") ||
    m.includes("gold_guide_count") ||
    m.includes("gold_people_count") ||
    /column .*daily_guide_results\.(sek|gold)_/.test(m)
  );
}
