"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { createBrowserSupabaseClient } from "@/lib/supabase-client";
import { useActiveStoreId } from "@/contexts/ActiveStoreContext";
import { getTodayJst } from "@/lib/date-utils";
import { formatScheduleTimeLabel } from "@/lib/attendance-remind-flex";
import { SubmitSuccessToast } from "./SubmitSuccessToast";

/** 未返信アラートを出すまでの経過時間（時間） */
const ALERT_HOURS = 6;

type Cast = {
  id: string;
  name: string;
  store_id: string;
};

type Store = {
  id: string;
  name: string;
  allow_shift_submission?: boolean | null;
};

/** セル表示用データ */
type CellData = {
  time: string;
  lastRemindedAt: string | null;
  /** 回答ステータス。null は未回答 */
  responseStatus:
    | "attending"
    | "late"
    | "absent"
    | "public_holiday"
    | "half_holiday"
    | null;
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

/** last_reminded_at から ALERT_HOURS 時間以上経過しているか */
function isOverAlertHours(lastRemindedAt: string | null): boolean {
  if (!lastRemindedAt) return false;
  const reminded = new Date(lastRemindedAt).getTime();
  const now = Date.now();
  return now - reminded >= ALERT_HOURS * 60 * 60 * 1000;
}

/**
 * 時間表示文字列（"20:00" / "20:00（同伴）" 等）から HH:mm を抽出し、
 * 分単位の数値（0〜1439）に変換。休み（—/ー/空）の場合は null。
 * ソート用の比較可能な値として使用する。
 */
function parseTimeToMinutes(timeStr: string | null | undefined): number | null {
  if (timeStr == null || typeof timeStr !== "string") return null;
  const trimmed = timeStr.trim();
  if (!trimmed || trimmed === "—" || trimmed === "ー") return null;
  const match = trimmed.match(/^(\d{1,2}):(\d{2})/);
  if (!match) return null;
  const h = parseInt(match[1], 10);
  const m = parseInt(match[2], 10);
  if (isNaN(h) || isNaN(m) || h < 0 || h > 23 || m < 0 || m > 59) return null;
  return h * 60 + m;
}

export default function AdminViewPage() {
  const activeStoreId = useActiveStoreId();
  const supabase = useMemo(
    () => createBrowserSupabaseClient({ fetchNoStore: true }),
    []
  );
  const [casts, setCasts] = useState<Cast[]>([]);
  const [store, setStore] = useState<Store | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingImage, setSavingImage] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [matrix, setMatrix] = useState<Record<string, Record<string, CellData>>>({});
  const captureRef = useRef<HTMLDivElement>(null);

  const today = useMemo(() => getTodayJst(), []); // 日本時間の今日
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

  // 基準日（dates[0]）の出勤時間でソート。休みは下。同着は名前で二次ソート
  const sortedCasts = useMemo(() => {
    const baseDateStr = dates[0];
    if (!baseDateStr) return [...casts];

    return [...casts].sort((a, b) => {
      const timeA = matrix[a.id]?.[baseDateStr]?.time;
      const timeB = matrix[b.id]?.[baseDateStr]?.time;
      const minutesA = parseTimeToMinutes(timeA);
      const minutesB = parseTimeToMinutes(timeB);

      // 休み（null）は出勤より下に配置
      const sortValA = minutesA ?? 9999;
      const sortValB = minutesB ?? 9999;
      if (sortValA !== sortValB) return sortValA - sortValB;

      // 同着: 名前の五十音順、さらに名前が同じなら ID
      return a.name.localeCompare(b.name, "ja") || a.id.localeCompare(b.id);
    });
  }, [casts, dates, matrix]);

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
        supabase
          .from("stores")
          .select("id, name, allow_shift_submission")
          .eq("id", storeId)
          .single(),
      ]);

      if (castsRes.data) setCasts(castsRes.data as Cast[]);
      if (storesRes.data) setStore(storesRes.data as Store);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [supabase, activeStoreId]);

  const loadSchedules = useCallback(
    async (storeId: string) => {
      const { data: schedulesData } = await supabase
        .from("attendance_schedules")
        .select("cast_id, scheduled_date, scheduled_time, is_dohan, is_sabaki, last_reminded_at, response_status")
        .eq("store_id", storeId)
        .in("scheduled_date", dates);

      const schedulesRes = { data: schedulesData };

      const schedules = (schedulesRes.data ?? []) as Array<{
        cast_id: string;
        scheduled_date: string;
        scheduled_time?: string | null;
        is_dohan?: boolean | null;
        is_sabaki?: boolean | null;
        last_reminded_at?: string | null;
        response_status?:
          | "attending"
          | "late"
          | "absent"
          | "public_holiday"
          | "half_holiday"
          | null;
      }>;

      const next: Record<string, Record<string, CellData>> = {};
      casts.forEach((c) => {
        next[c.id] = {};
        dates.forEach((d) => {
          next[c.id][d] = {
            time: "",
            lastRemindedAt: null,
            responseStatus: null,
          };
        });
      });

      // attendance_schedules の response_status を優先（Webhook で更新済み）
      schedules.forEach((row) => {
        if (next[row.cast_id]?.[row.scheduled_date]) {
          const status =
            row.response_status === "attending" ||
            row.response_status === "late" ||
            row.response_status === "absent" ||
            row.response_status === "half_holiday" ||
            row.response_status === "public_holiday"
              ? row.response_status
              : null;
          next[row.cast_id][row.scheduled_date] = {
            time: formatScheduleTimeLabel(row.scheduled_time, row.is_dohan, row.is_sabaki),
            lastRemindedAt: row.last_reminded_at ?? null,
            responseStatus: status,
          };
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
      loadSchedules(store.id);
    } else if (casts.length > 0 && dates.length === 7) {
      const next: Record<string, Record<string, CellData>> = {};
      casts.forEach((c) => {
        next[c.id] = {};
        dates.forEach((d) => {
          next[c.id][d] = {
            time: "—",
            lastRemindedAt: null,
            responseStatus: null,
          };
        });
      });
      setMatrix(next);
    }
  }, [store, casts, dates, loadSchedules]);

  const handleSaveAsImage = useCallback(async () => {
    const el = captureRef.current;
    if (!el) return;
    setSavingImage(true);
    setCapturing(true);
    try {
      await new Promise((r) => setTimeout(r, 50));
      const { toPng } = await import("html-to-image");
      const dataUrl = await toPng(el, {
        pixelRatio: 2,
        backgroundColor: "#ffffff",
        style: { margin: "0" },
      });
      const link = document.createElement("a");
      link.download = `シフト一覧_${baseDate}.png`;
      link.href = dataUrl;
      link.click();
    } catch (err) {
      console.error("[View] 画像保存エラー:", err);
      alert("画像の保存に失敗しました。");
    } finally {
      setCapturing(false);
      setSavingImage(false);
    }
  }, [baseDate, dates]);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
        <p className="text-gray-500 text-sm sm:text-base">読み込み中...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 py-4 sm:py-6 px-3 sm:px-6">
      <Suspense fallback={null}>
        <SubmitSuccessToast />
      </Suspense>
      <div className="max-w-4xl mx-auto">
        <div className="mb-4 sm:mb-6">
          <h1 className="text-lg sm:text-xl font-bold text-gray-900 mb-1 sm:mb-2">
            週間シフト一覧
          </h1>
          <p className="text-sm text-gray-600">
            {store?.name ?? "店舗"}
          </p>
        </div>

        {store?.allow_shift_submission === true && (
          <div className="mb-4 sm:mb-6 rounded-xl border-2 border-amber-300 bg-gradient-to-br from-amber-50 to-orange-50 p-4 shadow-sm">
            <p className="text-xs text-amber-900/80 mb-3 text-center font-medium">
              シフト提出（プレビュー）
            </p>
            <div className="flex justify-center">
              <Link
                href={`/admin/view/submit?storeId=${encodeURIComponent(activeStoreId)}`}
                className="inline-flex min-h-[48px] items-center justify-center rounded-xl bg-amber-600 px-6 py-3 text-sm font-semibold text-white shadow-md transition hover:bg-amber-700 active:bg-amber-800 touch-manipulation"
              >
                [開発中] 来週のシフトを提出する
              </Link>
            </div>
          </div>
        )}

        {/* 基準日選択 */}
        <div className="mb-4 sm:mb-6 flex flex-col sm:flex-row sm:items-end gap-4">
          <div>
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
          <button
            type="button"
            onClick={handleSaveAsImage}
            disabled={savingImage || sortedCasts.length === 0}
            className="min-h-[44px] px-4 py-2 rounded-lg border border-gray-300 bg-white text-sm font-medium text-gray-700 hover:bg-gray-50 focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors touch-manipulation flex items-center gap-2"
          >
            {savingImage ? "保存中..." : "画像で保存"}
          </button>
        </div>

        {/* キャプチャ用ラッパー（画像保存時にこの範囲をキャプチャ） */}
        <div
          ref={captureRef}
          className={`bg-white p-4 rounded-lg border border-gray-200 ${capturing ? "overflow-visible w-max" : ""}`}
        >
          <div className="text-sm font-medium text-gray-700 mb-2">
            {store?.name ?? "店舗"} 週間シフト {baseDate} 〜 {dates[6] ? formatDateWithWeekday(dates[6]) : ""}
          </div>
          {/* 閲覧専用テーブル（通常時は横スクロール、キャプチャ時は全幅表示） */}
          <div className={`rounded border border-gray-200 ${capturing ? "overflow-visible" : "w-full overflow-x-auto -mx-3 sm:mx-0"}`}>
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
                      {d === today && (
                        <span className="block text-[9px] text-amber-600 font-normal mt-0.5">
                          今日
                        </span>
                      )}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {sortedCasts.length === 0 ? (
                <tr>
                  <td
                    colSpan={dates.length + 1}
                    className="px-4 py-8 text-center text-gray-500 text-sm"
                  >
                    キャストが登録されていません。LINEで友だち追加すると自動登録されます。
                  </td>
                </tr>
              ) : (
                sortedCasts.map((cast) => (
                  <tr key={cast.id} className="hover:bg-gray-50">
                    <td className="border-b border-r border-gray-200 px-2 py-2 text-[10px] sm:text-xs font-medium text-gray-900 sticky left-0 z-10 bg-white min-w-[72px] sm:min-w-[100px] border-r shadow-sm">
                      {cast.name}
                    </td>
                    {dates.map((dateStr) => {
                      const cell = matrix[cast.id]?.[dateStr];
                      const timeDisplay = cell?.time || "—";
                      const isToday = dateStr === today;
                      const showReminderBadge =
                        isToday && cell?.lastRemindedAt;
                      const hasResponse = cell?.responseStatus != null;
                      const showUnansweredAlert =
                        showReminderBadge &&
                        isOverAlertHours(cell?.lastRemindedAt ?? null) &&
                        !hasResponse;

                      // ステータスバッジ: 回答済みは🟢出勤/🟡遅刻/🔴欠勤、未返信は⚠️、送信済のみは✅
                      const statusBadge = hasResponse
                        ? cell!.responseStatus === "attending"
                          ? "🟢出勤"
                          : cell!.responseStatus === "late"
                            ? "🟡遅刻"
                            : cell!.responseStatus === "absent"
                              ? "🔴欠勤"
                              : cell!.responseStatus === "half_holiday"
                                ? "🟠半休"
                                : cell!.responseStatus === "public_holiday"
                                  ? "🟣公休"
                                  : "—"
                        : showUnansweredAlert
                          ? "⚠️未返信"
                          : showReminderBadge
                            ? "✅"
                            : null;

                      return (
                        <td
                          key={dateStr}
                          className="border-b border-r border-gray-200 px-2 py-2 text-center text-[10px] sm:text-xs text-gray-700"
                        >
                          <div className="flex flex-col items-center gap-0.5">
                            <span>{timeDisplay}</span>
                            {statusBadge && cell && (
                              <span
                                title={
                                  showUnansweredAlert
                                    ? `送信済（${new Date(cell.lastRemindedAt!).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })}）／${ALERT_HOURS}時間以上経過・未返信`
                                    : hasResponse
                                      ? `回答済: ${statusBadge}`
                                      : `送信済（${new Date(cell.lastRemindedAt!).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })}）`
                                }
                                className={
                                  showUnansweredAlert
                                    ? "text-red-600 font-medium text-[9px] sm:text-[10px]"
                                    : "text-gray-500 text-[9px] sm:text-[10px]"
                                }
                              >
                                {statusBadge}
                              </span>
                            )}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))
              )}
            </tbody>
          </table>
          </div>
          {sortedCasts.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-gray-500">
              <span title="リマインド送信済み">✅ 送信済</span>
              <span
                className="text-red-600"
                title={`送信から${ALERT_HOURS}時間以上経過・未返信`}
              >
                ⚠️ 未返信
              </span>
              <span title="回答済み">🟢出勤 🟡遅刻 🔴欠勤 🟠半休 🟣公休</span>
            </div>
          )}
        </div>

        {sortedCasts.length === 0 && (
          <p className="mt-6 text-sm text-amber-700 bg-amber-50 p-4 rounded-lg">
            キャストが登録されていません。先にキャストを追加してください。
          </p>
        )}
      </div>
    </div>
  );
}
