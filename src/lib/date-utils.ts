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
 * 日本時間（JST）の現在の「時」と「分」を返す
 * Cron が15分おきに動くことを想定した判定用
 */
export function getCurrentTimeJst(): { hour: number; minute: number } {
  const formatter = new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  });
  const parts = formatter.formatToParts(new Date());
  const hour = parseInt(parts.find((p) => p.type === "hour")?.value ?? "0", 10) || 0;
  const minute = parseInt(parts.find((p) => p.type === "minute")?.value ?? "0", 10) || 0;
  return { hour, minute };
}
