import type { DailyGuideResult } from "@/types/entities";

export type GuideStaffTotalRow = {
  staff_name: string;
  sekGroups: number;
  sekPeople: number;
  goldGroups: number;
  goldPeople: number;
  guideTotal: number;
  peopleTotal: number;
};

export type GuideAggregate = {
  totalGuides: number;
  totalPeople: number;
  totalSekGroups: number;
  totalSekPeople: number;
  totalGoldGroups: number;
  totalGoldPeople: number;
  staffTotals: GuideStaffTotalRow[];
};

export function aggregateGuideRows(rows: DailyGuideResult[]): GuideAggregate {
  let totalGuides = 0;
  let totalPeople = 0;
  let totalSekGroups = 0;
  let totalSekPeople = 0;
  let totalGoldGroups = 0;
  let totalGoldPeople = 0;

  const m = new Map<
    string,
    { sekG: number; sekP: number; goldG: number; goldP: number; guide: number; people: number }
  >();

  for (const r of rows) {
    const sekG = typeof r.sek_guide_count === "number" ? r.sek_guide_count : 0;
    const sekP = typeof r.sek_people_count === "number" ? r.sek_people_count : 0;
    const goldG = typeof r.gold_guide_count === "number" ? r.gold_guide_count : 0;
    const goldP = typeof r.gold_people_count === "number" ? r.gold_people_count : 0;
    const g = typeof r.guide_count === "number" ? r.guide_count : 0;
    const p = typeof r.people_count === "number" ? r.people_count : 0;

    totalGuides += g;
    totalPeople += p;
    totalSekGroups += sekG;
    totalSekPeople += sekP;
    totalGoldGroups += goldG;
    totalGoldPeople += goldP;

    const name = String(r.staff_name ?? "").trim() || "（無名）";
    const prev =
      m.get(name) ?? { sekG: 0, sekP: 0, goldG: 0, goldP: 0, guide: 0, people: 0 };
    m.set(name, {
      sekG: prev.sekG + sekG,
      sekP: prev.sekP + sekP,
      goldG: prev.goldG + goldG,
      goldP: prev.goldP + goldP,
      guide: prev.guide + g,
      people: prev.people + p,
    });
  }

  const staffTotals = [...m.entries()]
    .map(([staff_name, t]) => ({
      staff_name,
      sekGroups: t.sekG,
      sekPeople: t.sekP,
      goldGroups: t.goldG,
      goldPeople: t.goldP,
      guideTotal: t.guide,
      peopleTotal: t.people,
    }))
    .sort((a, b) => b.guideTotal - a.guideTotal || a.staff_name.localeCompare(b.staff_name, "ja"));

  return {
    totalGuides,
    totalPeople,
    totalSekGroups,
    totalSekPeople,
    totalGoldGroups,
    totalGoldPeople,
    staffTotals,
  };
}
