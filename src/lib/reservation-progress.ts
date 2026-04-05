/**
 * 予約（来客）ヒアリングの進行状態（reservation_details に JSON で保存）
 */

export const RESERVATION_JSON_VERSION = 2 as const;

/** 人数ボタン値（4 = 4名以上） */
export type ReservationGuestButton = 1 | 2 | 3 | 4;

export type ReservationRecordEntry = {
  /** null = 来店時間「未定」 */
  time: string | null;
  guests: ReservationGuestButton;
  /** BAR: 組ごとのお客様名（任意） */
  guest_name?: string | null;
};

export type ReservationProgressV2 = {
  v: typeof RESERVATION_JSON_VERSION;
  total_groups: number;
  /** 1 始まり。主に表示・デバッグ用（論理は records / total_groups で整合） */
  current_group: number;
  records: ReservationRecordEntry[];
  /** 現在の組で時間まで確定し、人数待ちのとき */
  pending_time?: string;
  /** Datetimepicker の代わりに「未定」選択済み（人数待ち） */
  pending_time_unknown?: boolean;
  /** BAR: 来店時間前に聞いたお客様名（組数分そろうまで）。時間・人数ループ中も参照 */
  guest_names?: string[];
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
        const row = r as { time?: unknown; guests?: unknown; guest_name?: unknown };
        const g = typeof row.guests === "number" ? row.guests : Number(row.guests);
        if (!isGuestButton(g)) continue;
        const gn =
          typeof row.guest_name === "string" && row.guest_name.trim()
            ? row.guest_name.trim()
            : null;
        if (row.time === null) {
          records.push({ time: null, guests: g, guest_name: gn });
          continue;
        }
        const hm = normalizeHm(typeof row.time === "string" ? row.time : null);
        if (!hm) continue;
        records.push({ time: hm, guests: g, guest_name: gn });
      }
      const pendingUnknown = o.pending_time_unknown === true;
      const pending =
        typeof o.pending_time === "string" ? normalizeHm(o.pending_time) : undefined;

      let guest_names: string[] | undefined;
      if (Array.isArray(o.guest_names)) {
        guest_names = o.guest_names
          .map((x) => (typeof x === "string" ? x.trim() : ""))
          .filter((s) => s.length > 0);
        if (guest_names.length === 0) guest_names = undefined;
      }

      return {
        v: RESERVATION_JSON_VERSION,
        total_groups: total,
        current_group: cur,
        records,
        pending_time: pendingUnknown ? undefined : (pending ?? undefined),
        pending_time_unknown: pendingUnknown ? true : undefined,
        guest_names,
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

const MAX_GROUPS_EXTRACT = 100;

/**
 * `reservation_details` から申告された予定組数を 1 行分だけ抽出（営業前サマリー合算用）。
 * 厳密な `parseReservationProgress` が失敗する途中状態でも、`total_groups` 等があれば拾う。
 */
export function extractDeclaredGroupCountFromReservationDetails(
  raw: string | null | undefined
): number {
  const s = String(raw ?? "").trim();
  if (!s) return 0;

  if (s.startsWith("{")) {
    try {
      const o = JSON.parse(s) as Record<string, unknown>;

      const tg = o.total_groups;
      if (typeof tg === "number" && Number.isFinite(tg) && tg >= 1) {
        return Math.min(Math.floor(tg), MAX_GROUPS_EXTRACT);
      }

      const gc = o.group_count;
      if (typeof gc === "number" && gc >= 1) {
        return Math.min(Math.floor(gc), MAX_GROUPS_EXTRACT);
      }
      if (typeof gc === "string" && /^\d+$/.test(gc)) {
        const n = parseInt(gc, 10);
        if (n >= 1) return Math.min(n, MAX_GROUPS_EXTRACT);
      }

      const gn = o.guest_names;
      if (Array.isArray(gn)) {
        const n = gn.filter((x) => typeof x === "string" && String(x).trim().length > 0).length;
        if (n >= 1) return Math.min(n, MAX_GROUPS_EXTRACT);
      }

      const recs = o.records;
      if (Array.isArray(recs) && recs.length >= 1) {
        return Math.min(recs.length, MAX_GROUPS_EXTRACT);
      }
    } catch {
      return 0;
    }
    return 0;
  }

  const compact = s.replace(/\s+/g, " ").trim();
  const barOnly = compact.match(/(\d{1,3})\s*組の来客予定/);
  if (barOnly) {
    const n = parseInt(barOnly[1], 10);
    if (n >= 1) return Math.min(n, MAX_GROUPS_EXTRACT);
  }

  const groupHeadings = compact.match(/\d+\s*組目/g);
  if (groupHeadings && groupHeadings.length > 0) {
    return Math.min(groupHeadings.length, MAX_GROUPS_EXTRACT);
  }

  const loose = compact.match(/(\d{1,3})\s*組(?!目)/);
  if (loose) {
    const n = parseInt(loose[1], 10);
    if (n >= 1) return Math.min(n, MAX_GROUPS_EXTRACT);
  }

  return 0;
}

/** 1 組分の文言（時間あり／時間未定・名前付き対応） */
function formatRecordSegment(
  time: string | null,
  guests: ReservationGuestButton,
  guestName?: string | null
): string {
  const namePart = guestName?.trim() ? `${guestName.trim()}様` : null;
  const guestPart =
    time == null || time === ""
      ? `時間未定で${guestLabel(guests)}`
      : `${time}から${guestLabel(guests)}`;
  if (namePart) {
    return `${namePart}（${guestPart}）`;
  }
  return guestPart;
}

/** 管理画面・ログ用の1行テキスト */
export function formatReservationStoredPlainText(p: ReservationProgressV2): string {
  if (p.records.length === 0) return "";
  const allNameOnly = p.records.every(
    (r) => (r.time == null || r.time === "") && r.guest_name?.trim()
  );
  if (allNameOnly && p.records.length > 0) {
    return p.records
      .map((r, i) => `${i + 1}組目: ${r.guest_name?.trim() ?? "—"}様`)
      .join("、");
  }
  if (p.total_groups === 1 && p.records.length === 1) {
    const r = p.records[0];
    return `${formatRecordSegment(r.time, r.guests, r.guest_name)}のご予定`;
  }
  return (
    p.records
      .map(
        (r, i) =>
          `${i + 1}組目: ${formatRecordSegment(r.time, r.guests, r.guest_name)}`
      )
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
  const allNameOnly = p.records.every(
    (r) => (r.time == null || r.time === "") && r.guest_name?.trim()
  );
  if (allNameOnly && p.records.length > 0) {
    const parts = p.records.map(
      (r, i) => `${i + 1}組目: ${r.guest_name?.trim() ?? "—"}様`
    );
    return `${parts.join("、")}の予定を記録しました。ありがとうございます！`;
  }
  if (p.total_groups === 1 && p.records.length === 1) {
    const r = p.records[0];
    return `${formatRecordSegment(r.time, r.guests, r.guest_name)}の予定を記録しました。ありがとうございます！`;
  }
  const parts = p.records.map(
    (r, i) =>
      `${i + 1}組目: ${formatRecordSegment(r.time, r.guests, r.guest_name)}`
  );
  return `${parts.join("、")}の予定を記録しました。ありがとうございます！`;
}

/** 組数のみ確定（BAR・時間も名前も聞かない場合） */
export function formatBarGroupsOnlyMessage(groups: number): string {
  if (groups < 1) return "予定を記録しました。ありがとうございます！";
  return `${groups}組の来客予定を記録しました。ありがとうございます！`;
}

export function formatBarGroupsOnlyStoredPlainText(groups: number): string {
  if (groups < 1) return "";
  return `${groups}組の来客予定`;
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
