/**
 * 15分刻みの時刻オプション。営業時間（17:00〜翌05:45）に絞り込み。
 * 空文字は休み用。
 */
const START_HOUR = 17; // 17:00〜
const END_HOUR = 6; // 〜翌05:45（6時は含まない）

function generateTimeOptions(): Array<{ value: string; label: string }> {
  const options: Array<{ value: string; label: string }> = [{ value: "", label: "—" }];
  // 17:00〜23:45
  for (let h = START_HOUR; h < 24; h++) {
    for (let m = 0; m < 60; m += 15) {
      const value = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
      options.push({ value, label: value });
    }
  }
  // 00:00〜05:45
  for (let h = 0; h < END_HOUR; h++) {
    for (let m = 0; m < 60; m += 15) {
      const value = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
      options.push({ value, label: value });
    }
  }
  return options;
}

export const TIME_OPTIONS = generateTimeOptions();

/** 週間シフトで選べる時刻値のみ（空文字除く） */
const SHIFT_TIME_VALUE_SET = new Set(
  TIME_OPTIONS.map((o) => o.value).filter((v) => v.length > 0)
);

export function isAllowedShiftTime(value: string): boolean {
  return SHIFT_TIME_VALUE_SET.has(value);
}

/**
 * DB の time / "HH:mm:ss" / ISO 風 "…T18:30:00…" を週間シフト用の "HH:mm" に正規化（候補に無い場合は空）。
 * 秒以下は無視し、時は2桁ゼロ埋めしてプルダウン value と一致させる。
 */
export function normalizeDbTimeToShiftOption(raw: string | null | undefined): string {
  if (raw == null) return "";
  let s = String(raw).trim();
  if (s === "") return "";

  const tIdx = s.indexOf("T");
  if (tIdx >= 0) {
    s = s.slice(tIdx + 1);
    const zoneIdx = s.search(/[Z+-]/);
    if (zoneIdx >= 0) s = s.slice(0, zoneIdx);
  }
  const dotIdx = s.indexOf(".");
  if (dotIdx >= 0) s = s.slice(0, dotIdx);
  s = s.trim();

  const m = s.match(/^(\d{1,2}):(\d{2})/);
  if (!m) return "";
  const hh = m[1].padStart(2, "0");
  const mm = m[2];
  const key = `${hh}:${mm}`;
  return SHIFT_TIME_VALUE_SET.has(key) ? key : "";
}

/** 単日登録用（必須選択、空オプションなし） */
export const TIME_OPTIONS_REQUIRED = TIME_OPTIONS.filter((opt) => opt.value !== "");
