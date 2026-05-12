/**
 * 15分刻みの時刻オプション。
 * 昼開始の業態（風俗等）と深夜営業の両方をカバーするため、同日 09:00〜23:45 のあと 翌日相当として 00:00〜05:45 を続ける。
 * 空文字は休み用。
 */
const START_HOUR = 9; // 09:00〜（キャバクラ昼準備・昼業態など）
const END_HOUR = 6; // 深夜側の終端〜翌05:45（6時未満の時間帯まで）

function generateTimeOptions(): Array<{ value: string; label: string }> {
  const options: Array<{ value: string; label: string }> = [{ value: "", label: "—" }];
  // 09:00〜23:45
  for (let h = START_HOUR; h < 24; h++) {
    for (let m = 0; m < 60; m += 15) {
      const value = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
      options.push({ value, label: value });
    }
  }
  // 00:00〜05:45（日をまたぐ深夜シフト）
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
  let key = `${hh}:${mm}`;
  // DB の日跨ぎ終端は 24:00:00 となることがあるが、プルダウンは翌日側 00:00〜
  if (key === "24:00") key = "00:00";
  return SHIFT_TIME_VALUE_SET.has(key) ? key : "";
}

/** 単日登録用（必須選択、空オプションなし） */
export const TIME_OPTIONS_REQUIRED = TIME_OPTIONS.filter((opt) => opt.value !== "");
