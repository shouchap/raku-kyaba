/**
 * 営業前サマリー（LINE プレーンテキスト）のレイアウト・整形ヘルパー
 */

/** 見出し直下の区切り（視認性重視） */
export const RULE_THICK = "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━";

/**
 * 予約詳細など複数行テキストを行配列に分割（空行は除去）
 */
export function splitDetailLines(text: string): string[] {
  return String(text)
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * 複数行の本文を折り返し表示用に整形する（長い1行は maxChars 付近で分割）。
 */
export function wrapAndIndentLines(
  raw: string,
  options: { prefix: string; maxChars?: number } = { prefix: "" }
): string[] {
  const { prefix, maxChars = 34 } = options;
  const lines = splitDetailLines(raw);
  if (lines.length === 0) return [];

  const out: string[] = [];
  for (const segment of lines) {
    if (segment.length <= maxChars) {
      out.push(prefix + segment);
      continue;
    }
    let rest = segment;
    while (rest.length > 0) {
      if (rest.length <= maxChars) {
        out.push(prefix + rest);
        break;
      }
      let cut = rest.lastIndexOf(" ", maxChars);
      if (cut < maxChars * 0.4) cut = maxChars;
      const chunk = rest.slice(0, cut).trim();
      rest = rest.slice(cut).trim();
      if (chunk) out.push(prefix + chunk);
    }
  }
  return out;
}

export type ReservationFields = {
  pending_line_flow: string | null;
  has_reservation: boolean | null;
  reservation_details: string | null;
};

/**
 * 1 キャスト分の「予約・来客」サブ行（名前行の直下に並べる・絵文字なし）
 */
export function formatReservationSubLines(row: ReservationFields): string[] {
  const flow = row.pending_line_flow?.trim() ?? "";
  if (flow === "reservation_ask") {
    return ["予約：回答待ち"];
  }
  if (flow === "reservation_group_count") {
    return ["予約：組数選択待ち"];
  }
  if (flow === "reservation_time") {
    return ["予約：来店時間選択待ち"];
  }
  if (flow === "reservation_guests") {
    return ["予約：人数選択待ち"];
  }
  if (flow === "reservation_detail") {
    return ["予約：来店時間選択待ち（移行）"];
  }
  if (flow) {
    return ["予約：確認中"];
  }
  if (row.has_reservation === true) {
    const d = (row.reservation_details ?? "").trim();
    if (d) {
      return wrapAndIndentLines(d, { prefix: "" });
    }
    return ["（詳細あり・未入力）"];
  }
  /** has_reservation が false / null: 予約サブ行なし（false 時も「予約なし」は出さず、名前行＋出勤時刻のみ） */
  return [];
}

/**
 * 遅刻理由・各種お休み理由など、複数行になり得るテキストをサブ行化（絵文字なし）
 */
export function formatReasonSubLines(label: string, reason: string): string[] {
  const t = reason.trim();
  if (!t) return [];
  const lines = splitDetailLines(t);
  if (lines.length === 1) {
    return [`${label}：${lines[0]}`];
  }
  const head: string[] = [label];
  for (const line of lines) {
    head.push(line);
  }
  return head;
}
