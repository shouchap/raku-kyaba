import JapaneseHolidays from "japanese-holidays";

/**
 * 日本の祝日（振替休日を含む）かどうか。ymd は JST の暦日。
 *
 * `japanese-holidays` は無視できないサイズなので、このモジュールは
 * サーバー側か、クライアントでは `await import()` 経由でのみ読み込む。
 */
export function isJapanesePublicHolidayYmd(ymd: string): boolean {
  const d = new Date(`${ymd}T12:00:00+09:00`);
  return Boolean(JapaneseHolidays.isHolidayAt(d, true));
}
