import type { Json } from "@/types/database";
import type { BusinessType } from "@/lib/business-ui";

export type CustomTerms = {
  term_attendance: string;
  term_cast: string;
};

export const DEFAULT_CUSTOM_TERMS: CustomTerms = {
  term_attendance: "出勤",
  term_cast: "キャスト",
};

/** 福祉（B型）向けの既定用語。画面上は「キャスト」ではなく「利用者」と出す */
export const WELFARE_DEFAULT_CUSTOM_TERMS: CustomTerms = {
  term_attendance: "出勤",
  term_cast: "利用者",
};

export function defaultCustomTermsForBusiness(
  businessType?: BusinessType | string | null
): CustomTerms {
  return businessType === "welfare_b"
    ? WELFARE_DEFAULT_CUSTOM_TERMS
    : DEFAULT_CUSTOM_TERMS;
}

export function resolveCustomTerms(
  raw: unknown,
  businessType?: BusinessType | string | null
): CustomTerms {
  const defaults = defaultCustomTermsForBusiness(businessType);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return defaults;
  const rec = raw as Record<string, unknown>;
  const termAttendance =
    typeof rec.term_attendance === "string" && rec.term_attendance.trim()
      ? rec.term_attendance.trim()
      : defaults.term_attendance;

  let termCast =
    typeof rec.term_cast === "string" && rec.term_cast.trim()
      ? rec.term_cast.trim()
      : defaults.term_cast;

  // 福祉店舗に旧デフォルト「キャスト」が残っていても「利用者」へ寄せる
  if (
    businessType === "welfare_b" &&
    termCast === DEFAULT_CUSTOM_TERMS.term_cast
  ) {
    termCast = WELFARE_DEFAULT_CUSTOM_TERMS.term_cast;
  }

  return { term_attendance: termAttendance, term_cast: termCast };
}

export function serializeCustomTerms(
  terms: CustomTerms,
  businessType?: BusinessType | string | null
): Json {
  const defaults = defaultCustomTermsForBusiness(businessType);
  return {
    term_attendance: terms.term_attendance.trim() || defaults.term_attendance,
    term_cast: terms.term_cast.trim() || defaults.term_cast,
  };
}
