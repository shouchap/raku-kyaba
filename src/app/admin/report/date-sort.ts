export type DateSortDir = "asc" | "desc";

/** YYYY-MM-DD の昇順/降順比較 */
export function compareDateYmd(a: string, b: string, dir: DateSortDir): number {
  const cmp = String(a).localeCompare(String(b));
  return dir === "asc" ? cmp : -cmp;
}

export function sortByDateYmd<T>(
  items: readonly T[],
  getDate: (item: T) => string,
  dir: DateSortDir
): T[] {
  return [...items].sort((a, b) => compareDateYmd(getDate(a), getDate(b), dir));
}
