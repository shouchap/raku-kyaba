"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createBrowserSupabaseClient } from "@/lib/supabase-client";
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
  const supabase = useMemo(() => createBrowserSupabaseClient(), []);
  const [casts, setCasts] = useState<Cast[]>([]);
  const [store, setStore] = useState<Store | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notifying, setNotifying] = useState(false);
  const [notifyingCastId, setNotifyingCastId] = useState<string | null>(null);
  const [notifyStatus, setNotifyStatus] = useState<"idle" | "sending" | "done">("idle");
  const [message, setMessage] = useState<"success" | "error" | null>(null);

  const today = useMemo(() => formatDate(new Date()), []);
  const [baseDate, setBaseDate] = useState(today);

  // マトリックスデータ: matrix[castId][dateStr] = "HH:mm" | ""
  const [matrix, setMatrix] = useState<Record<string, Record<string, string>>>({});

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
      setMessage("error");
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  // 既存シフトの読み込み
  const loadExistingSchedules = useCallback(
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
      (data ?? []).forEach((row: { cast_id: string; scheduled_date: string; scheduled_time?: string }) => {
        if (next[row.cast_id]) {
          next[row.cast_id][row.scheduled_date] = formatTimeForInput(row.scheduled_time);
        }
      });
      setMatrix(next);
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
      casts.forEach((c) => {
        next[c.id] = {};
        dates.forEach((d) => {
          next[c.id][d] = "";
        });
      });
      setMatrix(next);
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
  };

  const handleSave = async () => {
    if (!store) return;

    setSaving(true);
    setMessage(null);

    try {
      // a. 7日間の既存データを DELETE
      const { error: deleteError } = await supabase
        .from("attendance_schedules")
        .delete()
        .eq("store_id", store.id)
        .in("scheduled_date", dates);

      if (deleteError) throw deleteError;

      // b. 時間が入力されているセルを抽出して配列作成
      const toInsert: Array<{
        store_id: string;
        cast_id: string;
        scheduled_date: string;
        scheduled_time: string;
      }> = [];
      casts.forEach((cast) => {
        dates.forEach((dateStr) => {
          const time = matrix[cast.id]?.[dateStr]?.trim();
          if (time) {
            toInsert.push({
              store_id: store.id,
              cast_id: cast.id,
              scheduled_date: dateStr,
              scheduled_time: time.length === 5 ? `${time}:00` : time,
            });
          }
        });
      });

      // c. 一括 INSERT
      if (toInsert.length > 0) {
        const { error: insertError } = await supabase
          .from("attendance_schedules")
          .insert(toInsert);

        if (insertError) throw insertError;
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

  const handleNotifyIndividual = async (castId: string) => {
    setNotifyingCastId(castId);
    try {
      const res = await fetch("/api/admin/notify-individual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ startDate: baseDate, castId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "送信に失敗しました");
    } catch (err) {
      console.error(err);
      alert(err instanceof Error ? err.message : "送信に失敗しました");
    } finally {
      setNotifyingCastId(null);
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
    <div className="min-h-screen bg-gray-50 py-6 px-4 sm:px-6">
      <div className="max-w-4xl mx-auto">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-6">
          <div>
            <h1 className="text-xl font-bold text-gray-900 mb-2">
              週間シフト登録
            </h1>
            <p className="text-sm text-gray-600">
              {store?.name ?? "店舗"}
            </p>
          </div>
          <div className="flex gap-3">
            <Link
              href="/admin/casts"
              className="text-sm text-blue-600 hover:text-blue-700 font-medium"
            >
              キャスト管理へ
            </Link>
            <Link
              href="/admin/settings"
              className="text-sm text-blue-600 hover:text-blue-700 font-medium"
            >
              システム設定
            </Link>
          </div>
        </div>

        {/* 基準日選択 */}
        <div className="mb-6">
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
            className="h-12 px-4 rounded-lg border border-gray-300 text-base focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
          />
        </div>

        {/* マトリックステーブル */}
        <div className="w-full overflow-x-auto rounded-lg border border-gray-200 bg-white shadow-sm">
          <table className="min-w-[480px] w-full border-collapse">
            <thead>
              <tr className="bg-gray-100">
                <th className="border-b border-r border-gray-200 px-2 py-2 text-left text-xs font-medium text-gray-700 sticky left-0 z-10 bg-gray-100 min-w-[100px] border-r shadow-sm">
                  キャスト
                </th>
                {dates.map((d) => {
                  const w = getWeekday(d);
                  const colorClass =
                    w === 0 ? "text-red-600" : w === 6 ? "text-blue-600" : "text-gray-600";
                  return (
                    <th
                      key={d}
                      className={`border-b border-r border-gray-200 px-1 py-2 text-center text-xs font-medium ${colorClass}`}
                    >
                      {formatDateWithWeekday(d)}
                    </th>
                  );
                })}
                <th className="border-b border-gray-200 px-2 py-2 text-center text-xs font-medium text-gray-700 min-w-[80px]">
                  個別送信
                </th>
              </tr>
            </thead>
            <tbody>
              {casts.map((cast) => (
                <tr key={cast.id} className="hover:bg-gray-50">
                  <td className="border-b border-r border-gray-200 px-2 py-1 text-xs font-medium text-gray-900 sticky left-0 z-10 bg-white min-w-[100px] border-r shadow-sm">
                    {cast.name}
                  </td>
                  {dates.map((dateStr) => (
                    <td key={dateStr} className="border-b border-r border-gray-200 p-1">
                      <select
                        value={matrix[cast.id]?.[dateStr] ?? ""}
                        onChange={(e) => updateCell(cast.id, dateStr, e.target.value)}
                        className="w-20 min-w-0 h-9 px-1.5 text-xs border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none bg-white"
                      >
                        {TIME_OPTIONS.map((opt) => (
                          <option key={opt.value || "empty"} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    </td>
                  ))}
                  <td className="border-b border-gray-200 p-1 text-center">
                    <button
                      type="button"
                      onClick={() => handleNotifyIndividual(cast.id)}
                      disabled={
                        saving ||
                        notifying ||
                        notifyingCastId !== null
                      }
                      className="text-xs px-2 py-1.5 rounded border border-[#06C755] text-[#06C755] hover:bg-[#06C755] hover:text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      {notifyingCastId === cast.id
                        ? "送信中..."
                        : "個別送信"}
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

        <div className="mt-6 flex flex-col sm:flex-row gap-4">
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || notifying}
            className="w-full sm:w-auto sm:min-w-[200px] h-12 px-6 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {saving ? "保存中..." : "一括保存する"}
          </button>
          <button
            type="button"
            onClick={handleNotify}
            disabled={saving || notifying || notifyingCastId !== null}
            className="w-full sm:w-auto sm:min-w-[260px] h-12 px-6 py-3 bg-[#06C755] text-white font-medium rounded-lg hover:bg-[#05B34C] focus:ring-2 focus:ring-[#06C755] focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
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
