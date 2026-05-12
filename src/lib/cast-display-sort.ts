/**
 * シフト入力・一覧などでキャスト行の並び順を統一する。
 * DB の casts.role（cast / nakai）と casts.employment_type を参照。
 */

export type CastDisplaySortInput = {
  id: string;
  name: string;
  role?: string | null;
  employment_type?: string | null;
};

/** 数値が小さいほど上に表示 */
export function getCastDisplaySortWeight(c: CastDisplaySortInput): number {
  const role = String(c.role ?? "cast")
    .trim()
    .toLowerCase();
  const emp = String(c.employment_type ?? "")
    .trim()
    .toLowerCase();

  if (role === "staff" || role === "manager" || role === "employee") return 3;
  if (role === "nakai") return 2;
  if (role === "cast" || role === "") {
    if (emp === "admin" || emp === "employee") return 3;
    return 1;
  }
  return 99;
}

export function compareCastsByRoleThenName(a: CastDisplaySortInput, b: CastDisplaySortInput): number {
  const wa = getCastDisplaySortWeight(a);
  const wb = getCastDisplaySortWeight(b);
  if (wa !== wb) return wa - wb;
  return a.name.localeCompare(b.name, "ja") || a.id.localeCompare(b.id);
}

export function sortCastsForShiftDisplay<T extends CastDisplaySortInput>(casts: T[]): T[] {
  return [...casts].sort(compareCastsByRoleThenName);
}
