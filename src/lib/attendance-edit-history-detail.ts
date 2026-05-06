/** 監査ログの old_data / new_data から一覧用の短文サマリーを生成（API・画面共通） */

const TRACKED_FIELDS: { key: string; label: string }[] = [
  { key: "status", label: "ステータス" },
  { key: "planned_groups", label: "確定組数" },
  { key: "tentative_groups", label: "仮予定組数" },
  { key: "action_type", label: "行動種別" },
  { key: "action_detail", label: "行動詳細" },
  { key: "is_sabaki", label: "捌き出勤" },
  { key: "public_holiday_reason", label: "公休理由" },
  { key: "half_holiday_reason", label: "半休理由" },
  { key: "has_reservation", label: "予約の有無" },
  { key: "reservation_details", label: "予約詳細" },
];

const STATUS_LABEL: Record<string, string> = {
  attending: "出勤",
  absent: "欠勤",
  late: "遅刻",
  public_holiday: "公休",
  half_holiday: "半休",
};

function fmtCell(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "boolean") return v ? "はい" : "いいえ";
  if (typeof v === "number") return String(v);
  const s = String(v).trim();
  if (s === "attending") return STATUS_LABEL.attending;
  if (s === "absent") return STATUS_LABEL.absent;
  if (s === "late") return STATUS_LABEL.late;
  if (s === "public_holiday") return STATUS_LABEL.public_holiday;
  if (s === "half_holiday") return STATUS_LABEL.half_holiday;
  return s || "—";
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function summarizeUpdate(oldData: Record<string, unknown>, newData: Record<string, unknown>): string[] {
  const lines: string[] = [];
  for (const { key, label } of TRACKED_FIELDS) {
    const a = oldData[key];
    const b = newData[key];
    const same =
      (a === null || a === undefined) && (b === null || b === undefined)
        ? true
        : JSON.stringify(a) === JSON.stringify(b);
    if (!same) lines.push(`${label}: ${fmtCell(a)}→${fmtCell(b)}`);
  }
  return lines.length > 0 ? lines : ["（変更フィールドなし）"];
}

export function summarizeAttendanceEditHistoryDetail(params: {
  action_type: string;
  old_data: unknown;
  new_data: unknown;
}): string {
  const oldData = asRecord(params.old_data);
  const action = String(params.action_type ?? "").toUpperCase();

  if (action === "DELETE") {
    const snapshot = TRACKED_FIELDS.map(({ key, label }) => `${label}: ${fmtCell(oldData[key])}`);
    return ["削除（削除直前の値）", ...snapshot].join("\n");
  }

  if (action === "INSERT") {
    const newData = asRecord(params.new_data);
    const snapshot = TRACKED_FIELDS.map(({ key, label }) => `${label}: ${fmtCell(newData[key])}`);
    return ["新規作成", ...snapshot].join("\n");
  }

  const newData = asRecord(params.new_data);
  return summarizeUpdate(oldData, newData).join("\n");
}

export function pickCastIdFromHistoryPayload(old_data: unknown, new_data: unknown): string | null {
  const n = asRecord(new_data).cast_id;
  const o = asRecord(old_data).cast_id;
  const id =
    (typeof n === "string" && n.trim()) ||
    (typeof o === "string" && o.trim()) ||
    "";
  return id || null;
}

export function pickAttendedDateFromHistoryPayload(old_data: unknown, new_data: unknown): string | null {
  const n = asRecord(new_data).attended_date;
  const o = asRecord(old_data).attended_date;
  const ymd =
    (typeof n === "string" && n.trim()) ||
    (typeof o === "string" && o.trim()) ||
    "";
  return ymd || null;
}
