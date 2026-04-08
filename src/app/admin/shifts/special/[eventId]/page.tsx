import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { canUserEditStore, getAuthedUserForAdminApi } from "@/lib/admin-store-auth";
import { getWeekdayJst } from "@/lib/date-utils";
import { enumerateInclusiveYmd } from "@/lib/special-shift-dates";
import { createSupabaseServerClient } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

const WEEKDAY_JA = ["日", "月", "火", "水", "木", "金", "土"] as const;

function formatHeader(ymd: string): string {
  const [, m, d] = ymd.split("-").map(Number);
  if (m == null || d == null) return ymd;
  const dow = WEEKDAY_JA[getWeekdayJst(ymd)];
  return `${m}/${d}(${dow})`;
}

export default async function AdminSpecialShiftMatrixPage({
  params,
}: {
  params: Promise<{ eventId: string }>;
}) {
  const { eventId } = await params;

  const { user } = await getAuthedUserForAdminApi();
  if (!user) {
    redirect("/login");
  }

  const supabase = await createSupabaseServerClient();

  const { data: event, error: evErr } = await supabase
    .from("special_shift_events")
    .select("id, store_id, title, start_date, end_date")
    .eq("id", eventId)
    .single();

  if (evErr || !event) {
    notFound();
  }

  if (!canUserEditStore(user, event.store_id)) {
    return (
      <div className="p-6 text-sm text-red-600">
        この企画を表示する権限がありません。
      </div>
    );
  }

  const dates = enumerateInclusiveYmd(event.start_date, event.end_date);

  const { data: casts } = await supabase
    .from("casts")
    .select("id, name")
    .eq("store_id", event.store_id)
    .eq("is_active", true)
    .order("name");

  const { data: entries } = await supabase
    .from("special_shift_entries")
    .select("cast_id, available_dates")
    .eq("event_id", eventId);

  const byCast = new Map<string, Set<string>>();
  for (const row of entries ?? []) {
    const raw = row.available_dates;
    const arr = Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string") : [];
    byCast.set(row.cast_id, new Set(arr));
  }

  const castRows = casts ?? [];

  const perDateTotals = dates.map((d) =>
    castRows.reduce((n, c) => n + (byCast.get(c.id)?.has(d) ? 1 : 0), 0)
  );

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 pb-4">
        <Link
          href="/admin/shifts/special"
          className="text-sm font-medium text-blue-700 hover:underline"
        >
          ← 一覧へ
        </Link>
      </div>
      <h1 className="mt-4 text-xl font-bold text-slate-900">{event.title}</h1>
      <p className="mt-1 text-sm text-slate-600">
        {event.start_date} 〜 {event.end_date}
      </p>

      <div className="mt-6 overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="min-w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50">
              <th className="sticky left-0 z-20 w-36 min-w-[9rem] border-r border-slate-200 bg-slate-50 px-3 py-2 text-left font-semibold text-slate-800 shadow-[2px_0_4px_-2px_rgba(0,0,0,0.08)]">
                キャスト
              </th>
              <th className="sticky left-36 z-20 w-14 min-w-[3.5rem] border-r border-slate-200 bg-slate-50 px-2 py-2 text-center text-xs font-semibold text-slate-800 shadow-[2px_0_4px_-2px_rgba(0,0,0,0.08)]">
                日数
              </th>
              {dates.map((d) => (
                <th
                  key={d}
                  className="min-w-[3.25rem] whitespace-nowrap px-1 py-2 text-center text-xs font-medium text-slate-700"
                >
                  {formatHeader(d)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {castRows.length === 0 ? (
              <tr>
                <td
                  colSpan={dates.length + 2}
                  className="px-3 py-6 text-center text-slate-500"
                >
                  アクティブなキャストがいません。
                </td>
              </tr>
            ) : (
              <>
                {castRows.map((c) => {
                  const set = byCast.get(c.id);
                  const dayCount = set?.size ?? 0;
                  return (
                    <tr key={c.id} className="border-b border-slate-100 hover:bg-slate-50/80">
                      <td className="sticky left-0 z-10 w-36 min-w-[9rem] border-r border-slate-200 bg-white px-3 py-2 font-medium text-slate-900 shadow-[2px_0_4px_-2px_rgba(0,0,0,0.06)]">
                        {c.name}
                      </td>
                      <td className="sticky left-36 z-10 w-14 min-w-[3.5rem] border-r border-slate-200 bg-white px-2 py-2 text-center tabular-nums text-slate-800 shadow-[2px_0_4px_-2px_rgba(0,0,0,0.06)]">
                        {dayCount}
                      </td>
                      {dates.map((d) => {
                        const on = set?.has(d) ?? false;
                        return (
                          <td key={d} className="px-1 py-2 text-center text-base">
                            {on ? "◯" : ""}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
                <tr className="border-t-2 border-slate-300 bg-amber-50/90 font-medium">
                  <td className="sticky left-0 z-10 w-36 min-w-[9rem] border-r border-slate-200 bg-amber-50 px-3 py-2.5 text-slate-900 shadow-[2px_0_4px_-2px_rgba(0,0,0,0.06)]">
                    合計人数
                  </td>
                  <td className="sticky left-36 z-10 w-14 min-w-[3.5rem] border-r border-slate-200 bg-amber-50 px-2 py-2.5 text-center text-slate-400 shadow-[2px_0_4px_-2px_rgba(0,0,0,0.06)]">
                    —
                  </td>
                  {perDateTotals.map((n, i) => (
                    <td
                      key={dates[i]}
                      className="px-1 py-2.5 text-center tabular-nums text-slate-900"
                    >
                      {n}
                    </td>
                  ))}
                </tr>
              </>
            )}
          </tbody>
        </table>
      </div>
      <p className="mt-4 text-xs text-slate-500">
        ◯ は出勤可能として提出された日です。未提出のキャストは空欄のまま表示されます。「日数」は提出された出勤可能日の件数、最下行「合計人数」はその日に◯が付いているキャスト数です。
      </p>
    </div>
  );
}
