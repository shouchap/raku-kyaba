/**
 * 日本時間（Asia/Tokyo）における「今日」を YYYY-MM-DD で返す。
 *
 * Vercel 等の UTC 環境では `new Date()` のローカル日付や
 * `toISOString().split("T")[0]`（UTC 日付）を使うと1日ずれるため、
 * Intl の timeZone 指定で組み立てる（ロケール文字列の parse は行わない）。
 */
export function getTodayJst(): string {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);

  const year = parts.find((p) => p.type === "year")?.value;
  const month = parts.find((p) => p.type === "month")?.value;
  const day = parts.find((p) => p.type === "day")?.value;

  if (year && month && day) {
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }

  // 極端なフォールバック（通常は到達しない）
  return now.toLocaleDateString("en-CA", { timeZone: "Asia/Tokyo" });
}

/**
 * JST の暦日 YYYY-MM-DD に日数を加算（日本の日付としての加算）。
 * 正午 JST を基準にしてタイムゾーンずれを避ける。
 */
export function addCalendarDaysJst(ymd: string, delta: number): string {
  const d = new Date(ymd + "T12:00:00+09:00");
  d.setDate(d.getDate() + delta);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * JST の暦日 YYYY-MM-DD における曜日（0=日 … 6=土）。
 * 正午 JST 基準で日付またぎのずれを避ける。
 */
export function getWeekdayJst(ymd: string): number {
  const [y, m, d] = ymd.split("-").map(Number);
  if (!y || !m || !d) return 0;
  const utc = Date.UTC(y, m - 1, d, 3, 0, 0);
  return new Date(utc).getUTCDay();
}

/** 週の開始を月曜とする。その週の月曜日の YYYY-MM-DD（JST） */
export function getMondayOfJstWeek(ymd: string): string {
  const dow = getWeekdayJst(ymd);
  const delta = dow === 0 ? -6 : 1 - dow;
  return addCalendarDaysJst(ymd, delta);
}

/** 月曜始まりの週の日曜日 YYYY-MM-DD（JST） */
export function getSundayOfJstWeekFromMonday(mondayYmd: string): string {
  return addCalendarDaysJst(mondayYmd, 6);
}

/**
 * 日本時間（JST）の現在の「時」（0〜23）を返す
 */
export function getCurrentHourJst(): number {
  const hourStr = new Date().toLocaleString("en-CA", {
    timeZone: "Asia/Tokyo",
    hour: "2-digit",
    hour12: false,
  });
  return parseInt(hourStr, 10) || 0;
}

/**
 * 日本時間（JST）の現在時刻を HH:mm 形式で取得
 * sv-SE ロケールは ISO 風 "HH:mm" を返すため、UTC 環境でも確実に JST を取得できる
 */
export function getCurrentTimeJstString(): string {
  const formatter = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Tokyo",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return formatter.format(new Date());
}

/**
 * 日本時間（JST）の現在の「時」と「分」を返す
 * サーバーのデフォルトタイムゾーン（UTC）の影響を受けない
 */
export function getCurrentTimeJst(): { hour: number; minute: number } {
  const timeStr = getCurrentTimeJstString();
  const match = timeStr.match(/^(\d{1,2}):(\d{2})/);
  const hour = match ? parseInt(match[1], 10) : 0;
  const minute = match ? parseInt(match[2], 10) : 0;
  return { hour: Math.min(23, Math.max(0, hour)), minute: Math.min(59, Math.max(0, minute)) };
}

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/;
/** PostgreSQL の time として許容される「24 時台」は 24:00:00 のみ */
const SCHEDULED_END_DAY_END_RE = /^24:00(?::00)?$/;

/**
 * DB の営業日キー用。タイムゾーン変換を避けるため Date へ変換せず、
 * 受け取った YYYY-MM-DD 文字列を検証・trim してそのまま返す。
 */
export function normalizeYmdDateKey(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const ymd = raw.trim();
  return YMD_RE.test(ymd) ? ymd : null;
}

/** `time` カラム用に HH:mm / HH:mm:ss を HH:mm:ss へ正規化する。 */
export function normalizeSqlTime(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  const time = String(raw).trim();
  if (time === "") return null;
  if (!TIME_RE.test(time)) return null;
  return time.length === 5 ? `${time}:00` : time;
}

/**
 * attendance_schedules.scheduled_end_time 専用。
 * プルダウンでは日跨ぎ終了を 00:00〜05:45 で表すが、DB の `time` 比較では 00:00 が「その日の始まり」になるため
 * `scheduled_time < scheduled_end_time` 系の CHECK で弾かれやすい。00:00 のみ同日終端の 24:00:00 に寄せる。
 * （24:00:00 は PostgreSQL の time で入力可能。読み込み側は 00:00 として表示する想定。）
 */
export function normalizeScheduledEndTimeForDb(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  const time = String(raw).trim();
  if (time === "") return null;
  if (SCHEDULED_END_DAY_END_RE.test(time)) return "24:00:00";
  if (!TIME_RE.test(time)) return null;
  const withSeconds = time.length === 5 ? `${time}:00` : time;
  if (withSeconds === "00:00:00") return "24:00:00";
  return withSeconds;
}

/**
 * JST の日付キー + 時刻を timestamptz 用 ISO へ変換する。
 * `+09:00` を明記して、UTC 実行環境でも対象日がずれないようにする。
 */
export function buildJstTimestampIso(dateKey: string, timeStr?: string | null): string | null {
  if (!timeStr || timeStr.trim() === "") return null;
  const ymd = normalizeYmdDateKey(dateKey);
  const time = normalizeSqlTime(timeStr);
  if (!ymd || !time) return null;
  const d = new Date(`${ymd}T${time}+09:00`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
