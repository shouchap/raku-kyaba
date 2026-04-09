"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createBrowserSupabaseClient } from "@/lib/supabase-client";
import { useActiveStoreId } from "@/contexts/ActiveStoreContext";
import { getTodayJst } from "@/lib/date-utils";
import {
  mergeScheduleRowForWeeklyUpsert,
  scheduleRowHasLineAttendanceData,
} from "@/lib/attendance-schedule-preserve";
import { TIME_OPTIONS } from "@/lib/time-options";

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
function formatTimeForInput(time: string | null | undefined): string {
  if (!time) return "";
  const match = String(time).match(/^(\d{1,2}):(\d{2})/);
  return match ? `${match[1]}:${match[2]}` : "";
}

export default function AdminWeeklyPage() {
  const activeStoreId = useActiveStoreId();
  const supabase = useMemo(() => createBrowserSupabaseClient(), []);
  const [casts, setCasts] = useState<Cast[]>([]);
  const [store, setStore] = useState<Store | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notifying, setNotifying] = useState(false);
  const [notifyingOp, setNotifyingOp] = useState<{
    castId: string;
    isUpdate: boolean;
  } | null>(null);
  const [notifyStatus, setNotifyStatus] = useState<"idle" | "sending" | "done">("idle");
  const [message, setMessage] = useState<"success" | "error" | null>(null);

  const today = useMemo(() => getTodayJst(), []);
  const [baseDate, setBaseDate] = useState(today);

  // マトリックスデータ: matrix[castId][dateStr] = "HH:mm" | ""
  const [matrix, setMatrix] = useState<Record<string, Record<string, string>>>({});
  // 同伴フラグ: dohan[castId][dateStr] = boolean（出勤時間がある場合のみ意味を持つ）
  const [dohan, setDohan] = useState<Record<string, Record<string, boolean>>>({});
  const [sabaki, setSabaki] = useState<Record<string, Record<string, boolean>>>({});

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

  // データ取得（キャスト・店舗・既存シフト）
  const fetchData = useCallback(async () => {
    setLoading(true);
    const storeId = activeStoreId;
    try {
      const [castsRes, storesRes] = await Promise.all([
        supabase
          .from("casts")
          .select("id, name, store_id")
          .eq("store_id", storeId)
          .eq("is_active", true)
          .order("name"),
        supabase.from("stores").select("id, name").eq("id", storeId).single(),
      ]);

      if (castsRes.data) setCasts(castsRes.data as Cast[]);
      if (storesRes.data) setStore(storesRes.data as Store);
    } catch (err) {
      console.error(err);
      setMessage("error");
    } finally {
      setLoading(false);
    }
  }, [supabase, activeStoreId]);

  // 既存シフトの読み込み（scheduled_time・is_dohan・is_sabaki を取得）
  const loadExistingSchedules = useCallback(
    async (storeId: string) => {
      const { data } = await supabase
        .from("attendance_schedules")
        .select("cast_id, scheduled_date, scheduled_time, is_dohan, is_sabaki")
        .eq("store_id", storeId)
        .in("scheduled_date", dates);

      const nextMatrix: Record<string, Record<string, string>> = {};
      const nextDohan: Record<string, Record<string, boolean>> = {};
      const nextSabaki: Record<string, Record<string, boolean>> = {};
      casts.forEach((c) => {
        nextMatrix[c.id] = {};
        nextDohan[c.id] = {};
        nextSabaki[c.id] = {};
        dates.forEach((d) => {
          nextMatrix[c.id][d] = "";
          nextDohan[c.id][d] = false;
          nextSabaki[c.id][d] = false;
        });
      });
      (data ?? []).forEach(
        (row: {
          cast_id: string;
          scheduled_date: string;
          scheduled_time?: string;
          is_dohan?: boolean;
          is_sabaki?: boolean;
        }) => {
          if (nextMatrix[row.cast_id]) {
            nextMatrix[row.cast_id][row.scheduled_date] = formatTimeForInput(row.scheduled_time);
            nextDohan[row.cast_id][row.scheduled_date] = Boolean(row.is_dohan);
            nextSabaki[row.cast_id][row.scheduled_date] = Boolean(row.is_sabaki);
          }
        }
      );
      setMatrix(nextMatrix);
      setDohan(nextDohan);
      setSabaki(nextSabaki);
    },
    [supabase, casts, dates]
  );

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    if (store && casts.length > 0 && dates.length === 7) {
      loadExistingSchedules(store.id);
    } else if (casts.length > 0 && dates.length === 7) {
      // 店舗がまだ無い場合の空マトリックス初期化
      const next: Record<string, Record<string, string>> = {};
      const nextDohan: Record<string, Record<string, boolean>> = {};
      const nextSabaki: Record<string, Record<string, boolean>> = {};
      casts.forEach((c) => {
        next[c.id] = {};
        nextDohan[c.id] = {};
        nextSabaki[c.id] = {};
        dates.forEach((d) => {
          next[c.id][d] = "";
          nextDohan[c.id][d] = false;
          nextSabaki[c.id][d] = false;
        });
      });
      setMatrix(next);
      setDohan(nextDohan);
      setSabaki(nextSabaki);
    }
  }, [store, casts, dates, loadExistingSchedules]);

  const updateCell = (castId: string, dateStr: string, value: string) => {
    setMatrix((prev) => ({
      ...prev,
      [castId]: {
        ...(prev[castId] ?? {}),
        [dateStr]: value,
      },
    }));
    // 時間をクリアした場合は同伴もオフにする（整合性維持）
    if (!value.trim()) {
      setDohan((prev) => ({
        ...prev,
        [castId]: { ...(prev[castId] ?? {}), [dateStr]: false },
      }));
      setSabaki((prev) => ({
        ...prev,
        [castId]: { ...(prev[castId] ?? {}), [dateStr]: false },
      }));
    }
  };

  /** 同伴トグル。出勤時間があるセルのみ有効 */
  const toggleDohan = (castId: string, dateStr: string) => {
    const time = matrix[castId]?.[dateStr]?.trim();
    if (!time) return;
    setDohan((prev) => ({
      ...prev,
      [castId]: {
        ...(prev[castId] ?? {}),
        [dateStr]: !(prev[castId]?.[dateStr] ?? false),
      },
    }));
  };

  /** 捌きトグル。出勤時間があるセルのみ有効 */
  const toggleSabaki = (castId: string, dateStr: string) => {
    const time = matrix[castId]?.[dateStr]?.trim();
    if (!time) return;
    setSabaki((prev) => ({
      ...prev,
      [castId]: {
        ...(prev[castId] ?? {}),
        [dateStr]: !(prev[castId]?.[dateStr] ?? false),
      },
    }));
  };

  const handleSave = async () => {
    if (!store) return;

    setSaving(true);
    setMessage(null);

    try {
      /**
       * 以前は週の日付範囲を一括 DELETE していたため、LINE で確定した公休・半休等の
       * response_status が消え月間レポートが 0 になる問題があった。
       * シフト枠（時刻・同伴・捌き）のみ更新し、勤怠回答はマージして保持する。
       */
      const { data: existingRows, error: fetchErr } = await supabase
        .from("attendance_schedules")
        .select("*")
        .eq("store_id", store.id)
        .in("scheduled_date", dates);

      if (fetchErr) throw fetchErr;

      const prevByKey = new Map<string, Record<string, unknown>>();
      for (const r of existingRows ?? []) {
        const row = r as Record<string, unknown>;
        const cid = String(row.cast_id ?? "");
        const d = String(row.scheduled_date ?? "");
        if (cid && d) prevByKey.set(`${cid}_${d}`, row);
      }

      const toUpsert: Record<string, unknown>[] = [];
      casts.forEach((cast) => {
        dates.forEach((dateStr) => {
          const time = matrix[cast.id]?.[dateStr]?.trim();
          if (!time) return;
          const key = `${cast.id}_${dateStr}`;
          const prev = prevByKey.get(key);
          const merged = mergeScheduleRowForWeeklyUpsert(
            {
              store_id: store.id,
              cast_id: cast.id,
              scheduled_date: dateStr,
              scheduled_time: time.length === 5 ? `${time}:00` : time,
              is_dohan: dohan[cast.id]?.[dateStr] ?? false,
              is_sabaki: sabaki[cast.id]?.[dateStr] ?? false,
            },
            prev
          );
          toUpsert.push(merged);
        });
      });

      if (toUpsert.length > 0) {
        const { error: upErr } = await supabase.from("attendance_schedules").upsert(toUpsert, {
          onConflict: "store_id,cast_id,scheduled_date",
        });
        if (upErr) throw upErr;
      }

      const nowIso = new Date().toISOString();
      const matrixHasTime = new Set<string>();
      casts.forEach((cast) => {
        dates.forEach((dateStr) => {
          const time = matrix[cast.id]?.[dateStr]?.trim();
          if (time) matrixHasTime.add(`${cast.id}_${dateStr}`);
        });
      });

      for (const r of existingRows ?? []) {
        const row = r as Record<string, unknown>;
        const cid = String(row.cast_id ?? "");
        const d = String(row.scheduled_date ?? "");
        const key = `${cid}_${d}`;
        if (matrixHasTime.has(key)) continue;

        const id = String(row.id ?? "");
        if (!id) continue;

        if (scheduleRowHasLineAttendanceData(row)) {
          const { error: clearErr } = await supabase
            .from("attendance_schedules")
            .update({
              scheduled_time: null,
              is_dohan: false,
              is_sabaki: false,
              updated_at: nowIso,
            })
            .eq("id", id);
          if (clearErr) throw clearErr;
        } else {
          const { error: delErr } = await supabase.from("attendance_schedules").delete().eq("id", id);
          if (delErr) throw delErr;
        }
      }

      setMessage("success");
    } catch (err) {
      console.error(err);
      setMessage("error");
    } finally {
      setSaving(false);
    }
  };

  const handleNotify = async () => {
    setNotifying(true);
    setNotifyStatus("sending");
    try {
      const res = await fetch("/api/admin/notify-weekly", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ startDate: baseDate }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "送信に失敗しました");
      setNotifyStatus("done");
      setTimeout(() => setNotifyStatus("idle"), 2500);
    } catch (err) {
      console.error(err);
      setNotifyStatus("idle");
      alert(err instanceof Error ? err.message : "送信に失敗しました");
    } finally {
      setNotifying(false);
    }
  };

  const handleNotifyIndividual = async (castId: string, isUpdate: boolean) => {
    setNotifyingOp({ castId, isUpdate });
    try {
      const res = await fetch("/api/admin/notify-individual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          startDate: baseDate,
          castId,
          is_update: isUpdate,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "送信に失敗しました");
    } catch (err) {
      console.error(err);
      alert(err instanceof Error ? err.message : "送信に失敗しました");
    } finally {
      setNotifyingOp(null);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-gray-500">読み込み中...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 py-4 sm:py-6 px-3 sm:px-6">
      <div className="max-w-4xl mx-auto">
        <div className="mb-4 sm:mb-6">
          <h1 className="text-lg sm:text-xl font-bold text-gray-900 mb-1 sm:mb-2">
            週間シフト登録
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
            基準日（週の開始日）
          </label>
          <input
            id="base-date"
            type="date"
            value={baseDate}
            onChange={(e) => setBaseDate(e.target.value)}
            className="w-full sm:w-auto min-h-[44px] h-12 px-4 rounded-lg border border-gray-300 text-base focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
          />
        </div>

        {/* マトリックステーブル（スマホで横スクロール） */}
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
                    w === 0 ? "text-red-600" : w === 6 ? "text-blue-600" : "text-gray-600";
                  return (
                    <th
                      key={d}
                      className={`border-b border-r border-gray-200 px-1 py-2 text-center text-[10px] sm:text-xs font-medium ${colorClass} whitespace-nowrap min-w-[48px] sm:min-w-0`}
                    >
                      <span className="sm:hidden">{formatDateShort(d)}</span>
                      <span className="hidden sm:inline">{formatDateWithWeekday(d)}</span>
                    </th>
                  );
                })}
                <th className="border-b border-r border-gray-200 px-1 sm:px-2 py-2 text-center text-[10px] sm:text-xs font-medium text-gray-700 min-w-[56px] sm:min-w-[72px]">
                  個別
                </th>
                <th className="border-b border-gray-200 px-1 sm:px-2 py-2 text-center text-[10px] sm:text-xs font-medium text-gray-700 min-w-[56px] sm:min-w-[72px]">
                  変更通知
                </th>
              </tr>
            </thead>
            <tbody>
              {casts.map((cast) => (
                <tr key={cast.id} className="hover:bg-gray-50">
                  <td className="border-b border-r border-gray-200 px-2 py-1 text-[10px] sm:text-xs font-medium text-gray-900 sticky left-0 z-10 bg-white min-w-[72px] sm:min-w-[100px] border-r shadow-sm">
                    {cast.name}
                  </td>
                  {dates.map((dateStr) => {
                    const hasTime = Boolean(matrix[cast.id]?.[dateStr]?.trim());
                    const isDohanOn = dohan[cast.id]?.[dateStr] ?? false;
                    const isSabakiOn = sabaki[cast.id]?.[dateStr] ?? false;
                    return (
                      <td key={dateStr} className="border-b border-r border-gray-200 p-0.5 sm:p-1">
                        <div className="flex flex-col gap-0.5">
                          <select
                            value={matrix[cast.id]?.[dateStr] ?? ""}
                            onChange={(e) => updateCell(cast.id, dateStr, e.target.value)}
                            className="w-full min-w-[56px] sm:w-20 min-h-[36px] sm:h-9 px-1 sm:px-1.5 text-[10px] sm:text-xs border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none bg-white"
                          >
                            {TIME_OPTIONS.map((opt) => (
                              <option key={opt.value || "empty"} value={opt.value}>
                                {opt.label}
                              </option>
                            ))}
                          </select>
                          {/* 同伴・捌き: 出勤時間がある場合のみ */}
                          {hasTime && (
                            <div className="flex gap-0.5">
                              <button
                                type="button"
                                onClick={() => toggleDohan(cast.id, dateStr)}
                                className={`flex-1 min-h-[24px] text-[9px] sm:text-[10px] px-0.5 py-0.5 rounded border touch-manipulation transition-colors ${
                                  isDohanOn
                                    ? "bg-pink-500 border-pink-600 text-white font-medium"
                                    : "bg-white border-gray-300 text-gray-600 hover:bg-gray-50"
                                }`}
                              >
                                同伴
                              </button>
                              <button
                                type="button"
                                onClick={() => toggleSabaki(cast.id, dateStr)}
                                className={`flex-1 min-h-[24px] text-[9px] sm:text-[10px] px-0.5 py-0.5 rounded border touch-manipulation transition-colors ${
                                  isSabakiOn
                                    ? "bg-amber-600 border-amber-700 text-white font-medium"
                                    : "bg-white border-gray-300 text-gray-600 hover:bg-gray-50"
                                }`}
                              >
                                捌き
                              </button>
                            </div>
                          )}
                        </div>
                      </td>
                    );
                  })}
                  <td className="border-b border-r border-gray-200 p-0.5 sm:p-1 text-center align-top">
                    <button
                      type="button"
                      onClick={() => handleNotifyIndividual(cast.id, false)}
                      disabled={saving || notifying || notifyingOp !== null}
                      className="w-full text-[10px] sm:text-xs px-1 sm:px-1.5 py-2 sm:py-1.5 min-h-[36px] rounded border border-[#06C755] text-[#06C755] hover:bg-[#06C755] hover:text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors touch-manipulation"
                    >
                      {notifyingOp?.castId === cast.id && !notifyingOp.isUpdate
                        ? "送信中..."
                        : "個別"}
                    </button>
                  </td>
                  <td className="border-b border-gray-200 p-0.5 sm:p-1 text-center align-top">
                    <button
                      type="button"
                      onClick={() => handleNotifyIndividual(cast.id, true)}
                      disabled={saving || notifying || notifyingOp !== null}
                      className="w-full text-[10px] sm:text-xs px-1 sm:px-1.5 py-2 sm:py-1.5 min-h-[36px] rounded border border-orange-500 text-orange-600 hover:bg-orange-500 hover:text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors touch-manipulation"
                    >
                      {notifyingOp?.castId === cast.id && notifyingOp.isUpdate
                        ? "送信中..."
                        : "変更通知"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {message === "success" && (
          <p className="mt-4 text-green-600 text-sm font-medium">
            保存しました
          </p>
        )}
        {message === "error" && (
          <p className="mt-4 text-red-600 text-sm">
            保存に失敗しました。再度お試しください。
          </p>
        )}

        <div className="mt-4 sm:mt-6 flex flex-col sm:flex-row gap-3 sm:gap-4">
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || notifying}
            className="w-full sm:w-auto sm:min-w-[200px] min-h-[48px] h-12 px-6 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors touch-manipulation"
          >
            {saving ? "保存中..." : "一括保存する"}
          </button>
          <button
            type="button"
            onClick={handleNotify}
            disabled={saving || notifying || notifyingOp !== null}
            className="w-full sm:w-auto sm:min-w-[260px] min-h-[48px] h-12 px-6 py-3 bg-[#06C755] text-white font-medium rounded-lg hover:bg-[#05B34C] focus:ring-2 focus:ring-[#06C755] focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors whitespace-nowrap touch-manipulation"
          >
            {notifying
              ? notifyStatus === "done"
                ? "送信完了"
                : "送信中..."
              : "確定シフトをLINEで一斉通知"}
          </button>
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
