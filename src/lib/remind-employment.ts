/**
 * 出勤リマインドの勤務形態（casts.employment_type）に基づく分岐
 */

export type CastEmploymentType = "admin" | "regular" | "part_time" | "employee";

/** リマインド送信から除外（管理者・店長向け） */
export function shouldSkipRemindForCast(
  employmentType: string | null | undefined,
  isAdmin: boolean | null | undefined
): boolean {
  if (employmentType === "admin") return true;
  if (isAdmin === true) return true;
  return false;
}

/** DB 未設定・空文字時の本文（「○○さん、」の後） */
export const DEFAULT_REGULAR_REMIND_BODY = "本日も出勤よろしくお願いいたします。";

/**
 * レギュラー向け1行メッセージ（シフトの有無に関わらず）
 * @param storeBody stores.regular_remind_message（空なら DEFAULT_REGULAR_REMIND_BODY）
 */
export function buildRegularRemindMessageLine(
  castName: string,
  storeBody?: string | null
): string {
  const n = (castName ?? "").trim() || "キャスト";
  const body = String(storeBody ?? "").trim() || DEFAULT_REGULAR_REMIND_BODY;
  return `${n}さん、${body}`;
}

/** バイト・未設定: テンプレート＋時刻表示 */
export function employmentUsesPartTimeRemindTemplate(
  employmentType: string | null | undefined
): boolean {
  return employmentType === "part_time" || employmentType == null || employmentType === undefined;
}

export function employmentUsesRegularRemindMessage(
  employmentType: string | null | undefined
): boolean {
  return employmentType === "regular";
}
