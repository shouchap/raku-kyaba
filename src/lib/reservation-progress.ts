/**
 * 予約（来客）ヒアリングの進行状態（reservation_details に JSON で保存）
 */

export const RESERVATION_JSON_VERSION = 2 as const;

/** 人数ボタン値（4 = 4名以上） */
export type ReservationGuestButton = 1 | 2 | 3 | 4;

export type ReservationRecordEntry = {
  time: string;
  guests: ReservationGuestButton;
};

export type ReservationProgressV2 = {
  v: typeof RESERVATION_JSON_VERSION;
  total_groups: number;
  /** 1 始まり。主に表示・デバッグ用（論理は records / total_groups で整合） */
  current_group: number;
  records: ReservationRecordEntry[];
  /** 現在の組で時間まで確定し、人数待ちのとき */
  pending_time?: string;
};

function normalizeHm(time: string | null | undefined): string | null {
  const t = String(time ?? "").trim();
  const m = t.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  if (Number.isNaN(h) || Number.isNaN(min) || h < 0 || h > 23 || min < 0 || min > 59) {
    return null;
  }
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

function isGuestButton(n: number): n is ReservationGuestButton {
  return n === 1 || n === 2 || n === 3 || n === 4;
}

/**
 * DB の reservation_details をパース。v2 または旧 `{ "time": "HH:mm" }`（途中のみ）に対応。
 */
export function parseReservationProgress(
  raw: string | null | undefined
): ReservationProgressV2 | null {
  const s = String(raw ?? "").trim();
  if (!s.startsWith("{")) return null;
  try {
    const o = JSON.parse(s) as Record<string, unknown>;
    if (o.v === RESERVATION_JSON_VERSION) {
      const total = o.total_groups;
      const cur = o.current_group;
      const recs = o.records;
      if (typeof total !== "number" || total < 1 || typeof cur !== "number" || !Array.isArray(recs)) {
        return null;
      }
      const records: ReservationRecordEntry[] = [];
      for (const r of recs) {
        if (!r || typeof r !== "object") continue;
        const row = r as { time?: unknown; guests?: unknown };
        const hm = normalizeHm(typeof row.time === "string" ? row.time : null);
        const g = typeof row.guests === "number" ? row.guests : Number(row.guests);
        if (!hm || !isGuestButton(g)) continue;
        records.push({ time: hm, guests: g });
      }
      const pending =
        typeof o.pending_time === "string" ? normalizeHm(o.pending_time) : undefined;
      return {
        v: RESERVATION_JSON_VERSION,
        total_groups: total,
        current_group: cur,
        records,
        pending_time: pending ?? undefined,
      };
    }
    if (typeof o.time === "string" && o.v === undefined) {
      const hm = normalizeHm(o.time);
      if (!hm) return null;
      return {
        v: RESERVATION_JSON_VERSION,
        total_groups: 1,
        current_group: 1,
        records: [],
        pending_time: hm,
      };
    }
  } catch {
    return null;
  }
  return null;
}

export function serializeReservationProgress(p: ReservationProgressV2): string {
  return JSON.stringify(p);
}

/** 管理画面・ログ用の1行テキスト */
export function formatReservationStoredPlainText(p: ReservationProgressV2): string {
  if (p.records.length === 0) return "";
  if (p.total_groups === 1 && p.records.length === 1) {
    const r = p.records[0];
    return `${r.time}から${guestLabel(r.guests)}のご予定`;
  }
  return (
    p.records
      .map((r, i) => `${i + 1}組目: ${r.time}から${guestLabel(r.guests)}`)
      .join("、") + "のご予定"
  );
}

function guestLabel(guests: ReservationGuestButton): string {
  if (guests === 4) return "4名以上";
  return `${guests}名様`;
}

/** LINE 完了メッセージ */
export function formatReservationCompletionMessage(p: ReservationProgressV2): string {
  if (p.records.length === 0) return "予定を記録しました。ありがとうございます！";
  if (p.total_groups === 1 && p.records.length === 1) {
    const r = p.records[0];
    return `${r.time}から${guestLabel(r.guests)}の予定を記録しました。ありがとうございます！`;
  }
  const parts = p.records.map(
    (r, i) => `${i + 1}組目: ${r.time}から${guestLabel(r.guests)}`
  );
  return `${parts.join("、")}の予定を記録しました。ありがとうございます！`;
}

/** 次に時間を聞く組番号（1 始まり） */
export function nextGroupIndexToFill(p: ReservationProgressV2): number {
  return p.records.length + 1;
}

/** Flex の見出し用（時間・人数の何組目か） */
export function getReservationPromptTargets(
  details: string | null | undefined
): { groupIndex: number; totalGroups: number } {
  const p = parseReservationProgress(details);
  if (!p) {
    return { groupIndex: 1, totalGroups: 1 };
  }
  const idx = nextGroupIndexToFill(p);
  return { groupIndex: idx, totalGroups: Math.max(1, p.total_groups) };
}

export function parseReservationGroupCountFromPostback(raw: string): number | null {
  const s = String(raw ?? "").trim();
  if (!s.includes("reservation_group_select")) return null;
  const m = s.match(/(?:^|&)groups=(\d+)/);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  if (Number.isNaN(n) || n < 1 || n > 20) return null;
  return n;
}
