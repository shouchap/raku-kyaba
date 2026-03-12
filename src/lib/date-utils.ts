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
