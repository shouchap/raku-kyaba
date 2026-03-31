/**
 * 出勤リマインドの勤務形態（casts.employment_type）に基づく分岐
 */

export type CastEmploymentType = "admin" | "regular" | "part_time";

/** リマインド送信から除外（管理者・店長向け） */
export function shouldSkipRemindForCast(
  employmentType: string | null | undefined,
  isAdmin: boolean | null | undefined
): boolean {
  if (employmentType === "admin") return true;
  if (isAdmin === true) return true;
  return false;
}

/** レギュラー向け固定文（シフトの有無に関わらず） */
export function buildRegularRemindMessageLine(castName: string): string {
  const n = (castName ?? "").trim() || "キャスト";
  return `${n}さん、本日も出勤よろしくお願いいたします。`;
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
