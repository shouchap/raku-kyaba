"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createBrowserSupabaseClient } from "@/lib/supabase-client";

type Cast = {
  id: string;
  name: string;
  store_id: string;
};

type Store = {
  id: string;
  name: string;
};

const WEEKDAY_JA = ["日", "月", "火", "水", "木", "金", "土"];

/** 日付を YYYY-MM-DD にフォーマット */
function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** "2026-03-20" → "03/20(日)" */
function formatDateWithWeekday(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00");
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const w = WEEKDAY_JA[d.getDay()];
  return `${m}/${day}(${w})`;
}

/** モバイル用短縮 "20(日)" */
function formatDateShort(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00");
  const day = d.getDate();
  const w = WEEKDAY_JA[d.getDay()];
  return `${day}(${w})`;
}

/** 日付の曜日（0=日, 6=土） */
function getWeekday(dateStr: string): number {
  return new Date(dateStr + "T12:00:00").getDay();
}

/** "20:00:00" → "20:00" に変換 */
function formatTimeDisplay(time: string | null | undefined): string {
  if (!time) return "—";
  const match = String(time).match(/^(\d{1,2}):(\d{2})/);
  return match ? `${match[1]}:${match[2]}` : "—";
}

export default function AdminViewPage() {
  const supabase = useMemo(() => createBrowserSupabaseClient(), []);
  const [casts, setCasts] = useState<Cast[]>([]);
  const [store, setStore] = useState<Store | null>(null);
  const [loading, setLoading] = useState(true);
  const [matrix, setMatrix] = useState<Record<string, Record<string, string>>>({});

  const today = useMemo(() => formatDate(new Date()), []);
  const [baseDate, setBaseDate] = useState(today);

  // 基準日から7日間の日付配列
  const dates = useMemo(() => {
    const result: string[] = [];
    const base = new Date(baseDate);
    for (let i = 0; i < 7; i++) {
      const d = new Date(base);
      d.setDate(d.getDate() + i);
      result.push(formatDate(d));
    }
    return result;
  }, [baseDate]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [castsRes, storesRes] = await Promise.all([
        supabase
          .from("casts")
          .select("id, name, store_id")
          .eq("is_active", true)
          .order("name"),
        supabase.from("stores").select("id, name").limit(1).single(),
      ]);

      if (castsRes.data) setCasts(castsRes.data as Cast[]);
      if (storesRes.data) setStore(storesRes.data as Store);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  const loadSchedules = useCallback(
    async (storeId: string) => {
      const { data } = await supabase
        .from("attendance_schedules")
        .select("cast_id, scheduled_date, scheduled_time")
        .eq("store_id", storeId)
        .in("scheduled_date", dates);

      const next: Record<string, Record<string, string>> = {};
      casts.forEach((c) => {
        next[c.id] = {};
        dates.forEach((d) => {
          next[c.id][d] = "";
        });
      });
      (data ?? []).forEach(
        (row: {
          cast_id: string;
          scheduled_date: string;
          scheduled_time?: string;
        }) => {
          if (next[row.cast_id]) {
            next[row.cast_id][row.scheduled_date] = formatTimeDisplay(
              row.scheduled_time
            );
          }
        }
      );
      setMatrix(next);
    },
    [supabase, casts, dates]
  );

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    if (store && casts.length > 0 && dates.length === 7) {
      loadSchedules(store.id);
    } else if (casts.length > 0 && dates.length === 7) {
      const next: Record<string, Record<string, string>> = {};
      casts.forEach((c) => {
        next[c.id] = {};
        dates.forEach((d) => {
          next[c.id][d] = "—";
        });
      });
      setMatrix(next);
    }
  }, [store, casts, dates, loadSchedules]);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
        <p className="text-gray-500 text-sm sm:text-base">読み込み中...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 py-4 sm:py-6 px-3 sm:px-6">
      <div className="max-w-4xl mx-auto">
        <div className="mb-4 sm:mb-6">
          <h1 className="text-lg sm:text-xl font-bold text-gray-900 mb-1 sm:mb-2">
            週間シフト一覧
          </h1>
          <p className="text-sm text-gray-600">
            {store?.name ?? "店舗"}
          </p>
        </div>

        {/* 基準日選択 */}
        <div className="mb-4 sm:mb-6">
          <label
            htmlFor="base-date"
            className="block text-sm font-medium text-gray-700 mb-2"
          >
            表示する週の基準日
          </label>
          <input
            id="base-date"
            type="date"
            value={baseDate}
            onChange={(e) => setBaseDate(e.target.value)}
            className="w-full sm:w-auto min-h-[44px] h-12 px-4 rounded-lg border border-gray-300 text-base focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
          />
        </div>

        {/* 閲覧専用テーブル（スマホで横スクロール） */}
        <div className="w-full overflow-x-auto -mx-3 sm:mx-0 rounded-lg border border-gray-200 bg-white shadow-sm">
          <table className="min-w-[400px] sm:min-w-[480px] w-full border-collapse">
            <thead>
              <tr className="bg-gray-100">
                <th className="border-b border-r border-gray-200 px-2 py-2 text-left text-[10px] sm:text-xs font-medium text-gray-700 sticky left-0 z-10 bg-gray-100 min-w-[72px] sm:min-w-[100px] border-r shadow-sm">
                  キャスト
                </th>
                {dates.map((d) => {
                  const w = getWeekday(d);
                  const colorClass =
                    w === 0
                      ? "text-red-600"
                      : w === 6
                        ? "text-blue-600"
                        : "text-gray-600";
                  return (
                    <th
                      key={d}
                      className={`border-b border-r border-gray-200 px-1 py-2 text-center text-[10px] sm:text-xs font-medium ${colorClass} whitespace-nowrap min-w-[48px] sm:min-w-0`}
                    >
                      <span className="sm:hidden">{formatDateShort(d)}</span>
                      <span className="hidden sm:inline">
                        {formatDateWithWeekday(d)}
                      </span>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {casts.length === 0 ? (
                <tr>
                  <td
                    colSpan={dates.length + 1}
                    className="px-4 py-8 text-center text-gray-500 text-sm"
                  >
                    キャストが登録されていません。LINEで友だち追加すると自動登録されます。
                  </td>
                </tr>
              ) : (
                casts.map((cast) => (
                  <tr key={cast.id} className="hover:bg-gray-50">
                    <td className="border-b border-r border-gray-200 px-2 py-2 text-[10px] sm:text-xs font-medium text-gray-900 sticky left-0 z-10 bg-white min-w-[72px] sm:min-w-[100px] border-r shadow-sm">
                      {cast.name}
                    </td>
                    {dates.map((dateStr) => (
                      <td
                        key={dateStr}
                        className="border-b border-r border-gray-200 px-2 py-2 text-center text-[10px] sm:text-xs text-gray-700"
                      >
                        {matrix[cast.id]?.[dateStr] || "—"}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {casts.length === 0 && (
          <p className="mt-6 text-sm text-amber-700 bg-amber-50 p-4 rounded-lg">
            キャストが登録されていません。先にキャストを追加してください。
          </p>
        )}
      </div>
    </div>
  );
}
