import { NextResponse } from "next/server";
import type { User } from "@supabase/supabase-js";
import { createServiceRoleClient } from "@/lib/supabase-service";
import { isValidStoreId, parseActiveStoreIdFromCookieHeader } from "@/lib/current-store";
import { canUserEditStore, getAuthedUserForAdminApi } from "@/lib/admin-store-auth";
import { isSuperAdminUser } from "@/lib/super-admin";
import { isUndefinedColumnError, logPostgrestError } from "@/lib/postgrest-error";

export const dynamic = "force-dynamic";

const REMIND_TIME_RE = /^([01][0-9]|2[0-3]):00$/;
const REMINDER_CONFIG_KEY = "reminder_config" as const;

function parsePreOpenReportHourJst(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 23) return v;
  return null;
}

/**
 * 店長など: リクエストの storeId は Cookie のアクティブ店舗と一致すること（UI と API のテナントずれ防止）
 * スーパー管理者は店舗切替のため query/body の storeId をそのまま許可
 */
function storeIdForbiddenUnlessMatchesCookie(
  request: Request,
  user: User,
  storeId: string
): NextResponse | null {
  if (isSuperAdminUser(user)) return null;
  const cookieStoreId = parseActiveStoreIdFromCookieHeader(request.headers.get("cookie"));
  if (cookieStoreId && storeId !== cookieStoreId) {
    return NextResponse.json(
      { error: "storeId must match active store (cookie)" },
      { status: 403 }
    );
  }
  return null;
}

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

  const getCookieMismatch = storeIdForbiddenUnlessMatchesCookie(request, user, storeId);
  if (getCookieMismatch) return getCookieMismatch;

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
    const fullSettings = await admin
      .from("system_settings")
      .select("value, enable_public_holiday, enable_half_holiday")
      .eq("store_id", storeId)
      .eq("key", REMINDER_CONFIG_KEY)
      .maybeSingle();

    let settingsRow: {
      value: unknown;
      enable_public_holiday?: boolean | null;
      enable_half_holiday?: boolean | null;
    } | null = null;

    if (fullSettings.error) {
      if (isUndefinedColumnError(fullSettings.error, "enable_public_holiday")) {
        const fb = await admin
          .from("system_settings")
          .select("value")
          .eq("store_id", storeId)
          .eq("key", REMINDER_CONFIG_KEY)
          .maybeSingle();
        if (fb.error) {
          logPostgrestError("GET system_settings", fb.error);
          return NextResponse.json(
            {
              error: "Failed to load settings",
              details: fb.error.message,
              code: fb.error.code,
            },
            { status: 500 }
          );
        }
        settingsRow = {
          value: fb.data?.value,
          enable_public_holiday: false,
          enable_half_holiday: false,
        };
        console.warn(
          "[api/admin/settings] GET: system_settings.enable_public_holiday 未適用。マイグレーション 016 を適用してください。"
        );
      } else {
        logPostgrestError("GET system_settings", fullSettings.error);
        return NextResponse.json(
          {
            error: "Failed to load settings",
            details: fullSettings.error.message,
            code: fullSettings.error.code,
          },
          { status: 500 }
        );
      }
    } else {
      settingsRow = fullSettings.data as typeof settingsRow;
    }

    /** remind_time / allow_shift_submission / pre_open_report_hour_jst（カラム未適用時はフォールバック） */
    let remindTime = "07:00";
    let allowShiftSubmission = false;
    let preOpenReportHourJst: number | null = null;

    const storeRes = await admin
      .from("stores")
      .select("remind_time, allow_shift_submission, pre_open_report_hour_jst")
      .eq("id", storeId)
      .maybeSingle();

    if (storeRes.error) {
      logPostgrestError("GET stores columns", storeRes.error);
      if (isUndefinedColumnError(storeRes.error, "pre_open_report_hour_jst")) {
        const withoutPreOpen = await admin
          .from("stores")
          .select("remind_time, allow_shift_submission")
          .eq("id", storeId)
          .maybeSingle();
        if (withoutPreOpen.error) {
          logPostgrestError("GET stores (no pre_open)", withoutPreOpen.error);
          if (
            isUndefinedColumnError(withoutPreOpen.error, "remind_time") ||
            isUndefinedColumnError(withoutPreOpen.error, "allow_shift_submission")
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
              "[api/admin/settings] GET: stores.pre_open_report_hour_jst 未適用。他カラムも一部不足の可能性あり。"
            );
          } else {
            return NextResponse.json(
              {
                error: "Failed to load store",
                details: withoutPreOpen.error.message,
                code: withoutPreOpen.error.code,
              },
              { status: 500 }
            );
          }
        } else {
          const row = withoutPreOpen.data as {
            remind_time?: string | null;
            allow_shift_submission?: boolean | null;
          } | null;
          const rt = row?.remind_time;
          if (typeof rt === "string" && rt.trim()) remindTime = rt.trim();
          allowShiftSubmission = row?.allow_shift_submission === true;
          console.warn(
            "[api/admin/settings] GET: stores.pre_open_report_hour_jst 未適用。営業前サマリー時刻は null として返します。"
          );
        }
      } else if (
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
        pre_open_report_hour_jst?: number | null;
      } | null;
      const rt = row?.remind_time;
      if (typeof rt === "string" && rt.trim()) remindTime = rt.trim();
      allowShiftSubmission = row?.allow_shift_submission === true;
      preOpenReportHourJst = parsePreOpenReportHourJst(row?.pre_open_report_hour_jst);
    }

    let enableReservationCheck = false;
    const resCheckRes = await admin
      .from("stores")
      .select("enable_reservation_check")
      .eq("id", storeId)
      .maybeSingle();
    if (resCheckRes.error) {
      if (!isUndefinedColumnError(resCheckRes.error, "enable_reservation_check")) {
        logPostgrestError("GET stores enable_reservation_check", resCheckRes.error);
        return NextResponse.json(
          {
            error: "Failed to load store",
            details: resCheckRes.error.message,
            code: resCheckRes.error.code,
          },
          { status: 500 }
        );
      }
      console.warn(
        "[api/admin/settings] GET: stores.enable_reservation_check 未適用。reminder_config JSON を参照します。マイグレーション 017 を適用してください。"
      );
      const v = settingsRow?.value;
      if (v && typeof v === "object" && !Array.isArray(v)) {
        enableReservationCheck =
          (v as Record<string, unknown>).enable_reservation_check === true;
      }
    } else {
      enableReservationCheck =
        (resCheckRes.data as { enable_reservation_check?: boolean | null } | null)
          ?.enable_reservation_check === true;
    }

    let regularHolidays: number[] = [];
    const rhRes = await admin
      .from("stores")
      .select("regular_holidays")
      .eq("id", storeId)
      .maybeSingle();
    if (rhRes.error) {
      if (!isUndefinedColumnError(rhRes.error, "regular_holidays")) {
        logPostgrestError("GET stores regular_holidays", rhRes.error);
        return NextResponse.json(
          {
            error: "Failed to load store",
            details: rhRes.error.message,
            code: rhRes.error.code,
          },
          { status: 500 }
        );
      }
      console.warn(
        "[api/admin/settings] GET: stores.regular_holidays 未適用。マイグレーション 018 を適用してください。"
      );
    } else {
      const rh = (rhRes.data as { regular_holidays?: number[] | null } | null)?.regular_holidays;
      if (Array.isArray(rh)) {
        regularHolidays = [...new Set(rh.filter((n) => Number.isInteger(n) && n >= 0 && n <= 6))].sort(
          (a, b) => a - b
        );
      }
    }

    return NextResponse.json({
      remind_time: remindTime,
      allow_shift_submission: allowShiftSubmission,
      pre_open_report_hour_jst: preOpenReportHourJst,
      enable_reservation_check: enableReservationCheck,
      enable_public_holiday: settingsRow?.enable_public_holiday === true,
      enable_half_holiday: settingsRow?.enable_half_holiday === true,
      regular_holidays: regularHolidays,
      reminder_config:
        settingsRow?.value && typeof settingsRow.value === "object"
          ? settingsRow.value
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
  /** 未指定の場合は stores.enable_reservation_check を更新しない */
  enable_reservation_check?: boolean;
  /** 未指定の場合は stores.pre_open_report_hour_jst を更新しない。null は送信しない（NULL） */
  pre_open_report_hour_jst?: number | null;
  /** 未指定の場合は system_settings の該当カラムを更新しない（016 未適用時は無視） */
  enable_public_holiday?: boolean;
  enable_half_holiday?: boolean;
  /** 定休日（0=日〜6=土）。未指定なら stores.regular_holidays を更新しない */
  regular_holidays?: number[];
};

/**
 * 店舗の remind_time と reminder_config を一括保存（サービスロール）
 * PATCH /api/admin/settings
 *
 * 1) system_settings は (store_id, key) 単位で SELECT → UPDATE / INSERT（一意制約の差異で upsert が失敗するのを避ける）
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
  const enableReservationCheckProvided = typeof body.enable_reservation_check === "boolean";
  const preOpenReportHourProvided = Object.prototype.hasOwnProperty.call(
    body,
    "pre_open_report_hour_jst"
  );
  const regularHolidaysProvided = Array.isArray(body.regular_holidays);

  if (!storeId || !isValidStoreId(storeId)) {
    return NextResponse.json({ error: "Valid storeId is required" }, { status: 400 });
  }
  if (preOpenReportHourProvided) {
    const v = body.pre_open_report_hour_jst;
    if (v !== null && (typeof v !== "number" || !Number.isInteger(v) || v < 0 || v > 23)) {
      return NextResponse.json(
        { error: "pre_open_report_hour_jst must be null or an integer 0–23" },
        { status: 400 }
      );
    }
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
  if (regularHolidaysProvided) {
    if (!body.regular_holidays!.every((n) => Number.isInteger(n) && n >= 0 && n <= 6)) {
      return NextResponse.json(
        { error: "regular_holidays must be an array of integers from 0 (Sunday) to 6 (Saturday)" },
        { status: 400 }
      );
    }
  }

  if (!canUserEditStore(user, storeId)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const patchCookieMismatch = storeIdForbiddenUnlessMatchesCookie(request, user, storeId);
  if (patchCookieMismatch) return patchCookieMismatch;

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

  /** stores カラム未適用時もリロード後に復元できるよう reminder_config に冗長保存 */
  if (enableReservationCheckProvided) {
    valueJson.enable_reservation_check = body.enable_reservation_check as boolean;
  }

  try {
    const nowIso = new Date().toISOString();

    const { data: existingRow, error: existingErr } = await admin
      .from("system_settings")
      .select("key")
      .eq("store_id", storeId)
      .eq("key", REMINDER_CONFIG_KEY)
      .maybeSingle();

    if (existingErr) {
      logPostgrestError("PATCH system_settings select", existingErr);
      return NextResponse.json(
        {
          error: "Failed to load reminder_config row",
          details: existingErr.message,
          code: existingErr.code,
        },
        { status: 500 }
      );
    }

    const holidayColsProvided =
      typeof body.enable_public_holiday === "boolean" &&
      typeof body.enable_half_holiday === "boolean";

    const settingsUpdatePayload: Record<string, unknown> = {
      value: valueJson,
      updated_at: nowIso,
    };
    if (holidayColsProvided) {
      settingsUpdatePayload.enable_public_holiday = body.enable_public_holiday;
      settingsUpdatePayload.enable_half_holiday = body.enable_half_holiday;
    }

    if (existingRow?.key === REMINDER_CONFIG_KEY) {
      let updateErr = (
        await admin
          .from("system_settings")
          .update(settingsUpdatePayload)
          .eq("store_id", storeId)
          .eq("key", REMINDER_CONFIG_KEY)
      ).error;

      if (
        updateErr &&
        holidayColsProvided &&
        isUndefinedColumnError(updateErr, "enable_public_holiday")
      ) {
        console.warn(
          "[api/admin/settings] PATCH: enable_public_holiday カラムなし。reminder_config のみ保存しました。016 を適用してください。"
        );
        updateErr = (
          await admin
            .from("system_settings")
            .update({ value: valueJson, updated_at: nowIso })
            .eq("store_id", storeId)
            .eq("key", REMINDER_CONFIG_KEY)
        ).error;
      }

      if (updateErr) {
        logPostgrestError("PATCH system_settings update", updateErr);
        return NextResponse.json(
          {
            error: "Failed to save reminder_config",
            details: updateErr.message,
            code: updateErr.code,
            hint: updateErr.hint,
          },
          { status: 500 }
        );
      }
    } else {
      const insertPayload: Record<string, unknown> = {
        store_id: storeId,
        key: REMINDER_CONFIG_KEY,
        value: valueJson,
      };
      if (holidayColsProvided) {
        insertPayload.enable_public_holiday = body.enable_public_holiday;
        insertPayload.enable_half_holiday = body.enable_half_holiday;
      }

      let insertErr = (await admin.from("system_settings").insert(insertPayload)).error;

      if (
        insertErr &&
        holidayColsProvided &&
        isUndefinedColumnError(insertErr, "enable_public_holiday")
      ) {
        console.warn(
          "[api/admin/settings] PATCH: enable_* カラムなし。reminder_config のみ挿入します。016 を適用してください。"
        );
        insertErr = (
          await admin.from("system_settings").insert({
            store_id: storeId,
            key: REMINDER_CONFIG_KEY,
            value: valueJson,
          })
        ).error;
      }

      if (insertErr) {
        logPostgrestError("PATCH system_settings insert", insertErr);
        return NextResponse.json(
          {
            error: "Failed to save reminder_config",
            details: insertErr.message,
            code: insertErr.code,
            hint: insertErr.hint,
          },
          { status: 500 }
        );
      }
    }

    const storePayload: Record<string, string | boolean | number | number[] | null> = {
      remind_time: remindTime,
      updated_at: nowIso,
    };
    if (allowShiftSubmissionProvided) {
      storePayload.allow_shift_submission = body.allow_shift_submission as boolean;
    }
    if (enableReservationCheckProvided) {
      storePayload.enable_reservation_check = body.enable_reservation_check as boolean;
    }
    if (preOpenReportHourProvided) {
      storePayload.pre_open_report_hour_jst = body.pre_open_report_hour_jst as number | null;
    }
    if (regularHolidaysProvided) {
      const unique = [...new Set(body.regular_holidays as number[])].sort((a, b) => a - b);
      storePayload.regular_holidays = unique;
    }

    const storeRes = await admin.from("stores").update(storePayload).eq("id", storeId);

    if (storeRes.error) {
      logPostgrestError("PATCH stores", storeRes.error);
      if (
        enableReservationCheckProvided &&
        isUndefinedColumnError(storeRes.error, "enable_reservation_check")
      ) {
        console.warn(
          "[api/admin/settings] PATCH: enable_reservation_check 未適用。マイグレーション 017 を適用してください。"
        );
        const retryNoResCheck: Record<string, string | boolean | number | null> = {
          remind_time: remindTime,
          updated_at: nowIso,
        };
        if (allowShiftSubmissionProvided) {
          retryNoResCheck.allow_shift_submission = body.allow_shift_submission as boolean;
        }
        if (preOpenReportHourProvided) {
          retryNoResCheck.pre_open_report_hour_jst = body.pre_open_report_hour_jst as number | null;
        }
        const retryRes = await admin.from("stores").update(retryNoResCheck).eq("id", storeId);
        if (retryRes.error) {
          logPostgrestError("PATCH stores retry without enable_reservation_check", retryRes.error);
          return NextResponse.json(
            {
              error: "Failed to update store",
              details: retryRes.error.message,
              code: retryRes.error.code,
              hint: retryRes.error.hint,
            },
            { status: 500 }
          );
        }
        return NextResponse.json({
          ok: true,
          remind_time: remindTime,
          remind_time_persisted: true,
          allow_shift_submission: allowShiftSubmissionProvided
            ? (body.allow_shift_submission as boolean)
            : undefined,
          pre_open_report_hour_jst: preOpenReportHourProvided
            ? (body.pre_open_report_hour_jst as number | null)
            : undefined,
          warning:
            "その他の設定は保存しましたが、stores.enable_reservation_check カラムがありません。マイグレーション 017 を適用してください。",
        });
      }
      if (preOpenReportHourProvided && isUndefinedColumnError(storeRes.error, "pre_open_report_hour_jst")) {
        console.warn(
          "[api/admin/settings] PATCH: stores.pre_open_report_hour_jst 未適用。他項目のみ再試行します。"
        );
        const retryPayload: Record<string, string | boolean | number | null> = {
          remind_time: remindTime,
          updated_at: nowIso,
        };
        if (allowShiftSubmissionProvided) {
          retryPayload.allow_shift_submission = body.allow_shift_submission as boolean;
        }
        if (enableReservationCheckProvided) {
          retryPayload.enable_reservation_check = body.enable_reservation_check as boolean;
        }
        const retryRes = await admin.from("stores").update(retryPayload).eq("id", storeId);
        if (retryRes.error) {
          logPostgrestError("PATCH stores retry without pre_open", retryRes.error);
          if (isUndefinedColumnError(retryRes.error, "remind_time")) {
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
          return NextResponse.json(
            {
              error: "Failed to update store",
              details: retryRes.error.message,
              code: retryRes.error.code,
              hint: retryRes.error.hint,
            },
            { status: 500 }
          );
        }
        return NextResponse.json({
          ok: true,
          remind_time: remindTime,
          remind_time_persisted: true,
          allow_shift_submission: allowShiftSubmissionProvided
            ? (body.allow_shift_submission as boolean)
            : undefined,
          pre_open_report_hour_jst: body.pre_open_report_hour_jst as number | null,
          pre_open_report_hour_persisted: false,
          warning:
            "その他の設定は保存しましたが、stores.pre_open_report_hour_jst カラムがありません。マイグレーションを適用してください。",
        });
      }
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
        const retryPayloadNoAllow: Record<string, string | boolean | number | null> = {
          remind_time: remindTime,
          updated_at: nowIso,
        };
        if (preOpenReportHourProvided) {
          retryPayloadNoAllow.pre_open_report_hour_jst = body.pre_open_report_hour_jst as number | null;
        }
        if (enableReservationCheckProvided) {
          retryPayloadNoAllow.enable_reservation_check = body.enable_reservation_check as boolean;
        }
        const retry = await admin.from("stores").update(retryPayloadNoAllow).eq("id", storeId);
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
          pre_open_report_hour_jst: preOpenReportHourProvided
            ? (body.pre_open_report_hour_jst as number | null)
            : undefined,
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
      pre_open_report_hour_jst: preOpenReportHourProvided
        ? (body.pre_open_report_hour_jst as number | null)
        : undefined,
      enable_reservation_check: enableReservationCheckProvided
        ? (body.enable_reservation_check as boolean)
        : undefined,
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
