/**
 * 日本時間（JST）の「今日」を YYYY-MM-DD で返す
 */
export function getTodayJst(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Tokyo" });
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
