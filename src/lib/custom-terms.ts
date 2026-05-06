import type { Json } from "@/types/database";

export type CustomTerms = {
  term_attendance: string;
  term_cast: string;
};

export const DEFAULT_CUSTOM_TERMS: CustomTerms = {
  term_attendance: "出勤",
  term_cast: "キャスト",
};

export function resolveCustomTerms(raw: unknown): CustomTerms {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return DEFAULT_CUSTOM_TERMS;
  const rec = raw as Record<string, unknown>;
  const termAttendance =
    typeof rec.term_attendance === "string" && rec.term_attendance.trim()
      ? rec.term_attendance.trim()
      : DEFAULT_CUSTOM_TERMS.term_attendance;
  const termCast =
    typeof rec.term_cast === "string" && rec.term_cast.trim()
      ? rec.term_cast.trim()
      : DEFAULT_CUSTOM_TERMS.term_cast;
  return { term_attendance: termAttendance, term_cast: termCast };
}

export function serializeCustomTerms(terms: CustomTerms): Json {
  return {
    term_attendance: terms.term_attendance.trim() || DEFAULT_CUSTOM_TERMS.term_attendance,
    term_cast: terms.term_cast.trim() || DEFAULT_CUSTOM_TERMS.term_cast,
  };
}
