import { NextResponse } from "next/server";
import { canUserEditStore, getAuthedUserForAdminApi } from "@/lib/admin-store-auth";
import { resolveActiveStoreIdFromRequest } from "@/lib/current-store";
import { createServiceRoleClient } from "@/lib/supabase-service";

/**
 * GET: アクティブ店舗の特別シフト企画一覧
 * POST: 企画作成 { title, start_date, end_date }
 */
export async function GET(request: Request) {
  let admin: ReturnType<typeof createServiceRoleClient>;
  try {
    admin = createServiceRoleClient();
  } catch {
    return NextResponse.json({ error: "Server configuration error (service role)" }, { status: 500 });
  }

  let expectedStoreId: string;
  try {
    expectedStoreId = resolveActiveStoreIdFromRequest(request);
  } catch (e) {
    return NextResponse.json(
      { error: "Tenant not configured", details: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }

  const { user, error: authErr } = await getAuthedUserForAdminApi();
  if (authErr === "config") {
    return NextResponse.json({ error: "Supabase is not configured" }, { status: 500 });
  }
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!canUserEditStore(user, expectedStoreId)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { data, error } = await admin
    .from("special_shift_events")
    .select("id, store_id, title, start_date, end_date, created_at, updated_at")
    .eq("store_id", expectedStoreId)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[special-shift-events GET]", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ events: data ?? [] });
}

export async function POST(request: Request) {
  let admin: ReturnType<typeof createServiceRoleClient>;
  try {
    admin = createServiceRoleClient();
  } catch {
    return NextResponse.json({ error: "Server configuration error (service role)" }, { status: 500 });
  }

  let body: { title?: string; start_date?: string; end_date?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const title = typeof body.title === "string" ? body.title.trim() : "";
  const start_date = body.start_date;
  const end_date = body.end_date;
  if (!title) {
    return NextResponse.json({ error: "title is required" }, { status: 400 });
  }
  if (!start_date || !/^\d{4}-\d{2}-\d{2}$/.test(start_date)) {
    return NextResponse.json({ error: "start_date is required (YYYY-MM-DD)" }, { status: 400 });
  }
  if (!end_date || !/^\d{4}-\d{2}-\d{2}$/.test(end_date)) {
    return NextResponse.json({ error: "end_date is required (YYYY-MM-DD)" }, { status: 400 });
  }
  if (end_date < start_date) {
    return NextResponse.json({ error: "end_date must be on or after start_date" }, { status: 400 });
  }

  let expectedStoreId: string;
  try {
    expectedStoreId = resolveActiveStoreIdFromRequest(request);
  } catch (e) {
    return NextResponse.json(
      { error: "Tenant not configured", details: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }

  const { user, error: authErr } = await getAuthedUserForAdminApi();
  if (authErr === "config") {
    return NextResponse.json({ error: "Supabase is not configured" }, { status: 500 });
  }
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!canUserEditStore(user, expectedStoreId)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { data, error } = await admin
    .from("special_shift_events")
    .insert({
      store_id: expectedStoreId,
      title,
      start_date,
      end_date,
    })
    .select("id, store_id, title, start_date, end_date, created_at, updated_at")
    .single();

  if (error) {
    console.error("[special-shift-events POST]", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ event: data });
}
