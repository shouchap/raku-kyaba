"use client";

import { useCallback, useEffect, useState } from "react";

export type StoreAttendanceHistoryRow = {
  id: string;
  created_at: string;
  action_type: string;
  editor_display_name: string;
  cast_name: string;
  attended_date: string | null;
  detail_summary: string;
};

function formatShortJaDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
}

function formatTargetYmd(ymd: string | null): string {
  if (!ymd || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return "—";
  const [, m, day] = ymd.split("-").map(Number);
  if (!m || !day) return ymd;
  return `${m}/${day}`;
}

function actionBadge(actionType: string): { label: string; className: string } {
  const a = String(actionType ?? "").toUpperCase();
  if (a === "INSERT")
    return { label: "新規追加", className: "bg-emerald-100 text-emerald-900 ring-emerald-200" };
  if (a === "DELETE") return { label: "削除", className: "bg-red-100 text-red-900 ring-red-200" };
  return { label: "更新", className: "bg-blue-100 text-blue-900 ring-blue-200" };
}

export type StoreAttendanceEditHistoryModalProps = {
  open: boolean;
  storeId: string;
  onClose: () => void;
};

export function StoreAttendanceEditHistoryModal({
  open,
  storeId,
  onClose,
}: StoreAttendanceEditHistoryModalProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<StoreAttendanceHistoryRow[]>([]);

  const fetchHistories = useCallback(async () => {
    if (!open || !storeId) return;
    setLoading(true);
    setError(null);
    try {
      const url = `/api/admin/store-edit-histories?storeId=${encodeURIComponent(storeId)}&limit=50`;
      const res = await fetch(url, { credentials: "include" });
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        histories?: StoreAttendanceHistoryRow[];
        error?: string;
        details?: string;
      };
      if (!res.ok) {
        throw new Error([body.error, body.details].filter(Boolean).join(" — "));
      }
      setRows(Array.isArray(body.histories) ? body.histories : []);
    } catch (e) {
      setRows([]);
      setError(e instanceof Error ? e.message : "履歴の取得に失敗しました");
    } finally {
      setLoading(false);
    }
  }, [open, storeId]);

  useEffect(() => {
    if (!open) return;
    void fetchHistories();
  }, [open, fetchHistories]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[85] flex items-center justify-center p-4 bg-black/45 print:hidden"
      role="dialog"
      aria-modal="true"
      aria-labelledby="store-attendance-history-title"
    >
      <div className="bg-white rounded-xl shadow-xl max-w-5xl w-full max-h-[90vh] overflow-hidden flex flex-col border border-gray-200">
        <div className="px-4 py-3 border-b border-gray-100 flex flex-wrap items-center justify-between gap-2 bg-slate-50/90">
          <h2 id="store-attendance-history-title" className="text-base font-bold text-gray-900">
            🕒 勤怠の編集履歴（店舗全体）
          </h2>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void fetchHistories()}
              disabled={loading}
              className="text-xs font-semibold text-blue-700 hover:text-blue-900 px-2 py-1 rounded-md border border-blue-200 bg-white disabled:opacity-50"
            >
              再読込
            </button>
            <button
              type="button"
              onClick={onClose}
              className="text-sm text-gray-600 hover:text-gray-900 px-2 py-1 rounded-md hover:bg-gray-200/80"
            >
              閉じる
            </button>
          </div>
        </div>

        <p className="px-4 py-2 text-xs text-gray-600 border-b border-gray-100 bg-gray-50/50">
          直近50件を新しい順に表示しています（手動の新規・更新・削除）。
        </p>

        <div className="flex-1 overflow-auto">
          {loading && rows.length === 0 ? (
            <p className="p-6 text-sm text-gray-600">読み込み中…</p>
          ) : error ? (
            <p className="p-6 text-sm text-red-700">{error}</p>
          ) : rows.length === 0 ? (
            <p className="p-6 text-sm text-gray-600">表示できる履歴がありません。</p>
          ) : (
            <table className="min-w-[760px] w-full text-left text-xs sm:text-sm border-collapse">
              <thead className="sticky top-0 bg-gray-100 border-b border-gray-200 z-[1]">
                <tr className="text-gray-800">
                  <th className="px-3 py-2 font-semibold whitespace-nowrap">操作日時</th>
                  <th className="px-3 py-2 font-semibold whitespace-nowrap">操作者</th>
                  <th className="px-3 py-2 font-semibold min-w-[10rem]">対象キャスト・対象日</th>
                  <th className="px-3 py-2 font-semibold whitespace-nowrap">操作種別</th>
                  <th className="px-3 py-2 font-semibold min-w-[14rem]">詳細</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const badge = actionBadge(r.action_type);
                  return (
                    <tr key={r.id} className="border-b border-gray-100 align-top hover:bg-gray-50/80">
                      <td className="px-3 py-2 tabular-nums whitespace-nowrap text-gray-900">
                        {formatShortJaDateTime(r.created_at)}
                      </td>
                      <td className="px-3 py-2 text-gray-900 break-words max-w-[10rem]">
                        {r.editor_display_name}
                      </td>
                      <td className="px-3 py-2 text-gray-900">
                        <span className="font-medium">{r.cast_name}</span>
                        <span className="text-gray-500"> · </span>
                        <span className="tabular-nums">{formatTargetYmd(r.attended_date)}</span>
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <span
                          className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-bold ring-1 ring-inset ${badge.className}`}
                        >
                          {badge.label}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-gray-800 whitespace-pre-line break-words">
                        {r.detail_summary}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
