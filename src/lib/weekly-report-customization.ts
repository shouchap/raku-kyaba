export const WEEKLY_REPORT_TEMPLATE_PLACEHOLDER = "{weekly_report_body}";

function toText(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

export function buildEditableWeeklyReportTemplate(
  cfg: Record<string, unknown> | null | undefined
): string {
  const template = toText(cfg?.weekly_report_template);
  if (template) return template;
  const pre = toText(cfg?.weekly_report_prefix);
  const post = toText(cfg?.weekly_report_suffix);
  return [pre, WEEKLY_REPORT_TEMPLATE_PLACEHOLDER, post].filter(Boolean).join("\n");
}

export function applyWeeklyReportCustomization(
  base: string,
  cfg: Record<string, unknown> | null | undefined
): string {
  const template = toText(cfg?.weekly_report_template);
  if (template) {
    return template.includes(WEEKLY_REPORT_TEMPLATE_PLACEHOLDER)
      ? template.replaceAll(WEEKLY_REPORT_TEMPLATE_PLACEHOLDER, base)
      : `${template}\n${base}`;
  }

  const pre = toText(cfg?.weekly_report_prefix);
  const post = toText(cfg?.weekly_report_suffix);
  return [pre, base, post].filter(Boolean).join("\n");
}

