/**
 * 日本時間（JST）の「今日」を YYYY-MM-DD で返す
 */
export function getTodayJst(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Tokyo" });
}
