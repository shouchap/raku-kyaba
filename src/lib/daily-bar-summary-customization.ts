export const DAILY_BAR_SUMMARY_TEMPLATE_PLACEHOLDER = "{daily_bar_summary_body}";

function toText(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

export function buildEditableDailyBarSummaryTemplate(
  cfg: Record<string, unknown> | null | undefined
): string {
  const template = toText(cfg?.daily_bar_summary_template);
  if (template) return template;
  const pre = toText(cfg?.daily_bar_summary_prefix);
  const post = toText(cfg?.daily_bar_summary_suffix);
  return [pre, DAILY_BAR_SUMMARY_TEMPLATE_PLACEHOLDER, post].filter(Boolean).join("\n");
}

export function applyDailyBarSummaryCustomization(
  base: string,
  cfg: Record<string, unknown> | null | undefined
): string {
  const template = toText(cfg?.daily_bar_summary_template);
  if (template) {
    return template.includes(DAILY_BAR_SUMMARY_TEMPLATE_PLACEHOLDER)
      ? template.replaceAll(DAILY_BAR_SUMMARY_TEMPLATE_PLACEHOLDER, base)
      : `${template}\n${base}`;
  }

  const pre = toText(cfg?.daily_bar_summary_prefix);
  const post = toText(cfg?.daily_bar_summary_suffix);
  return [pre, base, post].filter(Boolean).join("\n");
}

