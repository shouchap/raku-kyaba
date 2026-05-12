/**
 * シフト用時刻オプション（店舗設定の刻み: 15 分 or 60 分）。
 * 昼開始の業態（風俗等）と深夜営業の両方をカバーするため、同日 09:00〜23:45/23:00 のあと
 * 翌日相当として 00:00〜05:45/05:00 を続ける。
 * 空文字は休み用。
 */
const START_HOUR = 9;
const END_HOUR = 6;

export type ShiftTimeStepMinutes = 15 | 60;

export function parseShiftTimeStepMinutes(raw: unknown): ShiftTimeStepMinutes {
  const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN;
  if (n === 60) return 60;
  return 15;
}

function generateTimeOptions(stepMinutes: ShiftTimeStepMinutes): Array<{ value: string; label: string }> {
  const options: Array<{ value: string; label: string }> = [{ value: "", label: "—" }];
  const step = stepMinutes === 60 ? 60 : 15;
  for (let h = START_HOUR; h < 24; h++) {
    for (let m = 0; m < 60; m += step) {
      const value = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
      options.push({ value, label: value });
    }
  }
  for (let h = 0; h < END_HOUR; h++) {
    for (let m = 0; m < 60; m += step) {
      const value = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
      options.push({ value, label: value });
    }
  }
  return options;
}

const optionsCache = new Map<ShiftTimeStepMinutes, Array<{ value: string; label: string }>>();

export function getTimeOptions(stepMinutes: ShiftTimeStepMinutes): Array<{ value: string; label: string }> {
  let cached = optionsCache.get(stepMinutes);
  if (!cached) {
    cached = generateTimeOptions(stepMinutes);
    optionsCache.set(stepMinutes, cached);
  }
  return cached;
}

/** 週間シフトで選べる時刻値のみ（空文字除く） */
export function getTimeOptionsRequired(stepMinutes: ShiftTimeStepMinutes): Array<{ value: string; label: string }> {
  return getTimeOptions(stepMinutes).filter((o) => o.value !== "");
}

const valueSetCache = new Map<ShiftTimeStepMinutes, ReadonlySet<string>>();

function getShiftTimeValueSet(stepMinutes: ShiftTimeStepMinutes): ReadonlySet<string> {
  let s = valueSetCache.get(stepMinutes);
  if (!s) {
    s = new Set(getTimeOptions(stepMinutes).map((o) => o.value).filter((v) => v.length > 0));
    valueSetCache.set(stepMinutes, s);
  }
  return s;
}

export function isAllowedShiftTime(value: string, stepMinutes: ShiftTimeStepMinutes = 15): boolean {
  const v = String(value ?? "").trim();
  if (!v) return false;
  return getShiftTimeValueSet(stepMinutes).has(v);
}

/**
 * DB の time / "HH:mm:ss" / ISO 風 "…T18:30:00…" を週間シフト用の "HH:mm" に正規化（候補に無い場合は空）。
 * 秒以下は無視し、時は2桁ゼロ埋めしてプルダウン value と一致させる。
 * 60 分刻みのとき、DB が 18:30 等の場合は表示用に時を切り捨てた "18:00" が候補にあればそれを返す。
 */
export function normalizeDbTimeToShiftOption(
  raw: string | null | undefined,
  stepMinutes: ShiftTimeStepMinutes = 15
): string {
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
  if (key === "24:00") key = "00:00";

  const set = getShiftTimeValueSet(stepMinutes);
  if (set.has(key)) return key;

  if (stepMinutes === 60 && mm !== "00") {
    const hourOnly = `${hh}:00`;
    if (set.has(hourOnly)) return hourOnly;
  }

  return "";
}

/** 既定（15 分刻み）。後方互換・テスト用 */
export const TIME_OPTIONS = getTimeOptions(15);

/** @deprecated getTimeOptionsRequired(15) を使うか、店舗の刻みに合わせてください */
export const TIME_OPTIONS_REQUIRED = getTimeOptionsRequired(15);
