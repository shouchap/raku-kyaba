"use client";

import {
  Fragment,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createBrowserSupabaseClient } from "@/lib/supabase-client";
import { useActiveStoreId } from "@/contexts/ActiveStoreContext";
import { getTodayJst } from "@/lib/date-utils";
import { ChevronDown, ChevronRight } from "lucide-react";

type Cast = {
  id: string;
  name: string;
  store_id: string;
};

type Store = {
  id: string;
  name: string;
};

type ScheduleRow = {
  id: string;
  cast_id: string;
  scheduled_date: string;
  is_dohan: boolean | null;
  is_absent: boolean | null;
  is_late: boolean | null;
  late_reason: string | null;
  absent_reason: string | null;
  public_holiday_reason: string | null;
  half_holiday_reason: string | null;
  response_status:
    | "attending"
    | "absent"
    | "late"
    | "public_holiday"
    | "half_holiday"
    | null;
};

type Incident = {
  dateStr: string;
  kind: "late" | "absent" | "public_holiday" | "half_holiday";
  reason: string | null;
};

type CastReport = {
  castId: string;
  name: string;
  attendanceDays: number;
  dohanCount: number;
  lateCount: number;
  absentCount: number;
  incidents: Incident[];
};

type SortKey = "name" | "attendance" | "dohan" | "late" | "absent";

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** YYYY-MM-DD（JSTの今日）から { year, month } month は 1–12 */
function parseYearMonthFromToday(today: string): { year: number; month: number } {
  const [y, m] = today.split("-").map(Number);
  return { year: y, month: m };
}

/** year, month（1–12）の月初・月末 YYYY-MM-DD */
function getMonthRangeIso(year: number, month: number): { start: string; end: string } {
  const start = `${year}-${pad2(month)}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const end = `${year}-${pad2(month)}-${pad2(lastDay)}`;
  return { start, end };
}

/** ym クエリ "YYYY-MM" をパース。無効なら null */
function parseYmParam(ym: string | null): { year: number; month: number } | null {
  if (!ym || !/^\d{4}-\d{2}$/.test(ym)) return null;
  const [y, m] = ym.split("-").map(Number);
  if (m < 1 || m > 12 || y < 2000 || y > 2100) return null;
  return { year: y, month: m };
}

function formatYm(year: number, month: number): string {
  return `${year}-${pad2(month)}`;
}

/** "2026-03-15" → "3月15日" */
function formatJaMonthDay(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  return `${m}月${d}日`;
}

function rowIsAbsent(row: ScheduleRow): boolean {
  return row.is_absent === true || row.response_status === "absent";
}

/** 欠勤・公休・半休を含む「休み」扱いの日（出勤日数から除く） */
function rowIsOffDay(row: ScheduleRow): boolean {
  return (
    rowIsAbsent(row) ||
    row.response_status === "public_holiday" ||
    row.response_status === "half_holiday"
  );
}

function rowIsLate(row: ScheduleRow): boolean {
  return row.is_late === true || row.response_status === "late";
}

function buildCastReports(
  casts: Cast[],
  schedules: ScheduleRow[]
): CastReport[] {
  const byCast = new Map<string, ScheduleRow[]>();
  for (const s of schedules) {
    const list = byCast.get(s.cast_id) ?? [];
    list.push(s);
    byCast.set(s.cast_id, list);
  }

  return casts.map((cast) => {
    const rows = byCast.get(cast.id) ?? [];
    let attendanceDays = 0;
    let dohanCount = 0;
    let lateCount = 0;
    let absentCount = 0;
    const incidents: Incident[] = [];

    for (const row of rows) {
      const off = rowIsOffDay(row);
      const absentOnly = rowIsAbsent(row);
      const late = rowIsLate(row);

      if (!off) attendanceDays += 1;
      if (row.is_dohan === true) dohanCount += 1;
      if (late) lateCount += 1;
      if (off) absentCount += 1;

      if (late) {
        incidents.push({
          dateStr: row.scheduled_date,
          kind: "late",
          reason: row.late_reason,
        });
      }
      if (absentOnly) {
        incidents.push({
          dateStr: row.scheduled_date,
          kind: "absent",
          reason: row.absent_reason,
        });
      }
      if (row.response_status === "public_holiday") {
        incidents.push({
          dateStr: row.scheduled_date,
          kind: "public_holiday",
          reason: row.public_holiday_reason,
        });
      }
      if (row.response_status === "half_holiday") {
        incidents.push({
          dateStr: row.scheduled_date,
          kind: "half_holiday",
          reason: row.half_holiday_reason,
        });
      }
    }

    incidents.sort((a, b) => a.dateStr.localeCompare(b.dateStr));

    return {
      castId: cast.id,
      name: cast.name,
      attendanceDays,
      dohanCount,
      lateCount,
      absentCount,
      incidents,
    };
  });
}

function AdminReportContent() {
  const activeStoreId = useActiveStoreId();
  const supabase = useMemo(() => createBrowserSupabaseClient(), []);
  const router = useRouter();
  const searchParams = useSearchParams();

  const today = useMemo(() => getTodayJst(), []);
  const defaultYm = useMemo(() => parseYearMonthFromToday(today), [today]);

  const ymFromUrl = parseYmParam(searchParams.get("ym"));
  const [year, setYear] = useState(ymFromUrl?.year ?? defaultYm.year);
  const [month, setMonth] = useState(ymFromUrl?.month ?? defaultYm.month);

  useEffect(() => {
    const parsed = parseYmParam(searchParams.get("ym"));
    if (parsed) {
      setYear(parsed.year);
      setMonth(parsed.month);
    }
  }, [searchParams]);

  const [store, setStore] = useState<Store | null>(null);
  const [casts, setCasts] = useState<Cast[]>([]);
  const [schedules, setSchedules] = useState<ScheduleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const { start, end } = useMemo(
    () => getMonthRangeIso(year, month),
    [year, month]
  );

  const setYm = useCallback(
    (y: number, m: number) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set("ym", formatYm(y, m));
      router.push(`/admin/report?${params.toString()}`);
    },
    [router, searchParams]
  );

  const goPrevMonth = useCallback(() => {
    let y = year;
    let mo = month - 1;
    if (mo < 1) {
      mo = 12;
      y -= 1;
    }
    setYm(y, mo);
  }, [year, month, setYm]);

  const goNextMonth = useCallback(() => {
    let y = year;
    let mo = month + 1;
    if (mo > 12) {
      mo = 1;
      y += 1;
    }
    setYm(y, mo);
  }, [year, month, setYm]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    const tenantId = activeStoreId;
    try {
      const [castsRes, storesRes] = await Promise.all([
        supabase
          .from("casts")
          .select("id, name, store_id")
          .eq("store_id", tenantId)
          .eq("is_active", true)
          .order("name"),
        supabase.from("stores").select("id, name").eq("id", tenantId).single(),
      ]);

      if (castsRes.error) throw castsRes.error;
      if (!storesRes.data) {
        setCasts([]);
        setStore(null);
        setSchedules([]);
        return;
      }

      const st = storesRes.data as Store;
      setStore(st);
      const castList = (castsRes.data ?? []) as Cast[];
      setCasts(castList);

      if (castList.length === 0) {
        setSchedules([]);
        return;
      }

      const castIds = castList.map((c) => c.id);
      const { data: schedData, error: schedError } = await supabase
        .from("attendance_schedules")
        .select(
          "id, cast_id, scheduled_date, is_dohan, is_absent, is_late, late_reason, absent_reason, public_holiday_reason, half_holiday_reason, response_status"
        )
        .eq("store_id", st.id)
        .in("cast_id", castIds)
        .gte("scheduled_date", start)
        .lte("scheduled_date", end)
        .order("scheduled_date");

      if (schedError) throw schedError;
      setSchedules((schedData ?? []) as ScheduleRow[]);
    } catch (e: unknown) {
      console.error(e);
      setError(e instanceof Error ? e.message : "データの取得に失敗しました");
      setSchedules([]);
    } finally {
      setLoading(false);
    }
  }, [supabase, start, end, activeStoreId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const reports = useMemo(
    () => buildCastReports(casts, schedules),
    [casts, schedules]
  );

  const sortedReports = useMemo(() => {
    const list = [...reports];
    const dir = sortDir === "asc" ? 1 : -1;
    list.sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case "name":
          cmp = a.name.localeCompare(b.name, "ja");
          break;
        case "attendance":
          cmp = a.attendanceDays - b.attendanceDays;
          break;
        case "dohan":
          cmp = a.dohanCount - b.dohanCount;
          break;
        case "late":
          cmp = a.lateCount - b.lateCount;
          break;
        case "absent":
          cmp = a.absentCount - b.absentCount;
          break;
        default:
          cmp = 0;
      }
      return cmp * dir;
    });
    return list;
  }, [reports, sortKey, sortDir]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "name" ? "asc" : "desc");
    }
  };

  const toggleExpand = (castId: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(castId)) next.delete(castId);
      else next.add(castId);
      return next;
    });
  };

  const titleLabel = `${year}年${month}月`;
  const hasDetails = (r: CastReport) => r.incidents.length > 0;

  return (
    <div className="p-4 sm:p-6">
      <div className="mb-6">
        <h1 className="text-xl sm:text-2xl font-bold text-gray-900">
          月間レポート（集計）
        </h1>
        <p className="mt-1 text-sm text-gray-600">
          {store?.name ?? "店舗"} · 遅刻・休み（欠勤・公休・半休）の理由は、該当がある行を展開して確認できます（表示のみ）。
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={goPrevMonth}
            className="inline-flex items-center rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50"
          >
            ＜ 先月
          </button>
          <span className="min-w-[8rem] text-center text-base font-semibold text-gray-900">
            {titleLabel}
          </span>
          <button
            type="button"
            onClick={goNextMonth}
            className="inline-flex items-center rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50"
          >
            次月 ＞
          </button>
        </div>
        <p className="text-xs text-gray-500">
          集計期間: {start} 〜 {end}
        </p>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      )}

      {loading ? (
        <p className="text-gray-600">読み込み中…</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm">
          <table className="min-w-[640px] w-full text-left text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50">
                <th className="px-3 py-3 font-semibold text-gray-700 w-10" />
                <th className="px-3 py-3">
                  <button
                    type="button"
                    onClick={() => toggleSort("name")}
                    className="font-semibold text-gray-900 hover:text-blue-700 inline-flex items-center gap-1"
                  >
                    キャスト
                    {sortKey === "name" && (sortDir === "asc" ? " ↑" : " ↓")}
                  </button>
                </th>
                <th className="px-3 py-3 text-right">
                  <button
                    type="button"
                    onClick={() => toggleSort("attendance")}
                    className="font-semibold text-gray-900 hover:text-blue-700"
                  >
                    出勤日数
                    {sortKey === "attendance" &&
                      (sortDir === "asc" ? " ↑" : " ↓")}
                  </button>
                </th>
                <th className="px-3 py-3 text-right">
                  <button
                    type="button"
                    onClick={() => toggleSort("dohan")}
                    className="font-semibold text-gray-900 hover:text-blue-700"
                  >
                    同伴
                    {sortKey === "dohan" && (sortDir === "asc" ? " ↑" : " ↓")}
                  </button>
                </th>
                <th className="px-3 py-3 text-right">
                  <button
                    type="button"
                    onClick={() => toggleSort("late")}
                    className="font-semibold text-gray-900 hover:text-blue-700"
                  >
                    遅刻
                    {sortKey === "late" && (sortDir === "asc" ? " ↑" : " ↓")}
                  </button>
                </th>
                <th className="px-3 py-3 text-right">
                  <button
                    type="button"
                    onClick={() => toggleSort("absent")}
                    className="font-semibold text-gray-900 hover:text-blue-700"
                  >
                    休み
                    {sortKey === "absent" && (sortDir === "asc" ? " ↑" : " ↓")}
                  </button>
                </th>
              </tr>
            </thead>
            <tbody>
              {sortedReports.length === 0 ? (
                <tr>
                  <td
                    colSpan={6}
                    className="px-3 py-8 text-center text-gray-500"
                  >
                    この月のシフトデータはありません。
                  </td>
                </tr>
              ) : (
                sortedReports.map((r) => {
                  const open = expanded.has(r.castId);
                  const showToggle = hasDetails(r);
                  return (
                    <Fragment key={r.castId}>
                      <tr className="border-b border-gray-100 hover:bg-gray-50/80">
                        <td className="px-1 py-2 text-center">
                          {showToggle ? (
                            <button
                              type="button"
                              onClick={() => toggleExpand(r.castId)}
                              className="p-1 rounded-md text-gray-600 hover:bg-gray-200"
                              aria-expanded={open}
                              aria-label="遅刻・休みの詳細を表示"
                            >
                              {open ? (
                                <ChevronDown className="h-5 w-5" />
                              ) : (
                                <ChevronRight className="h-5 w-5" />
                              )}
                            </button>
                          ) : (
                            <span className="inline-block w-7" />
                          )}
                        </td>
                        <td className="px-3 py-3 font-medium text-gray-900">
                          {r.name}
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums">
                          {r.attendanceDays}
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums">
                          {r.dohanCount}
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums">
                          {r.lateCount}
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums">
                          {r.absentCount}
                        </td>
                      </tr>
                      {showToggle && open && (
                        <tr className="bg-gray-50/90">
                          <td colSpan={6} className="px-4 py-3 text-sm text-gray-700">
                            <ul className="space-y-2 pl-2 border-l-2 border-blue-200">
                              {r.incidents.map((inc, idx) => {
                                const label =
                                  inc.kind === "late"
                                    ? "遅刻"
                                    : inc.kind === "absent"
                                      ? "欠勤"
                                      : inc.kind === "public_holiday"
                                        ? "公休"
                                        : "半休";
                                const reasonText =
                                  inc.reason?.trim() || "（理由なし）";
                                return (
                                  <li key={`${inc.dateStr}-${inc.kind}-${idx}`}>
                                    {formatJaMonthDay(inc.dateStr)} [
                                    {label}]：{reasonText}
                                  </li>
                                );
                              })}
                            </ul>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ReportFallback() {
  return (
    <div className="p-6 text-gray-600">読み込み中…</div>
  );
}

export default function AdminReportPage() {
  return (
    <Suspense fallback={<ReportFallback />}>
      <AdminReportContent />
    </Suspense>
  );
}
