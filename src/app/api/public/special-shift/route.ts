import { NextResponse } from "next/server";
import { enumerateInclusiveYmd } from "@/lib/special-shift-dates";
import { createServiceRoleClient } from "@/lib/supabase-service";

function parseJsonStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((x): x is string => typeof x === "string" && /^\d{4}-\d{2}-\d{2}$/.test(x));
}

/**
 * GET ?eventId=&castId=
 * キャスト向け提出画面用（認証なし・店舗整合のみ検証）
 */
export async function GET(request: Request) {
  let admin: ReturnType<typeof createServiceRoleClient>;
  try {
    admin = createServiceRoleClient();
  } catch {
    return NextResponse.json({ error: "Server configuration error" }, { status: 500 });
  }

  const url = new URL(request.url);
  const eventId = url.searchParams.get("eventId")?.trim();
  const castId = url.searchParams.get("castId")?.trim();
  if (!eventId || !castId) {
    return NextResponse.json({ error: "eventId and castId are required" }, { status: 400 });
  }

  const { data: ev, error: evErr } = await admin
    .from("special_shift_events")
    .select("id, title, start_date, end_date, store_id")
    .eq("id", eventId)
    .single();

  if (evErr || !ev) {
    return NextResponse.json({ error: "Event not found" }, { status: 404 });
  }

  const { data: cast, error: cErr } = await admin
    .from("casts")
    .select("id, name, store_id, is_active")
    .eq("id", castId)
    .single();

  if (cErr || !cast) {
    return NextResponse.json({ error: "Cast not found" }, { status: 404 });
  }
  if (!cast.is_active) {
    return NextResponse.json({ error: "Cast is inactive" }, { status: 403 });
  }
  if (cast.store_id !== ev.store_id) {
    return NextResponse.json({ error: "Invalid link" }, { status: 403 });
  }

  const { data: entry } = await admin
    .from("special_shift_entries")
    .select("available_dates")
    .eq("event_id", eventId)
    .eq("cast_id", castId)
    .maybeSingle();

  const allowed = new Set(enumerateInclusiveYmd(ev.start_date, ev.end_date));
  const raw = entry?.available_dates;
  const dates = parseJsonStringArray(raw).filter((d) => allowed.has(d));

  return NextResponse.json({
    event: {
      id: ev.id,
      title: ev.title,
      start_date: ev.start_date,
      end_date: ev.end_date,
    },
    cast: { id: cast.id, name: cast.name },
    available_dates: dates,
  });
}

/**
 * POST { eventId, castId, available_dates: string[] }
 */
export async function POST(request: Request) {
  let admin: ReturnType<typeof createServiceRoleClient>;
  try {
    admin = createServiceRoleClient();
  } catch {
    return NextResponse.json({ error: "Server configuration error" }, { status: 500 });
  }

  let body: { eventId?: string; castId?: string; available_dates?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const eventId = typeof body.eventId === "string" ? body.eventId.trim() : "";
  const castId = typeof body.castId === "string" ? body.castId.trim() : "";
  if (!eventId || !castId) {
    return NextResponse.json({ error: "eventId and castId are required" }, { status: 400 });
  }

  const { data: ev, error: evErr } = await admin
    .from("special_shift_events")
    .select("id, start_date, end_date, store_id")
    .eq("id", eventId)
    .single();

  if (evErr || !ev) {
    return NextResponse.json({ error: "Event not found" }, { status: 404 });
  }

  const { data: cast, error: cErr } = await admin
    .from("casts")
    .select("id, store_id, is_active")
    .eq("id", castId)
    .single();

  if (cErr || !cast) {
    return NextResponse.json({ error: "Cast not found" }, { status: 404 });
  }
  if (!cast.is_active) {
    return NextResponse.json({ error: "Cast is inactive" }, { status: 403 });
  }
  if (cast.store_id !== ev.store_id) {
    return NextResponse.json({ error: "Invalid submission" }, { status: 403 });
  }

  const allowed = new Set(enumerateInclusiveYmd(ev.start_date, ev.end_date));
  const cleaned = parseJsonStringArray(body.available_dates).filter((d) => allowed.has(d));
  const unique = [...new Set(cleaned)].sort();

  const { data: upserted, error: upErr } = await admin
    .from("special_shift_entries")
    .upsert(
      {
        event_id: eventId,
        cast_id: castId,
        available_dates: unique,
      },
      { onConflict: "event_id,cast_id" }
    )
    .select("id, available_dates, updated_at")
    .single();

  if (upErr) {
    console.error("[public/special-shift POST]", upErr);
    return NextResponse.json({ error: upErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, entry: upserted });
}
