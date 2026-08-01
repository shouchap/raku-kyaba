import type { DailyGuideResult } from "@/types/entities";
import {
  GUIDE_VENUE_IDS,
  GUIDE_VENUES,
  guideVenueCountsFromRow,
  type GuideVenueCounts,
  type GuideVenueId,
} from "@/lib/guide-venues";

export type GuideStaffTotalRow = {
  staff_name: string;
  byVenue: GuideVenueCounts;
  guideTotal: number;
  peopleTotal: number;
  /** 互換: 旧UI向け */
  sekGroups: number;
  sekPeople: number;
  goldGroups: number;
  goldPeople: number;
};

export type GuideAggregate = {
  totalGuides: number;
  totalPeople: number;
  byVenue: GuideVenueCounts;
  staffTotals: GuideStaffTotalRow[];
  totalSekGroups: number;
  totalSekPeople: number;
  totalGoldGroups: number;
  totalGoldPeople: number;
};

function emptyVenueTotals(): GuideVenueCounts {
  return {
    gold: { groups: 0, people: 0 },
    sek: { groups: 0, people: 0 },
    lounge: { groups: 0, people: 0 },
    girls_bar: { groups: 0, people: 0 },
    concecafe: { groups: 0, people: 0 },
    philippine_pub: { groups: 0, people: 0 },
  };
}

function addVenue(a: GuideVenueCounts, b: GuideVenueCounts): GuideVenueCounts {
  const out = emptyVenueTotals();
  for (const id of GUIDE_VENUE_IDS) {
    out[id] = {
      groups: a[id].groups + b[id].groups,
      people: a[id].people + b[id].people,
    };
  }
  return out;
}

export function aggregateGuideRows(rows: DailyGuideResult[]): GuideAggregate {
  let totalGuides = 0;
  let totalPeople = 0;
  let byVenue = emptyVenueTotals();

  const m = new Map<string, { byVenue: GuideVenueCounts; guide: number; people: number }>();

  for (const r of rows) {
    const venue = guideVenueCountsFromRow(r as unknown as Record<string, unknown>);
    const g = typeof r.guide_count === "number" ? r.guide_count : 0;
    const p = typeof r.people_count === "number" ? r.people_count : 0;

    totalGuides += g;
    totalPeople += p;
    byVenue = addVenue(byVenue, venue);

    const name = String(r.staff_name ?? "").trim() || "（無名）";
    const prev = m.get(name) ?? { byVenue: emptyVenueTotals(), guide: 0, people: 0 };
    m.set(name, {
      byVenue: addVenue(prev.byVenue, venue),
      guide: prev.guide + g,
      people: prev.people + p,
    });
  }

  const staffTotals = [...m.entries()]
    .map(([staff_name, t]) => ({
      staff_name,
      byVenue: t.byVenue,
      guideTotal: t.guide,
      peopleTotal: t.people,
      sekGroups: t.byVenue.sek.groups,
      sekPeople: t.byVenue.sek.people,
      goldGroups: t.byVenue.gold.groups,
      goldPeople: t.byVenue.gold.people,
    }))
    .sort((a, b) => b.guideTotal - a.guideTotal || a.staff_name.localeCompare(b.staff_name, "ja"));

  return {
    totalGuides,
    totalPeople,
    byVenue,
    staffTotals,
    totalSekGroups: byVenue.sek.groups,
    totalSekPeople: byVenue.sek.people,
    totalGoldGroups: byVenue.gold.groups,
    totalGoldPeople: byVenue.gold.people,
  };
}

export { GUIDE_VENUES };
export type { GuideVenueId, GuideVenueCounts };
