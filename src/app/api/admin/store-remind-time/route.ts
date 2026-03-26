import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { User } from "@supabase/supabase-js";
import { createServiceRoleClient } from "@/lib/supabase-service";
import { isValidStoreId } from "@/lib/current-store";
import { getStoreAdminStoreIdFromUser } from "@/lib/roles";
import { isSuperAdminUser } from "@/lib/super-admin";

export const dynamic = "force-dynamic";

const REMIND_TIME_RE = /^([01][0-9]|2[0-3]):00$/;

async function getAuthedUser() {
  const cookieStore = await cookies();
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    return { user: null, error: "config" as const };
  }

  const supabase = createServerClient(supabaseUrl, supabaseKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          );
        } catch {
          // ignore
        }
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { user, error: null };
}

function canEditStore(user: User, storeId: string): boolean {
  if (isSuperAdminUser(user)) return true;
  const sid = getStoreAdminStoreIdFromUser(user);
  return sid === storeId;
}

/** GET: 店舗の remind_time を取得（ログインかつ当該店舗の編集権限あり） */
export async function GET(request: Request) {
  const { user, error } = await getAuthedUser();
  if (error === "config") {
    return NextResponse.json({ error: "Supabase is not configured" }, { status: 500 });
  }
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const storeId = searchParams.get("storeId")?.trim() ?? "";
  if (!storeId || !isValidStoreId(storeId)) {
    return NextResponse.json({ error: "Valid storeId is required" }, { status: 400 });
  }

  if (!canEditStore(user, storeId)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const admin = createServiceRoleClient();
    const { data, error: qErr } = await admin
      .from("stores")
      .select("remind_time")
      .eq("id", storeId)
      .single();

    if (qErr || !data) {
      return NextResponse.json(
        { error: "Failed to load store", details: qErr?.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      remind_time: (data as { remind_time?: string }).remind_time ?? "07:00",
    });
  } catch (e) {
    console.error("[store-remind-time] GET:", e);
    return NextResponse.json(
      { error: "Server configuration error (service role)" },
      { status: 500 }
    );
  }
}

/** PATCH: 店舗の remind_time を更新 */
export async function PATCH(request: Request) {
  const { user, error } = await getAuthedUser();
  if (error === "config") {
    return NextResponse.json({ error: "Supabase is not configured" }, { status: 500 });
  }
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { storeId?: string; remind_time?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const storeId = body.storeId?.trim() ?? "";
  const remindTime = body.remind_time?.trim() ?? "";

  if (!storeId || !isValidStoreId(storeId)) {
    return NextResponse.json({ error: "Valid storeId is required" }, { status: 400 });
  }
  if (!REMIND_TIME_RE.test(remindTime)) {
    return NextResponse.json(
      { error: "remind_time must be HH:00 with hour 00–23" },
      { status: 400 }
    );
  }

  if (!canEditStore(user, storeId)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const admin = createServiceRoleClient();
    const nowIso = new Date().toISOString();
    const { error: upErr } = await admin
      .from("stores")
      .update({ remind_time: remindTime, updated_at: nowIso })
      .eq("id", storeId);

    if (upErr) {
      return NextResponse.json(
        { error: "Failed to update store", details: upErr.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true, remind_time: remindTime });
  } catch (e) {
    console.error("[store-remind-time] PATCH:", e);
    return NextResponse.json(
      { error: "Server configuration error (service role)" },
      { status: 500 }
    );
  }
}
