import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase-service";
import { isValidStoreId } from "@/lib/current-store";
import { canUserEditStore, getAuthedUserForAdminApi } from "@/lib/admin-store-auth";

export const dynamic = "force-dynamic";

const REMIND_TIME_RE = /^([01][0-9]|2[0-3]):00$/;

/**
 * 店舗のリマインド時刻 + reminder_config をまとめて取得（サービスロール）
 * GET /api/admin/settings?storeId=uuid
 */
export async function GET(request: Request) {
  const { user, error } = await getAuthedUserForAdminApi();
  if (error === "config") {
    return NextResponse.json({ error: "Supabase is not configured" }, { status: 500 });
  }
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const storeId = new URL(request.url).searchParams.get("storeId")?.trim() ?? "";
  if (!storeId || !isValidStoreId(storeId)) {
    return NextResponse.json({ error: "Valid storeId is required" }, { status: 400 });
  }

  if (!canUserEditStore(user, storeId)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const admin = createServiceRoleClient();
    const [{ data: store, error: storeErr }, { data: settingsRow, error: settingsErr }] =
      await Promise.all([
        admin.from("stores").select("remind_time").eq("id", storeId).single(),
        admin
          .from("system_settings")
          .select("value")
          .eq("store_id", storeId)
          .eq("key", "reminder_config")
          .maybeSingle(),
      ]);

    if (storeErr || !store) {
      return NextResponse.json(
        { error: "Failed to load store", details: storeErr?.message },
        { status: 500 }
      );
    }
    if (settingsErr) {
      return NextResponse.json(
        { error: "Failed to load settings", details: settingsErr.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      remind_time: (store as { remind_time?: string }).remind_time ?? "07:00",
      reminder_config: settingsRow?.value && typeof settingsRow.value === "object"
        ? settingsRow.value
        : {},
    });
  } catch (e) {
    console.error("[api/admin/settings] GET:", e);
    return NextResponse.json(
      { error: "Server configuration error (service role)" },
      { status: 500 }
    );
  }
}

type PatchBody = {
  storeId?: string;
  remind_time?: string;
  reminder_config?: Record<string, unknown>;
};

/**
 * 店舗の remind_time と reminder_config を一括保存（サービスロール）
 * PATCH /api/admin/settings
 */
export async function PATCH(request: Request) {
  const { user, error } = await getAuthedUserForAdminApi();
  if (error === "config") {
    return NextResponse.json({ error: "Supabase is not configured" }, { status: 500 });
  }
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: PatchBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const storeId = body.storeId?.trim() ?? "";
  const remindTime = body.remind_time?.trim() ?? "";
  const reminderConfig = body.reminder_config;

  if (!storeId || !isValidStoreId(storeId)) {
    return NextResponse.json({ error: "Valid storeId is required" }, { status: 400 });
  }
  if (!REMIND_TIME_RE.test(remindTime)) {
    return NextResponse.json(
      { error: "remind_time must be HH:00 with hour 00–23" },
      { status: 400 }
    );
  }
  if (!reminderConfig || typeof reminderConfig !== "object" || Array.isArray(reminderConfig)) {
    return NextResponse.json({ error: "reminder_config must be an object" }, { status: 400 });
  }

  if (!canUserEditStore(user, storeId)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const admin = createServiceRoleClient();
    const nowIso = new Date().toISOString();

    const [{ error: storeErr }, { error: settingsErr }] = await Promise.all([
      admin
        .from("stores")
        .update({ remind_time: remindTime, updated_at: nowIso })
        .eq("id", storeId),
      admin.from("system_settings").upsert(
        {
          store_id: storeId,
          key: "reminder_config",
          value: reminderConfig as Record<string, unknown>,
        },
        { onConflict: "store_id,key" }
      ),
    ]);

    if (storeErr) {
      return NextResponse.json(
        { error: "Failed to update store", details: storeErr.message },
        { status: 500 }
      );
    }
    if (settingsErr) {
      return NextResponse.json(
        { error: "Failed to save reminder_config", details: settingsErr.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true, remind_time: remindTime });
  } catch (e) {
    console.error("[api/admin/settings] PATCH:", e);
    return NextResponse.json(
      { error: "Server configuration error (service role)" },
      { status: 500 }
    );
  }
}
