import type { SupabaseClient } from "@supabase/supabase-js";

export type WelfareLineCustomization = {
  bodyColor?: string;
  buttonColor?: string;
  otherInputLabel?: string;
  hospitalNameQuestion?: string;
  hospitalStartPrompt?: string;
  hospitalEndPrompt?: string;
  endWorkChoicePrompt?: string;
  workItemPrompt?: string;
  morningStartButtonLabel?: string;
  healthGoodButtonLabel?: string;
  healthBadButtonLabel?: string;
  healthContactButtonLabel?: string;
  endWorkNormalButtonLabel?: string;
  endWorkHospitalButtonLabel?: string;
};

export type LineCustomization = {
  welfare?: WelfareLineCustomization;
};

function asRecord(v: unknown): Record<string, unknown> | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  return v as Record<string, unknown>;
}

function pickText(v: unknown): string | undefined {
  const s = typeof v === "string" ? v.trim() : "";
  return s ? s : undefined;
}

function pickColor(v: unknown): string | undefined {
  const s = pickText(v);
  if (!s) return undefined;
  return /^#[0-9A-Fa-f]{6}$/.test(s) ? s : undefined;
}

export function parseLineCustomization(raw: unknown): LineCustomization {
  const root = asRecord(raw);
  if (!root) return {};
  const welfareRaw = asRecord(root.welfare);
  if (!welfareRaw) return {};

  return {
    welfare: {
      bodyColor: pickColor(welfareRaw.bodyColor),
      buttonColor: pickColor(welfareRaw.buttonColor),
      otherInputLabel: pickText(welfareRaw.otherInputLabel),
      hospitalNameQuestion: pickText(welfareRaw.hospitalNameQuestion),
      hospitalStartPrompt: pickText(welfareRaw.hospitalStartPrompt),
      hospitalEndPrompt: pickText(welfareRaw.hospitalEndPrompt),
      endWorkChoicePrompt: pickText(welfareRaw.endWorkChoicePrompt),
      workItemPrompt: pickText(welfareRaw.workItemPrompt),
      morningStartButtonLabel: pickText(welfareRaw.morningStartButtonLabel),
      healthGoodButtonLabel: pickText(welfareRaw.healthGoodButtonLabel),
      healthBadButtonLabel: pickText(welfareRaw.healthBadButtonLabel),
      healthContactButtonLabel: pickText(welfareRaw.healthContactButtonLabel),
      endWorkNormalButtonLabel: pickText(welfareRaw.endWorkNormalButtonLabel),
      endWorkHospitalButtonLabel: pickText(welfareRaw.endWorkHospitalButtonLabel),
    },
  };
}

export async function fetchLineCustomizationForStore(
  supabase: SupabaseClient,
  storeId: string
): Promise<LineCustomization> {
  const { data } = await supabase
    .from("system_settings")
    .select("value")
    .eq("store_id", storeId)
    .eq("key", "reminder_config")
    .maybeSingle();

  const value = (data?.value ?? {}) as Record<string, unknown>;
  return parseLineCustomization(value.line_customization);
}
