import type { SupabaseClient } from "@supabase/supabase-js";
import type { LineReplyMessage, LineTextQuickReplyItem } from "@/lib/line-reply";

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

export type GuidePostbackParseResult = { kind: "count"; count: number } | null;
export type GuideActionParseResult =
  | { kind: "select_staff"; staffName: string }
  | { kind: "submit_count"; staffName: string; count: number }
  | { kind: "submit_people"; staffName: string; count: number; peopleCount: number }
  | null;

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
  // 深夜帯（0〜5時）の回答は前営業日に寄せる
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

export function parseGuideHearingHour(time: string | null | undefined): number | null {
  const m = String(time ?? "").trim().match(/^([01]\d|2[0-3]):00$/);
  if (!m) return null;
  return Number(m[1]);
}

export function buildGuideQuickReplyItems(): LineTextQuickReplyItem[] {
  const items: LineTextQuickReplyItem[] = [];
  for (let i = 0; i <= 10; i++) {
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

export function buildGuideCountSelectItems(
  staffName: string
): LineTextQuickReplyItem[] {
  const items: LineTextQuickReplyItem[] = [];
  for (let i = 0; i <= 10; i++) {
    items.push({
      type: "action",
      action: {
        type: "postback",
        label: `${i}組`,
        data: `action=submit_guide_count&staff_name=${encodeURIComponent(staffName)}&count=${i}`,
        displayText: `${i}組`,
      },
    });
  }
  return items;
}

export function buildGuideCountSelectMessage(staffName: string): LineReplyMessage {
  return {
    type: "text",
    text: `【${staffName}さん】の案内組数を教えてください。`,
    quickReply: {
      items: buildGuideCountSelectItems(staffName),
    },
  };
}

export function buildGuidePeopleSelectItems(
  staffName: string,
  count: number
): LineTextQuickReplyItem[] {
  const items: LineTextQuickReplyItem[] = [];
  // LINE quick reply の上限（13個）を超えないよう 0〜12人に制限
  for (let i = 0; i <= 12; i++) {
    items.push({
      type: "action",
      action: {
        type: "postback",
        label: `${i}人`,
        data:
          `action=submit_guide_people&staff_name=${encodeURIComponent(staffName)}` +
          `&count=${count}&people_count=${i}`,
        displayText: `${i}人`,
      },
    });
  }
  return items;
}

export function buildGuidePeopleSelectMessage(staffName: string, count: number): LineReplyMessage {
  return {
    type: "text",
    text: `【${staffName}さん】の人数を選択してください（案内組数: ${count}組）。`,
    quickReply: {
      items: buildGuidePeopleSelectItems(staffName, count),
    },
  };
}

export function parseGuidePostbackData(rawData: string): GuidePostbackParseResult {
  const params = new URLSearchParams(rawData.trim());
  if (params.get("action") !== "guide_count") return null;
  const n = Number(params.get("count"));
  if (!Number.isInteger(n) || n < 0 || n > 10) return null;
  return { kind: "count", count: n };
}

export function parseGuideActionPostbackData(rawData: string): GuideActionParseResult {
  const params = new URLSearchParams(rawData.trim());
  const action = params.get("action");
  const staffName = params.get("staff_name")?.trim() ?? "";
  if (!staffName) return null;

  if (action === "select_guide_staff") {
    return { kind: "select_staff", staffName };
  }
  if (action === "submit_guide_count") {
    const count = Number(params.get("count"));
    if (!Number.isInteger(count) || count < 0 || count > 10) return null;
    return { kind: "submit_count", staffName, count };
  }
  if (action === "submit_guide_people") {
    const count = Number(params.get("count"));
    const peopleCount = Number(params.get("people_count"));
    if (!Number.isInteger(count) || count < 0 || count > 10) return null;
    if (!Number.isInteger(peopleCount) || peopleCount < 0 || peopleCount > 9999) return null;
    return { kind: "submit_people", staffName, count, peopleCount };
  }
  return null;
}

export async function upsertGuideResult(params: {
  supabase: SupabaseClient;
  storeId: string;
  staffName: string;
  guideCount: number;
  peopleCount?: number;
  respondedAtIso?: string;
}): Promise<void> {
  const respondedAtIso = params.respondedAtIso ?? new Date().toISOString();
  const targetDate = resolveBusinessDateFromJst(new Date(respondedAtIso));
  // 同一スタッフ名・同一営業日の重複回答は、最新ボタン入力で上書きする（押し直し対応）。
  const { error } = await params.supabase.from("daily_guide_results").upsert(
    {
      store_id: params.storeId,
      staff_name: params.staffName,
      target_date: targetDate,
      guide_count: params.guideCount,
      people_count: Number.isInteger(params.peopleCount) ? params.peopleCount : null,
      responded_at: respondedAtIso,
    },
    {
      onConflict: "store_id,staff_name,target_date",
    }
  );
  if (error) {
    throw new Error(`daily_guide_results upsert failed: ${error.message}`);
  }
}
