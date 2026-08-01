/** Club GOLD 案内数ヒアリングの業態定義（サイト表示・LINE入力・DBカラムの共通源） */

export const GUIDE_VENUE_IDS = [
  "gold",
  "sek",
  "lounge",
  "girls_bar",
  "concecafe",
  "philippine_pub",
] as const;

export type GuideVenueId = (typeof GUIDE_VENUE_IDS)[number];

export type GuideVenueDef = {
  id: GuideVenueId;
  /** 画面・LINE 表示名 */
  label: string;
  /** 印刷・狭い表向け短縮名 */
  shortLabel: string;
  /** postback 用の組数キー */
  groupsKey: string;
  /** postback 用の人数キー */
  peopleKey: string;
  /** daily_guide_results 組数カラム */
  groupsColumn: string;
  /** daily_guide_results 人数カラム */
  peopleColumn: string;
};

export const GUIDE_VENUES: readonly GuideVenueDef[] = [
  {
    id: "gold",
    label: "GOLD",
    shortLabel: "GOLD",
    groupsKey: "g",
    peopleKey: "gp",
    groupsColumn: "gold_guide_count",
    peopleColumn: "gold_people_count",
  },
  {
    id: "sek",
    label: "セクキャバ",
    shortLabel: "セク",
    groupsKey: "s",
    peopleKey: "sp",
    groupsColumn: "sek_guide_count",
    peopleColumn: "sek_people_count",
  },
  {
    id: "lounge",
    label: "ラウンジ",
    shortLabel: "ラウンジ",
    groupsKey: "ln",
    peopleKey: "lnp",
    groupsColumn: "lounge_guide_count",
    peopleColumn: "lounge_people_count",
  },
  {
    id: "girls_bar",
    label: "ガールズバー",
    shortLabel: "ガバ",
    groupsKey: "gb",
    peopleKey: "gbp",
    groupsColumn: "girls_bar_guide_count",
    peopleColumn: "girls_bar_people_count",
  },
  {
    id: "concecafe",
    label: "コンカフェ",
    shortLabel: "コンカ",
    groupsKey: "cc",
    peopleKey: "ccp",
    groupsColumn: "concecafe_guide_count",
    peopleColumn: "concecafe_people_count",
  },
  {
    id: "philippine_pub",
    label: "フィリピンパブ",
    shortLabel: "フィプ",
    groupsKey: "ph",
    peopleKey: "php",
    groupsColumn: "philippine_pub_guide_count",
    peopleColumn: "philippine_pub_people_count",
  },
] as const;

export type GuideVenueCounts = Record<GuideVenueId, { groups: number; people: number }>;

export function emptyGuideVenueCounts(): GuideVenueCounts {
  return {
    gold: { groups: 0, people: 0 },
    sek: { groups: 0, people: 0 },
    lounge: { groups: 0, people: 0 },
    girls_bar: { groups: 0, people: 0 },
    concecafe: { groups: 0, people: 0 },
    philippine_pub: { groups: 0, people: 0 },
  };
}

export function isGuideVenueId(v: string | null | undefined): v is GuideVenueId {
  return GUIDE_VENUE_IDS.includes(v as GuideVenueId);
}

export function getGuideVenue(id: GuideVenueId): GuideVenueDef {
  const found = GUIDE_VENUES.find((v) => v.id === id);
  if (!found) throw new Error(`Unknown guide venue: ${id}`);
  return found;
}

export function sumGuideVenueCounts(counts: GuideVenueCounts): {
  guideCount: number;
  peopleCount: number;
} {
  let guideCount = 0;
  let peopleCount = 0;
  for (const id of GUIDE_VENUE_IDS) {
    guideCount += counts[id].groups;
    peopleCount += counts[id].people;
  }
  return { guideCount, peopleCount };
}

export function formatGuideVenueCountsSummary(counts: GuideVenueCounts): string {
  const parts = GUIDE_VENUES.filter((v) => counts[v.id].groups > 0 || counts[v.id].people > 0).map(
    (v) => `${v.label} ${counts[v.id].groups}組・${counts[v.id].people}人`
  );
  if (parts.length === 0) return "（すべて0）";
  return parts.join(" / ");
}

/** postback query へ業態カウントを載せる */
export function appendGuideVenueCountsToParams(
  params: URLSearchParams,
  counts: GuideVenueCounts
): void {
  for (const v of GUIDE_VENUES) {
    params.set(v.groupsKey, String(counts[v.id].groups));
    params.set(v.peopleKey, String(counts[v.id].people));
  }
}

export function parseGuideVenueCountsFromParams(
  params: URLSearchParams,
  max: number
): GuideVenueCounts | null {
  const out = emptyGuideVenueCounts();
  for (const v of GUIDE_VENUES) {
    const g = Number(params.get(v.groupsKey) ?? "0");
    const p = Number(params.get(v.peopleKey) ?? "0");
    if (!Number.isInteger(g) || g < 0 || g > max) return null;
    if (!Number.isInteger(p) || p < 0 || p > max) return null;
    out[v.id] = { groups: g, people: p };
  }
  return out;
}

/** DB 行 ↔ GuideVenueCounts */
export function guideVenueCountsFromRow(row: Record<string, unknown>): GuideVenueCounts {
  const out = emptyGuideVenueCounts();
  for (const v of GUIDE_VENUES) {
    const g = row[v.groupsColumn];
    const p = row[v.peopleColumn];
    out[v.id] = {
      groups: typeof g === "number" && Number.isFinite(g) ? Math.floor(g) : 0,
      people: typeof p === "number" && Number.isFinite(p) ? Math.floor(p) : 0,
    };
  }
  return out;
}

export function guideVenueCountsToDbColumns(counts: GuideVenueCounts): Record<string, number> {
  const out: Record<string, number> = {};
  for (const v of GUIDE_VENUES) {
    out[v.groupsColumn] = counts[v.id].groups;
    out[v.peopleColumn] = counts[v.id].people;
  }
  return out;
}
