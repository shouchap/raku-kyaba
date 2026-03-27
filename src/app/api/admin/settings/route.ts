import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase-service";
import { isValidStoreId } from "@/lib/current-store";
import { canUserEditStore, getAuthedUserForAdminApi } from "@/lib/admin-store-auth";
import { isUndefinedColumnError, logPostgrestError } from "@/lib/postgrest-error";

export const dynamic = "force-dynamic";

const REMIND_TIME_RE = /^([01][0-9]|2[0-3]):00$/;

function serviceRoleEnvErrorResponse(): NextResponse {
  const hasUrl = Boolean(
    (process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL)?.trim()
  );
  const hasKey = Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY?.trim());
  const msg = !hasUrl
    ? "NEXT_PUBLIC_SUPABASE_URL (or SUPABASE_URL) is not set"
    : !hasKey
      ? "SUPABASE_SERVICE_ROLE_KEY is not set on the server"
      : "Supabase configuration is invalid";
  console.error("[api/admin/settings] Service role env:", { hasUrl, hasKey, msg });
  return NextResponse.json({ error: "Server configuration error", details: msg }, { status: 500 });
}

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

  if (
    !(process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL)?.trim() ||
    !process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  ) {
    return serviceRoleEnvErrorResponse();
  }

  let admin: ReturnType<typeof createServiceRoleClient>;
  try {
    admin = createServiceRoleClient();
  } catch (e) {
    logPostgrestError("GET createServiceRoleClient", e);
    return NextResponse.json(
      {
        error: "Server configuration error (service role)",
        details: e instanceof Error ? e.message : String(e),
      },
      { status: 500 }
    );
  }

  try {
    const settingsRes = await admin
      .from("system_settings")
      .select("value")
      .eq("store_id", storeId)
      .eq("key", "reminder_config")
      .maybeSingle();

    if (settingsRes.error) {
      logPostgrestError("GET system_settings", settingsRes.error);
      return NextResponse.json(
        {
          error: "Failed to load settings",
          details: settingsRes.error.message,
          code: settingsRes.error.code,
        },
        { status: 500 }
      );
    }

    /** remind_time / allow_shift_submission（カラム未適用時はフォールバック） */
    let remindTime = "07:00";
    let allowShiftSubmission = false;
    const storeRes = await admin
      .from("stores")
      .select("remind_time, allow_shift_submission")
      .eq("id", storeId)
      .maybeSingle();

    if (storeRes.error) {
      logPostgrestError("GET stores columns", storeRes.error);
      if (
        isUndefinedColumnError(storeRes.error, "remind_time") ||
        isUndefinedColumnError(storeRes.error, "allow_shift_submission")
      ) {
        const fallback = await admin.from("stores").select("remind_time").eq("id", storeId).maybeSingle();
        if (fallback.error && !isUndefinedColumnError(fallback.error, "remind_time")) {
          return NextResponse.json(
            {
              error: "Failed to load store",
              details: fallback.error.message,
              code: fallback.error.code,
            },
            { status: 500 }
          );
        }
        const rt = (fallback.data as { remind_time?: string } | null)?.remind_time;
        if (typeof rt === "string" && rt.trim()) remindTime = rt.trim();
        console.warn(
          "[api/admin/settings] GET: stores.remind_time or allow_shift_submission missing; using defaults."
        );
      } else {
        return NextResponse.json(
          {
            error: "Failed to load store",
            details: storeRes.error.message,
            code: storeRes.error.code,
          },
          { status: 500 }
        );
      }
    } else {
      const row = storeRes.data as {
        remind_time?: string | null;
        allow_shift_submission?: boolean | null;
      } | null;
      const rt = row?.remind_time;
      if (typeof rt === "string" && rt.trim()) remindTime = rt.trim();
      allowShiftSubmission = row?.allow_shift_submission === true;
    }

    return NextResponse.json({
      remind_time: remindTime,
      allow_shift_submission: allowShiftSubmission,
      reminder_config:
        settingsRes.data?.value && typeof settingsRes.data.value === "object"
          ? settingsRes.data.value
          : {},
    });
  } catch (e) {
    logPostgrestError("GET unexpected", e);
    return NextResponse.json(
      {
        error: "Unexpected server error",
        details: e instanceof Error ? e.message : String(e),
      },
      { status: 500 }
    );
  }
}

type PatchBody = {
  storeId?: string;
  remind_time?: string;
  reminder_config?: Record<string, unknown>;
  /** 未指定の場合は DB の allow_shift_submission を更新しない */
  allow_shift_submission?: boolean;
};

/**
 * 店舗の remind_time と reminder_config を一括保存（サービスロール）
 * PATCH /api/admin/settings
 *
 * 1) system_settings を先に upsert（マイグレーション 011 前提）
 * 2) stores.remind_time を更新（012 未適用なら警告ログのうえ reminder_config のみ成功として返す）
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
  } catch (parseErr) {
    logPostgrestError("PATCH request.json", parseErr);
    return NextResponse.json({ error: "Invalid JSON", details: "Could not parse request body" }, { status: 400 });
  }

  const storeId = body.storeId?.trim() ?? "";
  const remindTime = body.remind_time?.trim() ?? "";
  const reminderConfig = body.reminder_config;
  const allowShiftSubmissionProvided = typeof body.allow_shift_submission === "boolean";

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

  if (
    !(process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL)?.trim() ||
    !process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  ) {
    return serviceRoleEnvErrorResponse();
  }

  let admin: ReturnType<typeof createServiceRoleClient>;
  try {
    admin = createServiceRoleClient();
  } catch (e) {
    logPostgrestError("PATCH createServiceRoleClient", e);
    return NextResponse.json(
      {
        error: "Server configuration error (service role)",
        details: e instanceof Error ? e.message : String(e),
      },
      { status: 500 }
    );
  }

  /** JSONB にそのまま渡せるよう undefined を除去 */
  let valueJson: Record<string, unknown>;
  try {
    valueJson = JSON.parse(JSON.stringify(reminderConfig)) as Record<string, unknown>;
  } catch (e) {
    logPostgrestError("PATCH JSON.stringify reminder_config", e);
    return NextResponse.json(
      { error: "reminder_config is not JSON-serializable", details: String(e) },
      { status: 400 }
    );
  }

  try {
    const settingsRes = await admin.from("system_settings").upsert(
      {
        store_id: storeId,
        key: "reminder_config",
        value: valueJson,
      },
      { onConflict: "store_id,key" }
    );

    if (settingsRes.error) {
      logPostgrestError("PATCH system_settings upsert", settingsRes.error);
      return NextResponse.json(
        {
          error: "Failed to save reminder_config",
          details: settingsRes.error.message,
          code: settingsRes.error.code,
          hint: settingsRes.error.hint,
        },
        { status: 500 }
      );
    }

    const nowIso = new Date().toISOString();
    const storePayload: Record<string, string | boolean> = {
      remind_time: remindTime,
      updated_at: nowIso,
    };
    if (allowShiftSubmissionProvided) {
      storePayload.allow_shift_submission = body.allow_shift_submission as boolean;
    }

    const storeRes = await admin.from("stores").update(storePayload).eq("id", storeId);

    if (storeRes.error) {
      logPostgrestError("PATCH stores", storeRes.error);
      if (isUndefinedColumnError(storeRes.error, "remind_time")) {
        console.warn(
          "[api/admin/settings] PATCH: stores.remind_time column missing; apply supabase/migrations/012_store_remind_time_and_claim.sql. reminder_config was saved."
        );
        return NextResponse.json({
          ok: true,
          remind_time: remindTime,
          remind_time_persisted: false,
          warning:
            "reminder_config は保存しましたが、stores.remind_time カラムがありません。マイグレーション 012 を Supabase に適用してください。",
        });
      }
      if (isUndefinedColumnError(storeRes.error, "allow_shift_submission")) {
        console.warn(
          "[api/admin/settings] PATCH: allow_shift_submission column missing. reminder_config and remind_time may need separate migration."
        );
        const retry = await admin
          .from("stores")
          .update({ remind_time: remindTime, updated_at: nowIso })
          .eq("id", storeId);
        if (retry.error) {
          return NextResponse.json(
            {
              error: "Failed to update store",
              details: retry.error.message,
              code: retry.error.code,
            },
            { status: 500 }
          );
        }
        return NextResponse.json({
          ok: true,
          remind_time: remindTime,
          remind_time_persisted: true,
          warning:
            "その他の設定は保存しましたが、stores.allow_shift_submission カラムがありません。DB にカラムを追加してください。",
        });
      }
      return NextResponse.json(
        {
          error: "Failed to update store",
          details: storeRes.error.message,
          code: storeRes.error.code,
          hint: storeRes.error.hint,
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      remind_time: remindTime,
      remind_time_persisted: true,
      allow_shift_submission: allowShiftSubmissionProvided ? (body.allow_shift_submission as boolean) : undefined,
    });
  } catch (e) {
    logPostgrestError("PATCH unexpected", e);
    return NextResponse.json(
      {
        error: "Unexpected server error",
        details: e instanceof Error ? e.message : String(e),
      },
      { status: 500 }
    );
  }
}
