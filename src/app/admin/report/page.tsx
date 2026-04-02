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
import {
  addCalendarDaysJst,
  getMondayOfJstWeek,
  getSundayOfJstWeekFromMonday,
  getTodayJst,
} from "@/lib/date-utils";
import { ChevronDown, ChevronRight, Printer } from "lucide-react";
import "./report-print.css";

type Cast = {
  id: string;
  name: string;
  store_id: string;
};

type Store = {
  id: string;
  name: string;
  business_type?: string | null;
};

/** GET /api/admin/report の welfare 行（B型） */
type WelfareReportRow = {
  id: string;
  cast_id: string;
  cast_name: string;
  work_date: string;
  started_at: string | null;
  ended_at: string | null;
  work_item: string | null;
  work_details: string | null;
  quantity: number | null;
  health_status: string | null;
  health_reason: string | null;
  health_notes: string | null;
};

type ScheduleRow = {
  id: string;
  cast_id: string;
  scheduled_date: string;
  is_dohan: boolean | null;
  is_sabaki: boolean | null;
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
  sabakiCount: number;
  sabakiDates: string[];
  lateCount: number;
  absentCount: number;
  incidents: Incident[];
};

type SortKey = "name" | "attendance" | "dohan" | "sabaki" | "late" | "absent";

type ViewMode = "month" | "week";

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function parseYearMonthFromToday(today: string): { year: number; month: number } {
  const [y, m] = today.split("-").map(Number);
  return { year: y, month: m };
}

function getMonthRangeIso(year: number, month: number): { start: string; end: string } {
  const start = `${year}-${pad2(month)}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const end = `${year}-${pad2(month)}-${pad2(lastDay)}`;
  return { start, end };
}

function parseYmParam(ym: string | null): { year: number; month: number } | null {
  if (!ym || !/^\d{4}-\d{2}$/.test(ym)) return null;
  const [y, m] = ym.split("-").map(Number);
  if (m < 1 || m > 12 || y < 2000 || y > 2100) return null;
  return { year: y, month: m };
}

function formatYm(year: number, month: number): string {
  return `${year}-${pad2(month)}`;
}

function formatJaMonthDay(dateStr: string): string {
  const [, m, d] = dateStr.split("-").map(Number);
  return `${m}月${d}日`;
}

function formatWeekRangeLabel(mondayYmd: string): string {
  const sun = getSundayOfJstWeekFromMonday(mondayYmd);
  return `${formatJaMonthDay(mondayYmd)}〜${formatJaMonthDay(sun)}`;
}

function formatTimeJstFromIso(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
}

/** DB health_status → 表示用（体調） */
function formatHealthCondition(status: string | null): string {
  if (!status) return "—";
  if (status === "good") return "良好";
  if (status === "soso") return "やや不調";
  if (status === "bad") return "不調";
  if (status === "contact") return "担当者連絡";
  return status;
}

/** 体調詳細: health_notes と health_reason（LINE 不調理由）を併記 */
function formatHealthNotesCell(notes: string | null, reason: string | null): string {
  const parts = [notes?.trim(), reason?.trim()].filter(Boolean);
  return parts.length > 0 ? parts.join(" / ") : "—";
}

function rowIsAbsent(row: ScheduleRow): boolean {
  return row.is_absent === true || row.response_status === "absent";
}

function rowIsOffDay(row: ScheduleRow): boolean {
  return (
    rowIsAbsent(row) ||
    row.response_status === "half_holiday" ||
    row.response_status === "public_holiday"
  );
}

function rowIsLate(row: ScheduleRow): boolean {
  return row.is_late === true || row.response_status === "late";
}

function buildCastReports(casts: Cast[], schedules: ScheduleRow[]): CastReport[] {
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
    let sabakiCount = 0;
    const sabakiDates: string[] = [];
    let lateCount = 0;
    let absentCount = 0;
    const incidents: Incident[] = [];

    for (const row of rows) {
      const off = rowIsOffDay(row);
      const absentOnly = rowIsAbsent(row);
      const late = rowIsLate(row);

      if (!off) attendanceDays += 1;
      if (row.is_dohan === true) dohanCount += 1;
      if (row.is_sabaki === true) {
        sabakiCount += 1;
        sabakiDates.push(row.scheduled_date);
      }
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
      if (row.response_status === "half_holiday") {
        incidents.push({
          dateStr: row.scheduled_date,
          kind: "half_holiday",
          reason: row.half_holiday_reason,
        });
      }
      if (row.response_status === "public_holiday") {
        incidents.push({
          dateStr: row.scheduled_date,
          kind: "public_holiday",
          reason: row.public_holiday_reason,
        });
      }
    }

    incidents.sort((a, b) => a.dateStr.localeCompare(b.dateStr));

    sabakiDates.sort();

    return {
      castId: cast.id,
      name: cast.name,
      attendanceDays,
      dohanCount,
      sabakiCount,
      sabakiDates,
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

  const viewMode: ViewMode =
    searchParams.get("view") === "week" ? "week" : "month";

  const ymFromUrl = parseYmParam(searchParams.get("ym"));
  const [year, setYear] = useState(ymFromUrl?.year ?? defaultYm.year);
  const [month, setMonth] = useState(ymFromUrl?.month ?? defaultYm.month);

  const weekParamRaw = searchParams.get("week")?.trim() ?? "";

  const weekMonday = useMemo(() => {
    if (viewMode !== "week") return getMondayOfJstWeek(today);
    if (weekParamRaw && /^\d{4}-\d{2}-\d{2}$/.test(weekParamRaw)) {
      return getMondayOfJstWeek(weekParamRaw);
    }
    return getMondayOfJstWeek(today);
  }, [viewMode, weekParamRaw, today]);

  useEffect(() => {
    const parsed = parseYmParam(searchParams.get("ym"));
    if (parsed) {
      setYear(parsed.year);
      setMonth(parsed.month);
    }
  }, [searchParams]);

  /** view=week だが week 未指定のとき URL を正規化 */
  useEffect(() => {
    if (viewMode !== "week") return;
    if (weekParamRaw && /^\d{4}-\d{2}-\d{2}$/.test(weekParamRaw)) return;
    const params = new URLSearchParams(searchParams.toString());
    params.set("view", "week");
    params.set("week", weekMonday);
    router.replace(`/admin/report?${params.toString()}`);
  }, [viewMode, weekParamRaw, weekMonday, router, searchParams]);

  const { start, end } = useMemo(() => {
    if (viewMode === "week") {
      return {
        start: weekMonday,
        end: getSundayOfJstWeekFromMonday(weekMonday),
      };
    }
    return getMonthRangeIso(year, month);
  }, [viewMode, weekMonday, year, month]);

  const setMonthParams = useCallback(
    (y: number, m: number) => {
      const params = new URLSearchParams();
      params.set("view", "month");
      params.set("ym", formatYm(y, m));
      router.push(`/admin/report?${params.toString()}`);
    },
    [router]
  );

  const setWeekParams = useCallback(
    (mondayYmd: string) => {
      const params = new URLSearchParams();
      params.set("view", "week");
      params.set("week", getMondayOfJstWeek(mondayYmd));
      router.push(`/admin/report?${params.toString()}`);
    },
    [router]
  );

  const goPrevMonth = useCallback(() => {
    let y = year;
    let mo = month - 1;
    if (mo < 1) {
      mo = 12;
      y -= 1;
    }
    setMonthParams(y, mo);
  }, [year, month, setMonthParams]);

  const goNextMonth = useCallback(() => {
    let y = year;
    let mo = month + 1;
    if (mo > 12) {
      mo = 1;
      y += 1;
    }
    setMonthParams(y, mo);
  }, [year, month, setMonthParams]);

  const goPrevWeek = useCallback(() => {
    setWeekParams(addCalendarDaysJst(weekMonday, -7));
  }, [weekMonday, setWeekParams]);

  const goNextWeek = useCallback(() => {
    setWeekParams(addCalendarDaysJst(weekMonday, 7));
  }, [weekMonday, setWeekParams]);

  const switchToMonth = useCallback(() => {
    const [sy, sm] = weekMonday.split("-").map(Number);
    const params = new URLSearchParams();
    params.set("view", "month");
    params.set("ym", formatYm(sy, sm));
    router.push(`/admin/report?${params.toString()}`);
  }, [weekMonday, router]);

  const switchToWeek = useCallback(() => {
    const anchor = `${year}-${pad2(month)}-01`;
    setWeekParams(getMondayOfJstWeek(anchor));
  }, [year, month, setWeekParams]);

  const [store, setStore] = useState<Store | null>(null);
  const [businessType, setBusinessType] = useState<"cabaret" | "welfare_b">("cabaret");
  const [welfareRows, setWelfareRows] = useState<WelfareReportRow[]>([]);
  const [casts, setCasts] = useState<Cast[]>([]);
  const [schedules, setSchedules] = useState<ScheduleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

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
        supabase.from("stores").select("id, name, business_type").eq("id", tenantId).single(),
      ]);

      if (castsRes.error) throw castsRes.error;
      if (!storesRes.data) {
        setCasts([]);
        setStore(null);
        setSchedules([]);
        setWelfareRows([]);
        setBusinessType("cabaret");
        return;
      }

      const st = storesRes.data as Store;
      setStore(st);
      const bt =
        st.business_type === "welfare_b" ? "welfare_b" : "cabaret";
      setBusinessType(bt);

      if (bt === "welfare_b") {
        setSchedules([]);
        setCasts([]);
        const reportRes = await fetch(
          `/api/admin/report?storeId=${encodeURIComponent(tenantId)}&start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`,
          { credentials: "include" }
        );
        const payload = (await reportRes.json().catch(() => ({}))) as {
          ok?: boolean;
          welfare_rows?: WelfareReportRow[];
          error?: string;
          details?: string;
        };
        if (!reportRes.ok) {
          throw new Error(
            [payload.error, payload.details].filter(Boolean).join(" — ") ||
              "日報データの取得に失敗しました"
          );
        }
        setWelfareRows(Array.isArray(payload.welfare_rows) ? payload.welfare_rows : []);
        return;
      }

      setWelfareRows([]);
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
          "id, cast_id, scheduled_date, is_dohan, is_sabaki, is_absent, is_late, late_reason, absent_reason, public_holiday_reason, half_holiday_reason, response_status"
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
      setWelfareRows([]);
    } finally {
      setLoading(false);
    }
  }, [supabase, start, end, activeStoreId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const reports = useMemo(() => buildCastReports(casts, schedules), [casts, schedules]);

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
        case "sabaki":
          cmp = a.sabakiCount - b.sabakiCount;
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

  const handlePrint = useCallback(() => {
    window.print();
  }, []);

  const titleLabel =
    viewMode === "week"
      ? formatWeekRangeLabel(weekMonday)
      : `${year}年${month}月`;

  const periodKindLabel = viewMode === "week" ? "週間" : "月間";
  const emptyMessage =
    businessType === "welfare_b"
      ? viewMode === "week"
        ? "この週の日報はありません。"
        : "この月の日報はありません。"
      : viewMode === "week"
        ? "この週のシフトデータはありません。"
        : "この月のシフトデータはありません。";

  const hasDetails = (r: CastReport) =>
    r.incidents.length > 0 || r.sabakiDates.length > 0;

  return (
    <div className="admin-report-print-root p-4 sm:p-6">
      <div className="mb-6">
        <h1 className="text-xl sm:text-2xl font-bold text-gray-900">
          {businessType === "welfare_b"
            ? `日報一覧（${periodKindLabel}）`
            : `レポート（${periodKindLabel}集計）`}
        </h1>
        <p className="mt-1 text-sm text-gray-600 print:text-xs">
          {store?.name ?? "店舗"}
          {businessType === "welfare_b"
            ? " · 就労継続支援B型の日次記録（作業・体調）を一覧表示します。"
            : " · 遅刻・休み（欠勤・半休・公休）の理由は、該当がある行を展開して確認できます（表示のみ）。"}
        </p>
      </div>

      <div className="mb-4 flex flex-wrap gap-2 print:hidden">
        <button
          type="button"
          onClick={switchToMonth}
          className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
            viewMode === "month"
              ? "bg-slate-900 text-white shadow"
              : "border border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
          }`}
        >
          月間
        </button>
        <button
          type="button"
          onClick={switchToWeek}
          className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
            viewMode === "week"
              ? "bg-slate-900 text-white shadow"
              : "border border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
          }`}
        >
          週間
        </button>
      </div>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2 print:hidden">
          {viewMode === "month" ? (
            <>
              <button
                type="button"
                onClick={goPrevMonth}
                className="inline-flex items-center rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50"
              >
                ＜ 先月
              </button>
              <span className="min-w-[10rem] text-center text-base font-semibold text-gray-900">
                {titleLabel}
              </span>
              <button
                type="button"
                onClick={goNextMonth}
                className="inline-flex items-center rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50"
              >
                次月 ＞
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={goPrevWeek}
                className="inline-flex items-center rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50"
              >
                ＜ 先週
              </button>
              <span className="min-w-[12rem] text-center text-base font-semibold text-gray-900">
                {titleLabel}
              </span>
              <button
                type="button"
                onClick={goNextWeek}
                className="inline-flex items-center rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50"
              >
                次週 ＞
              </button>
            </>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <p className="text-xs text-gray-500">
            集計期間: {start} 〜 {end}
          </p>
          <button
            type="button"
            onClick={handlePrint}
            className="print:hidden inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-800 shadow-sm hover:bg-gray-50"
          >
            <Printer className="h-4 w-4" aria-hidden />
            PDFで保存（印刷）
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 print:hidden">
          {error}
        </div>
      )}

      {loading ? (
        <p className="text-gray-600">読み込み中…</p>
      ) : businessType === "welfare_b" ? (
        <div className="report-table-wrap report-table-welfare-wrap overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm print:shadow-none print:border print:rounded-none">
          <table className="report-table report-table-welfare min-w-[920px] w-full text-left text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50">
                <th className="px-2 py-2 sm:px-3 sm:py-3 text-xs sm:text-sm font-semibold text-gray-900 whitespace-nowrap">
                  利用者名
                </th>
                <th className="px-2 py-2 sm:px-3 sm:py-3 text-xs sm:text-sm font-semibold text-gray-900 whitespace-nowrap">
                  日付
                </th>
                <th className="px-2 py-2 sm:px-3 sm:py-3 text-xs sm:text-sm font-semibold text-gray-900 whitespace-nowrap">
                  作業開始
                </th>
                <th className="px-2 py-2 sm:px-3 sm:py-3 text-xs sm:text-sm font-semibold text-gray-900 whitespace-nowrap">
                  作業終了
                </th>
                <th className="px-2 py-2 sm:px-3 sm:py-3 text-xs sm:text-sm font-semibold text-gray-900 min-w-[4rem]">
                  作業項目
                </th>
                <th className="px-2 py-2 sm:px-3 sm:py-3 text-xs sm:text-sm font-semibold text-gray-900 min-w-[6rem]">
                  作業内容
                </th>
                <th className="px-2 py-2 sm:px-3 sm:py-3 text-xs sm:text-sm font-semibold text-gray-900 text-right w-12">
                  個数
                </th>
                <th className="px-2 py-2 sm:px-3 sm:py-3 text-xs sm:text-sm font-semibold text-gray-900 whitespace-nowrap">
                  体調
                </th>
                <th className="px-2 py-2 sm:px-3 sm:py-3 text-xs sm:text-sm font-semibold text-gray-900 min-w-[6rem]">
                  体調詳細
                </th>
              </tr>
            </thead>
            <tbody>
              {welfareRows.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-3 py-8 text-center text-gray-500">
                    {emptyMessage}
                  </td>
                </tr>
              ) : (
                welfareRows.map((row) => (
                  <tr
                    key={row.id}
                    className="border-b border-gray-100 hover:bg-gray-50/80 align-top"
                  >
                    <td className="px-2 py-2 sm:px-3 sm:py-3 font-medium text-gray-900">
                      {row.cast_name || "—"}
                    </td>
                    <td className="px-2 py-2 sm:px-3 sm:py-3 tabular-nums text-gray-800 whitespace-nowrap">
                      {row.work_date}
                    </td>
                    <td className="px-2 py-2 sm:px-3 sm:py-3 tabular-nums text-gray-800 whitespace-nowrap">
                      {formatTimeJstFromIso(row.started_at)}
                    </td>
                    <td className="px-2 py-2 sm:px-3 sm:py-3 tabular-nums text-gray-800 whitespace-nowrap">
                      {formatTimeJstFromIso(row.ended_at)}
                    </td>
                    <td className="px-2 py-2 sm:px-3 sm:py-3 text-gray-800 break-words">
                      {row.work_item?.trim() || "—"}
                    </td>
                    <td className="px-2 py-2 sm:px-3 sm:py-3 text-gray-800 break-words">
                      {row.work_details?.trim() || "—"}
                    </td>
                    <td className="px-2 py-2 sm:px-3 sm:py-3 text-right tabular-nums text-gray-800">
                      {row.quantity === null || row.quantity === undefined ? "—" : row.quantity}
                    </td>
                    <td className="px-2 py-2 sm:px-3 sm:py-3 text-gray-800 whitespace-nowrap">
                      {formatHealthCondition(row.health_status)}
                    </td>
                    <td className="px-2 py-2 sm:px-3 sm:py-3 text-gray-800 break-words">
                      {formatHealthNotesCell(row.health_notes, row.health_reason)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="report-table-wrap overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm print:shadow-none print:border print:rounded-none">
          <table className="report-table min-w-[640px] w-full text-left text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50">
                <th className="print:hidden px-1 py-3 w-10" />
                <th className="px-3 py-3">
                  <button
                    type="button"
                    onClick={() => toggleSort("name")}
                    className="print:hidden font-semibold text-gray-900 hover:text-blue-700 inline-flex items-center gap-1"
                  >
                    キャスト
                    {sortKey === "name" && (sortDir === "asc" ? " ↑" : " ↓")}
                  </button>
                  <span className="hidden font-semibold text-gray-900 print:inline">
                    キャスト
                  </span>
                </th>
                <th className="px-3 py-3 text-right">
                  <button
                    type="button"
                    onClick={() => toggleSort("attendance")}
                    className="print:hidden font-semibold text-gray-900 hover:text-blue-700"
                  >
                    出勤日数
                    {sortKey === "attendance" &&
                      (sortDir === "asc" ? " ↑" : " ↓")}
                  </button>
                  <span className="hidden font-semibold text-gray-900 print:inline">
                    出勤日数
                  </span>
                </th>
                <th className="px-3 py-3 text-right">
                  <button
                    type="button"
                    onClick={() => toggleSort("dohan")}
                    className="print:hidden font-semibold text-gray-900 hover:text-blue-700"
                  >
                    同伴
                    {sortKey === "dohan" && (sortDir === "asc" ? " ↑" : " ↓")}
                  </button>
                  <span className="hidden font-semibold text-gray-900 print:inline">
                    同伴
                  </span>
                </th>
                <th className="px-3 py-3 text-right">
                  <button
                    type="button"
                    onClick={() => toggleSort("sabaki")}
                    className="print:hidden font-semibold text-gray-900 hover:text-blue-700"
                    title="捌き出勤の日数"
                  >
                    捌き
                    {sortKey === "sabaki" && (sortDir === "asc" ? " ↑" : " ↓")}
                  </button>
                  <span className="hidden font-semibold text-gray-900 print:inline">
                    捌き
                  </span>
                </th>
                <th className="px-3 py-3 text-right">
                  <button
                    type="button"
                    onClick={() => toggleSort("late")}
                    className="print:hidden font-semibold text-gray-900 hover:text-blue-700"
                  >
                    遅刻
                    {sortKey === "late" && (sortDir === "asc" ? " ↑" : " ↓")}
                  </button>
                  <span className="hidden font-semibold text-gray-900 print:inline">
                    遅刻
                  </span>
                </th>
                <th className="px-3 py-3 text-right">
                  <button
                    type="button"
                    onClick={() => toggleSort("absent")}
                    className="print:hidden font-semibold text-gray-900 hover:text-blue-700"
                  >
                    休み
                    {sortKey === "absent" && (sortDir === "asc" ? " ↑" : " ↓")}
                  </button>
                  <span className="hidden font-semibold text-gray-900 print:inline">
                    休み
                  </span>
                </th>
              </tr>
            </thead>
            <tbody>
              {sortedReports.length === 0 ? (
                <tr>
                  <td
                    colSpan={7}
                    className="px-3 py-8 text-center text-gray-500"
                  >
                    {emptyMessage}
                  </td>
                </tr>
              ) : (
                sortedReports.map((r) => {
                  const open = expanded.has(r.castId);
                  const showToggle = hasDetails(r);
                  return (
                    <Fragment key={r.castId}>
                      <tr className="border-b border-gray-100 hover:bg-gray-50/80">
                        <td className="print:hidden px-1 py-2 text-center">
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
                          <span className="inline-flex items-center gap-1.5 flex-wrap">
                            {r.name}
                            {r.sabakiCount > 0 && (
                              <span
                                className="inline-flex items-center justify-center rounded border border-amber-500 bg-amber-50 px-1.5 py-0.5 text-xs font-semibold text-amber-900 tabular-nums"
                                title="期間内に捌き出勤のシフトあり"
                              >
                                捌
                              </span>
                            )}
                          </span>
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums">
                          {r.attendanceDays}
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums">
                          {r.dohanCount}
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums">
                          {r.sabakiCount}
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums">
                          {r.lateCount}
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums">
                          {r.absentCount}
                        </td>
                      </tr>
                      {showToggle && (
                        <tr
                          className={`report-detail-row bg-gray-50/90 ${open ? "" : "hidden"}`}
                        >
                          <td colSpan={7} className="px-4 py-3 text-sm text-gray-700">
                            <ul className="space-y-2 pl-2 border-l-2 border-blue-200">
                              {r.sabakiDates.length > 0 && (
                                <li className="list-none text-amber-950">
                                  <span className="inline-flex items-center gap-1.5">
                                    <span
                                      className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-amber-600 bg-amber-100 text-xs font-bold text-amber-900"
                                      aria-hidden
                                    >
                                      捌
                                    </span>
                                    <span>
                                      捌き出勤:{" "}
                                      {r.sabakiDates.map(formatJaMonthDay).join("、")}
                                    </span>
                                  </span>
                                </li>
                              )}
                              {r.incidents.map((inc, idx) => {
                                const label =
                                  inc.kind === "late"
                                    ? "遅刻"
                                    : inc.kind === "absent"
                                      ? "欠勤"
                                      : inc.kind === "half_holiday"
                                        ? "半休"
                                        : inc.kind === "public_holiday"
                                          ? "公休"
                                          : "—";
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
  return <div className="p-6 text-gray-600">読み込み中…</div>;
}

export default function AdminReportPage() {
  return (
    <Suspense fallback={<ReportFallback />}>
      <AdminReportContent />
    </Suspense>
  );
}
