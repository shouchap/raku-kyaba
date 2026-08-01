import type { SupabaseClient } from "@supabase/supabase-js";
import type { LineReplyMessage, LineTextQuickReplyItem } from "@/lib/line-reply";
import { isDailyGuideResultsMissingSekGoldColumns } from "@/lib/daily-guide-results-compat";
import {
  GUIDE_VENUES,
  appendGuideVenueCountsToParams,
  emptyGuideVenueCounts,
  formatGuideVenueCountsSummary,
  getGuideVenue,
  guideVenueCountsToDbColumns,
  isGuideVenueId,
  parseGuideVenueCountsFromParams,
  sumGuideVenueCounts,
  type GuideVenueCounts,
  type GuideVenueId,
} from "@/lib/guide-venues";

export type GuideHearingStoreRow = {
  id: string;
  name: string | null;
  guide_hearing_enabled: boolean;
  guidance_request_time?: string | null;
  guide_hearing_time: string | null;
  line_channel_access_token: string | null;
  last_guide_hearing_sent_date: string | null;
};

export type GuideStaffRow = {
  id: string;
  store_id: string;
  name: string;
  line_user_id: string | null;
  is_guide_target: boolean;
};

/** @deprecated スタッフ選択フローへ移行済み。互換のため残す */
export type GuidePostbackParseResult = { kind: "count"; count: number } | null;

export type GuideActionParseResult =
  | { kind: "select_staff"; staffName: string }
  | { kind: "select_venue"; staffName: string; venueId: GuideVenueId; counts: GuideVenueCounts }
  | {
      kind: "submit_venue_groups";
      staffName: string;
      venueId: GuideVenueId;
      groups: number;
      counts: GuideVenueCounts;
    }
  | {
      kind: "submit_venue_people";
      staffName: string;
      venueId: GuideVenueId;
      groups: number;
      people: number;
      counts: GuideVenueCounts;
    }
  | { kind: "finish"; staffName: string; counts: GuideVenueCounts }
  /** 旧フロー互換（移行期間） */
  | { kind: "start_entry"; staffName: string; mode: "sek_first" | "gold_only" }
  | { kind: "submit_sek_count"; staffName: string; sekCount: number }
  | {
      kind: "submit_sek_people";
      staffName: string;
      sekCount: number;
      sekPeopleCount: number;
    }
  | {
      kind: "submit_gold_count";
      staffName: string;
      sekCount: number;
      sekPeopleCount: number;
      goldCount: number;
    }
  | {
      kind: "submit_gold_people";
      staffName: string;
      sekCount: number;
      sekPeopleCount: number;
      goldCount: number;
      goldPeopleCount: number;
    }
  | null;

const MAX_GROUP_QUICK = 10;
const MAX_PEOPLE_QUICK = 12;

function jstDateParts(base: Date): { yyyy: number; mm: number; dd: number; hour: number } {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(base);
  const get = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((p) => p.type === type)?.value ?? "00";
  return {
    yyyy: Number(get("year")),
    mm: Number(get("month")),
    dd: Number(get("day")),
    hour: Number(get("hour")),
  };
}

export function resolveBusinessDateFromJst(now: Date = new Date()): string {
  const p = jstDateParts(now);
  const d = new Date(Date.UTC(p.yyyy, p.mm - 1, p.dd));
  if (p.hour < 6) {
    d.setUTCDate(d.getUTCDate() - 1);
  }
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function getCurrentHourJst(now: Date = new Date()): number {
  return jstDateParts(now).hour;
}

/**
 * 案内ヒアリング時刻を `HH:00`（00:00〜23:00・正時）へ正規化。
 * `14:00` / `14:00:00`（DBの time 文字列）/ `9:00` / 前後の空白を許容。解釈不能なら null。
 */
export function canonicalGuideHearingTime(value: string | null | undefined): string | null {
  const s = String(value ?? "").trim();
  if (!s) return null;
  const m = s.match(/^([01]?\d|2[0-3]):([0-5]\d)/);
  if (!m) return null;
  const h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  if (!Number.isFinite(h) || h < 0 || h > 23 || !Number.isFinite(min) || min < 0 || min > 59) {
    return null;
  }
  return `${String(h).padStart(2, "0")}:00`;
}

export function parseGuideHearingHour(time: string | null | undefined): number | null {
  const c = canonicalGuideHearingTime(time);
  if (!c) return null;
  return Number(c.slice(0, 2));
}

/**
 * Cron / 設定表示用: `guidance_request_time`（DB time）を優先し、未設定時は `guide_hearing_time`（レガシー text）を使う。
 * 戻り値は常に `HH:00` または null。
 */
export function resolveGuideHearingScheduleSlot(
  guidanceRequestTime: string | null | undefined,
  guideHearingTimeLegacy: string | null | undefined
): string | null {
  const g =
    guidanceRequestTime != null && String(guidanceRequestTime).trim() !== ""
      ? String(guidanceRequestTime).trim()
      : null;
  const legacy =
    typeof guideHearingTimeLegacy === "string" && guideHearingTimeLegacy.trim() !== ""
      ? guideHearingTimeLegacy.trim()
      : null;
  if (g) {
    const primary = canonicalGuideHearingTime(g);
    if (primary) return primary;
  }
  return canonicalGuideHearingTime(legacy);
}

/** @deprecated */
export function buildGuideQuickReplyItems(): LineTextQuickReplyItem[] {
  const items: LineTextQuickReplyItem[] = [];
  for (let i = 0; i <= MAX_GROUP_QUICK; i++) {
    items.push({
      type: "action",
      action: {
        type: "postback",
        label: `${i}組`,
        data: `action=guide_count&count=${i}`,
        displayText: `${i}組`,
      },
    });
  }
  return items;
}

/** @deprecated */
export function buildGuideHearingMessage(storeName?: string | null): LineReplyMessage {
  const storeLabel = storeName?.trim() ? `（${storeName.trim()}）` : "";
  return {
    type: "text",
    text:
      `本日の案内組数を教えてください${storeLabel}。\n` +
      "下のボタンから選択してください。",
    quickReply: {
      items: buildGuideQuickReplyItems(),
    },
  };
}

export function buildGuideTargetSelectItems(staffNames: string[]): LineTextQuickReplyItem[] {
  return staffNames.slice(0, 13).map((name) => ({
    type: "action",
    action: {
      type: "postback",
      label: name,
      data: `action=select_guide_staff&staff_name=${encodeURIComponent(name)}`,
      displayText: name,
    },
  }));
}

export function buildGuideTargetSelectMessage(params: {
  storeName?: string | null;
  staffNames: string[];
}): LineReplyMessage {
  const storeLabel = params.storeName?.trim() ? `（${params.storeName.trim()}）` : "";
  return {
    type: "text",
    text: `案内数の入力対象を選んでください${storeLabel}。`,
    quickReply: {
      items: buildGuideTargetSelectItems(params.staffNames),
    },
  };
}

function draftParams(staffName: string, counts: GuideVenueCounts): URLSearchParams {
  const p = new URLSearchParams();
  p.set("staff_name", staffName);
  appendGuideVenueCountsToParams(p, counts);
  return p;
}

/** 業態選択メニュー（入力中の下書きを表示） */
export function buildGuideVenueMenuMessage(params: {
  staffName: string;
  counts?: GuideVenueCounts;
}): LineReplyMessage {
  const counts = params.counts ?? emptyGuideVenueCounts();
  const base = draftParams(params.staffName, counts);
  const items: LineTextQuickReplyItem[] = GUIDE_VENUES.map((v) => {
    const p = new URLSearchParams(base);
    p.set("action", "select_guide_venue");
    p.set("venue", v.id);
    const cur = counts[v.id];
    const suffix = cur.groups > 0 || cur.people > 0 ? `(${cur.groups}/${cur.people})` : "";
    const label = `${v.shortLabel}${suffix}`.slice(0, 20);
    return {
      type: "action",
      action: {
        type: "postback",
        label,
        data: p.toString(),
        displayText: v.label,
      },
    };
  });
  {
    const p = new URLSearchParams(base);
    p.set("action", "finish_guide_entry");
    items.push({
      type: "action",
      action: {
        type: "postback",
        label: "入力完了",
        data: p.toString(),
        displayText: "入力完了",
      },
    });
  }
  const summary = formatGuideVenueCountsSummary(counts);
  return {
    type: "text",
    text:
      `【${params.staffName}さん】案内先の業態を選んでください。\n` +
      `入力済: ${summary}\n` +
      "業態ごとに組数・人数を入力し、最後に「入力完了」を押してください。",
    quickReply: { items },
  };
}

/** @deprecated 旧エントリ。新フローでは業態メニューへ誘導 */
export function buildGuideEntryModeMessage(staffName: string): LineReplyMessage {
  return buildGuideVenueMenuMessage({ staffName });
}

export function buildGuideVenueGroupsSelectMessage(params: {
  staffName: string;
  venueId: GuideVenueId;
  counts: GuideVenueCounts;
}): LineReplyMessage {
  const venue = getGuideVenue(params.venueId);
  const items: LineTextQuickReplyItem[] = [];
  for (let i = 0; i <= MAX_GROUP_QUICK; i++) {
    const p = draftParams(params.staffName, params.counts);
    p.set("action", "submit_guide_venue_groups");
    p.set("venue", params.venueId);
    p.set("n", String(i));
    items.push({
      type: "action",
      action: {
        type: "postback",
        label: `${i}組数`,
        data: p.toString(),
        displayText: `${venue.label} ${i}組数`,
      },
    });
  }
  return {
    type: "text",
    text: `【${params.staffName}さん】${venue.label}の組数を選んでください。`,
    quickReply: { items },
  };
}

export function buildGuideVenuePeopleSelectMessage(params: {
  staffName: string;
  venueId: GuideVenueId;
  groups: number;
  counts: GuideVenueCounts;
}): LineReplyMessage {
  const venue = getGuideVenue(params.venueId);
  const items: LineTextQuickReplyItem[] = [];
  for (let i = 0; i <= MAX_PEOPLE_QUICK; i++) {
    const p = draftParams(params.staffName, params.counts);
    p.set("action", "submit_guide_venue_people");
    p.set("venue", params.venueId);
    p.set("n", String(params.groups));
    p.set("p", String(i));
    items.push({
      type: "action",
      action: {
        type: "postback",
        label: `${i}人数`,
        data: p.toString(),
        displayText: `${venue.label} ${i}人数`,
      },
    });
  }
  return {
    type: "text",
    text: `【${params.staffName}さん】${venue.label}の人数を選んでください（${venue.label} ${params.groups}組数）。`,
    quickReply: { items },
  };
}

/** @deprecated */
export function buildGuideSekCountSelectMessage(staffName: string): LineReplyMessage {
  return buildGuideVenueGroupsSelectMessage({
    staffName,
    venueId: "sek",
    counts: emptyGuideVenueCounts(),
  });
}

/** @deprecated */
export function buildGuideSekPeopleSelectMessage(staffName: string, sekCount: number): LineReplyMessage {
  return buildGuideVenuePeopleSelectMessage({
    staffName,
    venueId: "sek",
    groups: sekCount,
    counts: emptyGuideVenueCounts(),
  });
}

/** @deprecated */
export function buildGuideGoldCountSelectMessage(params: {
  staffName: string;
  sekCount: number;
  sekPeopleCount: number;
}): LineReplyMessage {
  const counts = emptyGuideVenueCounts();
  counts.sek = { groups: params.sekCount, people: params.sekPeopleCount };
  return buildGuideVenueGroupsSelectMessage({
    staffName: params.staffName,
    venueId: "gold",
    counts,
  });
}

/** @deprecated */
export function buildGuideGoldPeopleSelectMessage(params: {
  staffName: string;
  sekCount: number;
  sekPeopleCount: number;
  goldCount: number;
}): LineReplyMessage {
  const counts = emptyGuideVenueCounts();
  counts.sek = { groups: params.sekCount, people: params.sekPeopleCount };
  return buildGuideVenuePeopleSelectMessage({
    staffName: params.staffName,
    venueId: "gold",
    groups: params.goldCount,
    counts,
  });
}

/** @deprecated Webhook は venue フローを使用 */
export function parseGuidePostbackData(rawData: string): GuidePostbackParseResult {
  const params = new URLSearchParams(rawData.trim());
  if (params.get("action") !== "guide_count") return null;
  const n = Number(params.get("count"));
  if (!Number.isInteger(n) || n < 0 || n > MAX_GROUP_QUICK) return null;
  return { kind: "count", count: n };
}

function parseNonNegInt(v: string | null, max: number): number | null {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0 || n > max) return null;
  return n;
}

export function parseGuideActionPostbackData(rawData: string): GuideActionParseResult {
  const params = new URLSearchParams(rawData.trim());
  const action = params.get("action");
  const staffName = params.get("staff_name")?.trim() ?? "";
  if (!staffName) return null;

  if (action === "select_guide_staff") {
    return { kind: "select_staff", staffName };
  }

  if (action === "select_guide_venue") {
    const venueId = params.get("venue");
    if (!isGuideVenueId(venueId)) return null;
    const counts = parseGuideVenueCountsFromParams(params, Math.max(MAX_GROUP_QUICK, MAX_PEOPLE_QUICK));
    if (!counts) return null;
    return { kind: "select_venue", staffName, venueId, counts };
  }

  if (action === "submit_guide_venue_groups") {
    const venueId = params.get("venue");
    if (!isGuideVenueId(venueId)) return null;
    const groups = parseNonNegInt(params.get("n"), MAX_GROUP_QUICK);
    const counts = parseGuideVenueCountsFromParams(params, Math.max(MAX_GROUP_QUICK, MAX_PEOPLE_QUICK));
    if (groups === null || !counts) return null;
    return { kind: "submit_venue_groups", staffName, venueId, groups, counts };
  }

  if (action === "submit_guide_venue_people") {
    const venueId = params.get("venue");
    if (!isGuideVenueId(venueId)) return null;
    const groups = parseNonNegInt(params.get("n"), MAX_GROUP_QUICK);
    const people = parseNonNegInt(params.get("p"), MAX_PEOPLE_QUICK);
    const counts = parseGuideVenueCountsFromParams(params, Math.max(MAX_GROUP_QUICK, MAX_PEOPLE_QUICK));
    if (groups === null || people === null || !counts) return null;
    return { kind: "submit_venue_people", staffName, venueId, groups, people, counts };
  }

  if (action === "finish_guide_entry") {
    const counts = parseGuideVenueCountsFromParams(params, Math.max(MAX_GROUP_QUICK, MAX_PEOPLE_QUICK));
    if (!counts) return null;
    return { kind: "finish", staffName, counts };
  }

  // --- 旧フロー互換 ---
  if (action === "start_guide_entry") {
    const mode = params.get("mode");
    if (mode === "sek_first") return { kind: "start_entry", staffName, mode: "sek_first" };
    if (mode === "gold_only") return { kind: "start_entry", staffName, mode: "gold_only" };
    return null;
  }

  if (action === "submit_guide_sek_count") {
    const sek = parseNonNegInt(params.get("sek"), MAX_GROUP_QUICK);
    if (sek === null) return null;
    return { kind: "submit_sek_count", staffName, sekCount: sek };
  }

  if (action === "submit_guide_sek_people") {
    const sek = parseNonNegInt(params.get("sek"), MAX_GROUP_QUICK);
    const sekP = parseNonNegInt(params.get("sek_p"), MAX_PEOPLE_QUICK);
    if (sek === null || sekP === null) return null;
    return { kind: "submit_sek_people", staffName, sekCount: sek, sekPeopleCount: sekP };
  }

  if (action === "submit_guide_gold_count") {
    const sek = parseNonNegInt(params.get("sek"), MAX_GROUP_QUICK);
    const sekP = parseNonNegInt(params.get("sek_p"), MAX_PEOPLE_QUICK);
    const gold = parseNonNegInt(params.get("gold"), MAX_GROUP_QUICK);
    if (sek === null || sekP === null || gold === null) return null;
    return {
      kind: "submit_gold_count",
      staffName,
      sekCount: sek,
      sekPeopleCount: sekP,
      goldCount: gold,
    };
  }

  if (action === "submit_guide_gold_people") {
    const sek = parseNonNegInt(params.get("sek"), MAX_GROUP_QUICK);
    const sekP = parseNonNegInt(params.get("sek_p"), MAX_PEOPLE_QUICK);
    const gold = parseNonNegInt(params.get("gold"), MAX_GROUP_QUICK);
    const goldP = parseNonNegInt(params.get("gold_p"), MAX_PEOPLE_QUICK);
    if (sek === null || sekP === null || gold === null || goldP === null) return null;
    return {
      kind: "submit_gold_people",
      staffName,
      sekCount: sek,
      sekPeopleCount: sekP,
      goldCount: gold,
      goldPeopleCount: goldP,
    };
  }

  return null;
}

export async function upsertGuideResult(params: {
  supabase: SupabaseClient;
  storeId: string;
  staffName: string;
  counts: GuideVenueCounts;
  /** @deprecated 旧引数。counts 未指定時のみ使用 */
  sekGuideCount?: number;
  sekPeopleCount?: number;
  goldGuideCount?: number;
  goldPeopleCount?: number;
  respondedAtIso?: string;
}): Promise<void> {
  const respondedAtIso = params.respondedAtIso ?? new Date().toISOString();
  const targetDate = resolveBusinessDateFromJst(new Date(respondedAtIso));
  const counts =
    params.counts ??
    (() => {
      const c = emptyGuideVenueCounts();
      c.sek = {
        groups: params.sekGuideCount ?? 0,
        people: params.sekPeopleCount ?? 0,
      };
      c.gold = {
        groups: params.goldGuideCount ?? 0,
        people: params.goldPeopleCount ?? 0,
      };
      return c;
    })();
  const { guideCount, peopleCount } = sumGuideVenueCounts(counts);
  const venueCols = guideVenueCountsToDbColumns(counts);
  const conflictOpts = { onConflict: "store_id,staff_name,target_date" as const };
  let { error } = await params.supabase.from("daily_guide_results").upsert(
    {
      store_id: params.storeId,
      staff_name: params.staffName,
      target_date: targetDate,
      ...venueCols,
      guide_count: guideCount,
      people_count: peopleCount,
      responded_at: respondedAtIso,
    },
    conflictOpts
  );
  if (error && isDailyGuideResultsMissingSekGoldColumns(error.message)) {
    ({ error } = await params.supabase.from("daily_guide_results").upsert(
      {
        store_id: params.storeId,
        staff_name: params.staffName,
        target_date: targetDate,
        guide_count: guideCount,
        people_count: peopleCount,
        responded_at: respondedAtIso,
      },
      conflictOpts
    ));
  }
  if (error) {
    // 新カラム未適用時は sek/gold のみで再試行
    if (
      error.message.includes("lounge_") ||
      error.message.includes("girls_bar_") ||
      error.message.includes("concecafe_") ||
      error.message.includes("philippine_pub_")
    ) {
      ({ error } = await params.supabase.from("daily_guide_results").upsert(
        {
          store_id: params.storeId,
          staff_name: params.staffName,
          target_date: targetDate,
          sek_guide_count: counts.sek.groups,
          sek_people_count: counts.sek.people,
          gold_guide_count: counts.gold.groups,
          gold_people_count: counts.gold.people,
          guide_count: guideCount,
          people_count: peopleCount,
          responded_at: respondedAtIso,
        },
        conflictOpts
      ));
    }
  }
  if (error) {
    throw new Error(`daily_guide_results upsert failed: ${error.message}`);
  }
}
