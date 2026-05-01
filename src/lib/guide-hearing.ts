import type { SupabaseClient } from "@supabase/supabase-js";
import type { LineReplyMessage, LineTextQuickReplyItem } from "@/lib/line-reply";
import { isDailyGuideResultsMissingSekGoldColumns } from "@/lib/daily-guide-results-compat";

export type GuideHearingStoreRow = {
  id: string;
  name: string | null;
  guide_hearing_enabled: boolean;
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

/** 従業員選択後: セクキャバから入力するか、セクキャバ0で GOLD のみか */
export function buildGuideEntryModeSelectItems(staffName: string): LineTextQuickReplyItem[] {
  const enc = encodeURIComponent(staffName);
  return [
    {
      type: "action",
      action: {
        type: "postback",
        label: "セクキャバから入力",
        data: `action=start_guide_entry&staff_name=${enc}&mode=sek_first`,
        displayText: "セクキャバから入力",
      },
    },
    {
      type: "action",
      action: {
        type: "postback",
        label: "GOLDのみ",
        data: `action=start_guide_entry&staff_name=${enc}&mode=gold_only`,
        displayText: "GOLDのみ",
      },
    },
  ];
}

export function buildGuideEntryModeMessage(staffName: string): LineReplyMessage {
  return {
    type: "text",
    text:
      `【${staffName}さん】セクキャバと GOLD の案内を入力します。\n` +
      "まず、セクキャバから組数・人数を入力するか、セクキャバがない場合は「GOLDのみ」を選んでください。",
    quickReply: {
      items: buildGuideEntryModeSelectItems(staffName),
    },
  };
}

export function buildGuideSekCountSelectMessage(staffName: string): LineReplyMessage {
  const enc = encodeURIComponent(staffName);
  const items: LineTextQuickReplyItem[] = [];
  for (let i = 0; i <= MAX_GROUP_QUICK; i++) {
    items.push({
      type: "action",
      action: {
        type: "postback",
        label: `${i}組数`,
        data: `action=submit_guide_sek_count&staff_name=${enc}&sek=${i}`,
        displayText: `${i}組数`,
      },
    });
  }
  return {
    type: "text",
    text: `【${staffName}さん】セクキャバの組数を選んでください。`,
    quickReply: { items },
  };
}

export function buildGuideSekPeopleSelectMessage(staffName: string, sekCount: number): LineReplyMessage {
  const enc = encodeURIComponent(staffName);
  const items: LineTextQuickReplyItem[] = [];
  for (let i = 0; i <= MAX_PEOPLE_QUICK; i++) {
    items.push({
      type: "action",
      action: {
        type: "postback",
        label: `${i}人数`,
        data:
          `action=submit_guide_sek_people&staff_name=${enc}` +
          `&sek=${sekCount}&sek_p=${i}`,
        displayText: `${i}人数`,
      },
    });
  }
  return {
    type: "text",
    text: `【${staffName}さん】セクキャバの人数を選んでください（セクキャバ ${sekCount}組数）。`,
    quickReply: { items },
  };
}

export function buildGuideGoldCountSelectMessage(params: {
  staffName: string;
  sekCount: number;
  sekPeopleCount: number;
}): LineReplyMessage {
  const enc = encodeURIComponent(params.staffName);
  const items: LineTextQuickReplyItem[] = [];
  for (let i = 0; i <= MAX_GROUP_QUICK; i++) {
    items.push({
      type: "action",
      action: {
        type: "postback",
        label: `${i}組数`,
        data:
          `action=submit_guide_gold_count&staff_name=${enc}` +
          `&sek=${params.sekCount}&sek_p=${params.sekPeopleCount}&gold=${i}`,
        displayText: `${i}組数`,
      },
    });
  }
  return {
    type: "text",
    text: `【${params.staffName}さん】GOLD の組数を選んでください。`,
    quickReply: { items },
  };
}

export function buildGuideGoldPeopleSelectMessage(params: {
  staffName: string;
  sekCount: number;
  sekPeopleCount: number;
  goldCount: number;
}): LineReplyMessage {
  const enc = encodeURIComponent(params.staffName);
  const items: LineTextQuickReplyItem[] = [];
  for (let i = 0; i <= MAX_PEOPLE_QUICK; i++) {
    items.push({
      type: "action",
      action: {
        type: "postback",
        label: `${i}人数`,
        data:
          `action=submit_guide_gold_people&staff_name=${enc}` +
          `&sek=${params.sekCount}&sek_p=${params.sekPeopleCount}` +
          `&gold=${params.goldCount}&gold_p=${i}`,
        displayText: `${i}人数`,
      },
    });
  }
  return {
    type: "text",
    text: `【${params.staffName}さん】GOLD の人数を選んでください（GOLD ${params.goldCount}組数）。`,
    quickReply: { items },
  };
}

/** @deprecated Webhook は sek/gold フローを使用 */
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
  sekGuideCount: number;
  sekPeopleCount: number;
  goldGuideCount: number;
  goldPeopleCount: number;
  respondedAtIso?: string;
}): Promise<void> {
  const respondedAtIso = params.respondedAtIso ?? new Date().toISOString();
  const targetDate = resolveBusinessDateFromJst(new Date(respondedAtIso));
  const guideCount = params.sekGuideCount + params.goldGuideCount;
  const peopleCount = params.sekPeopleCount + params.goldPeopleCount;
  const conflictOpts = { onConflict: "store_id,staff_name,target_date" as const };
  let { error } = await params.supabase.from("daily_guide_results").upsert(
    {
      store_id: params.storeId,
      staff_name: params.staffName,
      target_date: targetDate,
      sek_guide_count: params.sekGuideCount,
      sek_people_count: params.sekPeopleCount,
      gold_guide_count: params.goldGuideCount,
      gold_people_count: params.goldPeopleCount,
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
    throw new Error(`daily_guide_results upsert failed: ${error.message}`);
  }
}
