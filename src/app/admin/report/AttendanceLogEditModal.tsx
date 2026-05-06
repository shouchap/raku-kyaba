"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Json } from "@/types/database";
import type { ReportAttendanceLogPeriodRow } from "@/app/api/admin/report/route";

type HistoryRow = {
  id: string;
  created_at: string;
  action_type: string;
  edited_by_admin_id: string;
  editor_display_name: string;
  old_data: Json;
  new_data: Json | null;
};

const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: "attending", label: "出勤" },
  { value: "absent", label: "欠勤" },
  { value: "late", label: "遅刻" },
  { value: "public_holiday", label: "公休" },
  { value: "half_holiday", label: "半休" },
];

const TRACKED_FIELDS: { key: string; label: string }[] = [
  { key: "status", label: "ステータス" },
  { key: "planned_groups", label: "確定組数" },
  { key: "tentative_groups", label: "仮予定組数" },
  { key: "action_type", label: "行動種別" },
  { key: "action_detail", label: "行動詳細（配信・声かけ等）" },
  { key: "is_sabaki", label: "捌き出勤スナップショット" },
  { key: "public_holiday_reason", label: "公休理由" },
  { key: "half_holiday_reason", label: "半休理由" },
  { key: "has_reservation", label: "予約の有無" },
  { key: "reservation_details", label: "予約詳細" },
];

function fmtCell(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "boolean") return v ? "はい" : "いいえ";
  if (typeof v === "number") return String(v);
  return String(v).trim() || "—";
}

function summarizeUpdate(oldData: Record<string, unknown>, newData: Record<string, unknown>): string[] {
  const lines: string[] = [];
  for (const { key, label } of TRACKED_FIELDS) {
    const a = oldData[key];
    const b = newData[key];
    const same =
      (a === null || a === undefined) && (b === null || b === undefined)
        ? true
        : JSON.stringify(a) === JSON.stringify(b);
    if (!same) {
      lines.push(`${label}: ${fmtCell(a)} → ${fmtCell(b)}`);
    }
  }
  return lines.length > 0 ? lines : ["（差分なし・タイムスタンプ等のみ更新の可能性があります）"];
}

function historySummary(h: HistoryRow): string[] {
  const oldData =
    h.old_data && typeof h.old_data === "object" && !Array.isArray(h.old_data)
      ? (h.old_data as Record<string, unknown>)
      : {};
  if (h.action_type === "DELETE") {
    const snapshot = TRACKED_FIELDS.map(
      ({ key, label }) => `${label}: ${fmtCell(oldData[key])}`
    );
    return ["打刻レコードを削除しました（以下は削除直前の値）。", ...snapshot];
  }
  const newData =
    h.new_data && typeof h.new_data === "object" && !Array.isArray(h.new_data)
      ? (h.new_data as Record<string, unknown>)
      : {};
  return summarizeUpdate(oldData, newData);
}

function formatJaDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(d);
}

type Props = {
  open: boolean;
  storeId: string;
  castName: string;
  initial: ReportAttendanceLogPeriodRow | null;
  /** 親から「履歴」だけ開くときに指定 */
  initialPanel?: "edit" | "history";
  onClose: () => void;
  onSaved: () => void;
};

export function AttendanceLogEditModal({
  open,
  storeId,
  castName,
  initial,
  initialPanel = "edit",
  onClose,
  onSaved,
}: Props) {
  const [panel, setPanel] = useState<"edit" | "history">(initialPanel);
  const [status, setStatus] = useState("attending");
  const [plannedGroups, setPlannedGroups] = useState("");
  const [tentativeGroups, setTentativeGroups] = useState("0");
  const [actionType, setActionType] = useState("");
  const [actionDetail, setActionDetail] = useState("");
  const [saving, setSaving] = useState(false);
  const [histories, setHistories] = useState<HistoryRow[] | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !initial) return;
    setPanel(initialPanel);
    setStatus(initial.status || "attending");
    setPlannedGroups(
      initial.plannedGroups === null || initial.plannedGroups === undefined
        ? ""
        : String(initial.plannedGroups)
    );
    setTentativeGroups(String(initial.tentativeGroups ?? 0));
    setActionType(initial.actionType?.trim() ?? "");
    setActionDetail(initial.actionDetail?.trim() ?? "");
    setHistories(null);
    setHistoryError(null);
  }, [open, initial, initialPanel]);

  const loadHistories = useCallback(async () => {
    if (!initial?.attendanceLogId || !storeId) return;
    setHistoryLoading(true);
    setHistoryError(null);
    try {
      const url = `/api/admin/attendance-logs/${encodeURIComponent(initial.attendanceLogId)}/edit-history?storeId=${encodeURIComponent(storeId)}`;
      const res = await fetch(url, { credentials: "include" });
      const payload = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        histories?: HistoryRow[];
        error?: string;
      };
      if (!res.ok) {
        throw new Error(payload.error || "履歴の取得に失敗しました");
      }
      setHistories(Array.isArray(payload.histories) ? payload.histories : []);
    } catch (e) {
      setHistories([]);
      setHistoryError(e instanceof Error ? e.message : "履歴の取得に失敗しました");
    } finally {
      setHistoryLoading(false);
    }
  }, [initial?.attendanceLogId, storeId]);

  useEffect(() => {
    if (!open || panel !== "history" || !initial?.attendanceLogId) return;
    if (histories !== null || historyLoading) return;
    void loadHistories();
  }, [open, panel, initial?.attendanceLogId, histories, historyLoading, loadHistories]);

  const titleDate = useMemo(() => {
    if (!initial?.attendedDate) return "";
    const [, m, d] = initial.attendedDate.split("-").map(Number);
    return `${m}月${d}日`;
  }, [initial?.attendedDate]);

  const handleSave = async () => {
    if (!initial?.attendanceLogId || !storeId) return;
    let plannedVal: number | null = null;
    if (plannedGroups.trim() !== "") {
      const n = Number(plannedGroups.trim());
      if (!Number.isFinite(n)) {
        alert("確定組数は数値で入力してください（空欄でクリア）。");
        return;
      }
      plannedVal = n;
    }
    const tentN = Number(String(tentativeGroups).trim());
    if (!Number.isFinite(tentN) || tentN < 0 || !Number.isInteger(tentN)) {
      alert("仮予定組数は 0 以上の整数で入力してください。");
      return;
    }

    setSaving(true);
    try {
      const res = await fetch(
        `/api/admin/attendance-logs/${encodeURIComponent(initial.attendanceLogId)}?storeId=${encodeURIComponent(storeId)}`,
        {
          method: "PATCH",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            status,
            planned_groups: plannedVal,
            tentative_groups: tentN,
            action_type: actionType.trim() || null,
            action_detail: actionDetail.trim() || null,
          }),
        }
      );
      const payload = (await res.json().catch(() => ({}))) as { error?: string; details?: string };
      if (!res.ok) {
        throw new Error([payload.error, payload.details].filter(Boolean).join(" — "));
      }
      onSaved();
      onClose();
    } catch (e) {
      alert(e instanceof Error ? e.message : "保存に失敗しました");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!initial?.attendanceLogId || !storeId) return;
    if (
      !confirm(
        "この打刻（出勤回答）を削除します。シフト表示との整合は各自確認してください。よろしいですか？"
      )
    ) {
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(
        `/api/admin/attendance-logs/${encodeURIComponent(initial.attendanceLogId)}?storeId=${encodeURIComponent(storeId)}`,
        { method: "DELETE", credentials: "include" }
      );
      const payload = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        throw new Error(payload.error || "削除に失敗しました");
      }
      onSaved();
      onClose();
    } catch (e) {
      alert(e instanceof Error ? e.message : "削除に失敗しました");
    } finally {
      setSaving(false);
    }
  };

  if (!open || !initial) return null;

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-black/45 print:hidden"
      role="dialog"
      aria-modal="true"
      aria-labelledby="attendance-log-edit-title"
    >
      <div className="bg-white rounded-xl shadow-xl max-w-lg w-full max-h-[90vh] overflow-hidden flex flex-col border border-gray-200">
        <div className="px-4 py-3 border-b border-gray-100 flex flex-wrap items-center justify-between gap-2 bg-gray-50/80">
          <h2 id="attendance-log-edit-title" className="text-base font-bold text-gray-900">
            打刻の編集 · {castName} · {titleDate}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-sm text-gray-600 hover:text-gray-900 px-2 py-1 rounded-md hover:bg-gray-200/80"
          >
            閉じる
          </button>
        </div>

        <div className="px-3 pt-3 flex gap-1 border-b border-gray-100">
          <button
            type="button"
            onClick={() => setPanel("edit")}
            className={`px-3 py-2 text-sm font-semibold rounded-t-lg border-b-2 transition-colors ${
              panel === "edit"
                ? "border-blue-600 text-blue-800 bg-white"
                : "border-transparent text-gray-500 hover:text-gray-800"
            }`}
          >
            編集
          </button>
          <button
            type="button"
            onClick={() => setPanel("history")}
            className={`px-3 py-2 text-sm font-semibold rounded-t-lg border-b-2 transition-colors ${
              panel === "history"
                ? "border-blue-600 text-blue-800 bg-white"
                : "border-transparent text-gray-500 hover:text-gray-800"
            }`}
          >
            履歴
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-4 text-sm">
          {panel === "edit" ? (
            <div className="space-y-4">
              <label className="block">
                <span className="block text-xs font-medium text-gray-600 mb-1">ステータス</span>
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900"
                >
                  {STATUS_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="block text-xs font-medium text-gray-600 mb-1">
                  確定組数（空欄でクリア）
                </span>
                <input
                  type="text"
                  inputMode="decimal"
                  value={plannedGroups}
                  onChange={(e) => setPlannedGroups(e.target.value)}
                  placeholder="例: 3 または 2.5"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900"
                />
              </label>
              <label className="block">
                <span className="block text-xs font-medium text-gray-600 mb-1">仮予定組数</span>
                <input
                  type="number"
                  min={0}
                  step={1}
                  value={tentativeGroups}
                  onChange={(e) => setTentativeGroups(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900"
                />
              </label>
              <label className="block">
                <span className="block text-xs font-medium text-gray-600 mb-1">行動種別</span>
                <input
                  type="text"
                  value={actionType}
                  onChange={(e) => setActionType(e.target.value)}
                  placeholder="例: 配信"
                  maxLength={64}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900"
                />
              </label>
              <label className="block">
                <span className="block text-xs font-medium text-gray-600 mb-1">
                  行動詳細（カンマ区切り可・最大255文字）
                </span>
                <textarea
                  value={actionDetail}
                  onChange={(e) => setActionDetail(e.target.value)}
                  rows={4}
                  maxLength={255}
                  placeholder="例: 配信(18:00-20:00), 声かけ(3人)"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900 font-mono text-xs"
                />
              </label>
              <div className="flex flex-wrap gap-2 pt-2">
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => void handleSave()}
                  className="rounded-lg bg-blue-700 text-white px-4 py-2 text-sm font-semibold hover:bg-blue-800 disabled:opacity-50"
                >
                  保存
                </button>
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => void handleDelete()}
                  className="rounded-lg border border-red-300 text-red-700 px-4 py-2 text-sm font-semibold hover:bg-red-50 disabled:opacity-50"
                >
                  削除
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {historyLoading && <p className="text-gray-600">読み込み中…</p>}
              {historyError && (
                <p className="text-red-700 text-sm">{historyError}</p>
              )}
              {!historyLoading && histories && histories.length === 0 && !historyError && (
                <p className="text-gray-500">まだ変更履歴はありません。</p>
              )}
              {histories && histories.length > 0 && (
                <ul className="space-y-4">
                  {histories.map((h) => (
                    <li
                      key={h.id}
                      className="rounded-lg border border-gray-100 bg-gray-50/80 p-3 text-xs text-gray-800"
                    >
                      <p className="font-semibold text-gray-900 mb-1">
                        {formatJaDateTime(h.created_at)} ·{" "}
                        {h.action_type === "UPDATE" ? "更新" : "削除"} ·{" "}
                        {h.editor_display_name}
                      </p>
                      <ul className="mt-2 space-y-1 list-disc pl-4">
                        {historySummary(h).map((line, i) => (
                          <li key={i}>{line}</li>
                        ))}
                      </ul>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
