export const PRE_OPEN_REPORT_TEMPLATE_PLACEHOLDER = "{summary_body}";

function toText(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

export function buildEditablePreOpenReportTemplate(
  cfg: Record<string, unknown> | null | undefined
): string {
  const template = toText(cfg?.pre_open_report_template);
  if (template) return template;
  const pre = toText(cfg?.pre_open_report_prefix);
  const post = toText(cfg?.pre_open_report_suffix);
  return [pre, PRE_OPEN_REPORT_TEMPLATE_PLACEHOLDER, post].filter(Boolean).join("\n");
}

export function applyPreOpenReportCustomization(
  base: string,
  cfg: Record<string, unknown> | null | undefined
): string {
  const template = toText(cfg?.pre_open_report_template);
  if (template) {
    return template.includes(PRE_OPEN_REPORT_TEMPLATE_PLACEHOLDER)
      ? template.replaceAll(PRE_OPEN_REPORT_TEMPLATE_PLACEHOLDER, base)
      : `${template}\n${base}`;
  }

  const pre = toText(cfg?.pre_open_report_prefix);
  const post = toText(cfg?.pre_open_report_suffix);
  return [pre, base, post].filter(Boolean).join("\n");
}

