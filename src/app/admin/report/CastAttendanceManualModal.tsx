"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Json } from "@/types/database";
import { addCalendarDaysJst } from "@/lib/date-utils";

type HistoryRow = {
  id: string;
  created_at: string;
  action_type: string;
  edited_by_admin_id: string;
  editor_display_name: string;
  old_data: Json;
  new_data: Json | null;
};

type LookupLog = Record<string, unknown> | null;

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
  { key: "action_detail", label: "行動詳細" },
  { key: "is_sabaki", label: "捌き出勤スナップショット" },
  { key: "public_holiday_reason", label: "公休理由" },
  { key: "half_holiday_reason", label: "半休理由" },
  { key: "has_reservation", label: "予約の有無" },
  { key: "reservation_details", label: "予約詳細" },
];

function enumerateYmdInclusive(startYmd: string, endYmd: string): string[] {
  if (startYmd > endYmd) return [];
  const out: string[] = [];
  let d = startYmd;
  while (d <= endYmd) {
    out.push(d);
    d = addCalendarDaysJst(d, 1);
  }
  return out;
}

function formatJaYmd(ymd: string): string {
  const [, m, day] = ymd.split("-").map(Number);
  if (!m || !day) return ymd;
  return `${m}月${day}日`;
}

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
    if (!same) lines.push(`${label}: ${fmtCell(a)} → ${fmtCell(b)}`);
  }
  return lines.length > 0 ? lines : ["（差分なし）"];
}

function historySummary(h: HistoryRow): string[] {
  const oldData =
    h.old_data && typeof h.old_data === "object" && !Array.isArray(h.old_data)
      ? (h.old_data as Record<string, unknown>)
      : {};
  if (h.action_type === "DELETE") {
    const snapshot = TRACKED_FIELDS.map(({ key, label }) => `${label}: ${fmtCell(oldData[key])}`);
    return ["打刻レコードを削除しました（以下は削除直前の値）。", ...snapshot];
  }
  if (h.action_type === "INSERT") {
    const newData =
      h.new_data && typeof h.new_data === "object" && !Array.isArray(h.new_data)
        ? (h.new_data as Record<string, unknown>)
        : {};
    const snapshot = TRACKED_FIELDS.map(({ key, label }) => `${label}: ${fmtCell(newData[key])}`);
    return ["手動で新規打刻を作成しました。", ...snapshot];
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

function applyLogToForm(log: LookupLog, setters: {
  setAttendanceLogId: (v: string | null) => void;
  setStatus: (v: string) => void;
  setPlannedGroups: (v: string) => void;
  setTentativeGroups: (v: string) => void;
  setActionType: (v: string) => void;
  setActionDetail: (v: string) => void;
  setIsSabaki: (v: boolean) => void;
  setPublicHolidayReason: (v: string) => void;
  setHalfHolidayReason: (v: string) => void;
  setHasReservation: (v: "" | "true" | "false") => void;
  setReservationDetails: (v: string) => void;
}) {
  if (!log || typeof log !== "object") {
    setters.setAttendanceLogId(null);
    setters.setStatus("attending");
    setters.setPlannedGroups("");
    setters.setTentativeGroups("0");
    setters.setActionType("");
    setters.setActionDetail("");
    setters.setIsSabaki(false);
    setters.setPublicHolidayReason("");
    setters.setHalfHolidayReason("");
    setters.setHasReservation("");
    setters.setReservationDetails("");
    return;
  }
  setters.setAttendanceLogId(String(log.id ?? ""));
  setters.setStatus(String(log.status ?? "attending"));
  const pg = log.planned_groups;
  setters.setPlannedGroups(
    pg === null || pg === undefined ? "" : typeof pg === "number" ? String(pg) : String(pg)
  );
  const tg = log.tentative_groups;
  setters.setTentativeGroups(
    typeof tg === "number" && Number.isFinite(tg) ? String(Math.trunc(tg)) : "0"
  );
  setters.setActionType(String(log.action_type ?? "").trim());
  setters.setActionDetail(String(log.action_detail ?? "").trim());
  setters.setIsSabaki(Boolean(log.is_sabaki));
  setters.setPublicHolidayReason(String(log.public_holiday_reason ?? "").trim());
  setters.setHalfHolidayReason(String(log.half_holiday_reason ?? "").trim());
  const hr = log.has_reservation;
  if (typeof hr === "boolean") setters.setHasReservation(hr ? "true" : "false");
  else setters.setHasReservation("");
  setters.setReservationDetails(String(log.reservation_details ?? "").trim());
}

export type CastAttendanceManualModalProps = {
  open: boolean;
  storeId: string;
  castId: string;
  castName: string;
  periodStartYmd: string;
  periodEndYmd: string;
  onClose: () => void;
  onSaved: () => void;
};

export function CastAttendanceManualModal({
  open,
  storeId,
  castId,
  castName,
  periodStartYmd,
  periodEndYmd,
  onClose,
  onSaved,
}: CastAttendanceManualModalProps) {
  const dateOptions = useMemo(
    () => enumerateYmdInclusive(periodStartYmd, periodEndYmd),
    [periodStartYmd, periodEndYmd]
  );

  const [selectedYmd, setSelectedYmd] = useState(periodStartYmd);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadingLookup, setLoadingLookup] = useState(false);

  const [attendanceLogId, setAttendanceLogId] = useState<string | null>(null);
  const [status, setStatus] = useState("attending");
  const [plannedGroups, setPlannedGroups] = useState("");
  const [tentativeGroups, setTentativeGroups] = useState("0");
  const [actionType, setActionType] = useState("");
  const [actionDetail, setActionDetail] = useState("");
  const [isSabaki, setIsSabaki] = useState(false);
  const [publicHolidayReason, setPublicHolidayReason] = useState("");
  const [halfHolidayReason, setHalfHolidayReason] = useState("");
  const [hasReservation, setHasReservation] = useState<"" | "true" | "false">("");
  const [reservationDetails, setReservationDetails] = useState("");

  const [panel, setPanel] = useState<"edit" | "history">("edit");
  const [histories, setHistories] = useState<HistoryRow[] | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const fetchLookup = useCallback(async () => {
    if (!open || !storeId || !castId || !selectedYmd) return;
    setLoadingLookup(true);
    setLoadError(null);
    try {
      const url = `/api/admin/attendance-logs/lookup?storeId=${encodeURIComponent(storeId)}&castId=${encodeURIComponent(castId)}&attended_date=${encodeURIComponent(selectedYmd)}`;
      const res = await fetch(url, { credentials: "include" });
      const payload = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        attendance_log?: LookupLog;
        error?: string;
      };
      if (!res.ok) {
        throw new Error(payload.error || "打刻の取得に失敗しました");
      }
      const log = payload.attendance_log ?? null;
      applyLogToForm(log, {
        setAttendanceLogId,
        setStatus,
        setPlannedGroups,
        setTentativeGroups,
        setActionType,
        setActionDetail,
        setIsSabaki,
        setPublicHolidayReason,
        setHalfHolidayReason,
        setHasReservation,
        setReservationDetails,
      });
      setHistories(null);
      setHistoryError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "打刻の取得に失敗しました");
    } finally {
      setLoadingLookup(false);
    }
  }, [open, storeId, castId, selectedYmd]);

  useEffect(() => {
    if (!open) return;
    setSelectedYmd((prev) => (dateOptions.includes(prev) ? prev : dateOptions[0] ?? periodStartYmd));
  }, [open, dateOptions, periodStartYmd]);

  useEffect(() => {
    if (!open) return;
    void fetchLookup();
  }, [open, fetchLookup]);

  const loadHistories = useCallback(async () => {
    if (!attendanceLogId || !storeId) return;
    setHistoryLoading(true);
    setHistoryError(null);
    try {
      const url = `/api/admin/attendance-logs/${encodeURIComponent(attendanceLogId)}/edit-history?storeId=${encodeURIComponent(storeId)}`;
      const res = await fetch(url, { credentials: "include" });
      const payload = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        histories?: HistoryRow[];
        error?: string;
      };
      if (!res.ok) throw new Error(payload.error || "履歴の取得に失敗しました");
      setHistories(Array.isArray(payload.histories) ? payload.histories : []);
    } catch (e) {
      setHistories([]);
      setHistoryError(e instanceof Error ? e.message : "履歴の取得に失敗しました");
    } finally {
      setHistoryLoading(false);
    }
  }, [attendanceLogId, storeId]);

  useEffect(() => {
    if (!open || panel !== "history" || !attendanceLogId) return;
    if (histories !== null || historyLoading) return;
    void loadHistories();
  }, [open, panel, attendanceLogId, histories, historyLoading, loadHistories]);

  const buildPayload = () => {
    let plannedVal: number | null = null;
    if (plannedGroups.trim() !== "") {
      const n = Number(plannedGroups.trim());
      if (!Number.isFinite(n)) throw new Error("確定組数は数値で入力してください（空欄でクリア）。");
      plannedVal = n;
    }
    const tentN = Number(String(tentativeGroups).trim());
    if (!Number.isFinite(tentN) || tentN < 0 || !Number.isInteger(tentN)) {
      throw new Error("仮予定組数は 0 以上の整数で入力してください。");
    }
    const hasRes =
      hasReservation === "" ? null : hasReservation === "true" ? true : false;
    return {
      status,
      planned_groups: plannedVal,
      tentative_groups: tentN,
      action_type: actionType.trim() || null,
      action_detail: actionDetail.trim() || null,
      is_sabaki: isSabaki,
      public_holiday_reason: publicHolidayReason.trim() || null,
      half_holiday_reason: halfHolidayReason.trim() || null,
      has_reservation: hasRes,
      reservation_details: reservationDetails.trim() || null,
    };
  };

  const handleSave = async () => {
    if (!storeId || !castId || !selectedYmd) return;
    let payload: Record<string, unknown>;
    try {
      payload = buildPayload();
    } catch (e) {
      alert(e instanceof Error ? e.message : "入力を確認してください");
      return;
    }

    setSaving(true);
    try {
      if (attendanceLogId) {
        const res = await fetch(
          `/api/admin/attendance-logs/${encodeURIComponent(attendanceLogId)}?storeId=${encodeURIComponent(storeId)}`,
          {
            method: "PATCH",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          }
        );
        const errBody = (await res.json().catch(() => ({}))) as { error?: string; details?: string };
        if (!res.ok) {
          throw new Error([errBody.error, errBody.details].filter(Boolean).join(" — "));
        }
      } else {
        const res = await fetch(
          `/api/admin/attendance-logs?storeId=${encodeURIComponent(storeId)}`,
          {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              storeId,
              castId,
              attended_date: selectedYmd,
              ...payload,
            }),
          }
        );
        const data = (await res.json().catch(() => ({}))) as {
          ok?: boolean;
          error?: string;
          details?: string;
          attendance_log?: { id?: string };
        };
        if (!res.ok) {
          throw new Error([data.error, data.details].filter(Boolean).join(" — "));
        }
        if (data.attendance_log?.id) {
          setAttendanceLogId(String(data.attendance_log.id));
        }
      }
      onSaved();
      await fetchLookup();
      setPanel("edit");
      setHistories(null);
    } catch (e) {
      alert(e instanceof Error ? e.message : "保存に失敗しました");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!attendanceLogId || !storeId) return;
    if (!confirm("この日の打刻ログを削除します。よろしいですか？")) return;
    setSaving(true);
    try {
      const res = await fetch(
        `/api/admin/attendance-logs/${encodeURIComponent(attendanceLogId)}?storeId=${encodeURIComponent(storeId)}`,
        { method: "DELETE", credentials: "include" }
      );
      const errBody = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(errBody.error || "削除に失敗しました");
      onSaved();
      await fetchLookup();
      setHistories(null);
    } catch (e) {
      alert(e instanceof Error ? e.message : "削除に失敗しました");
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  const modeLabel = attendanceLogId ? "既存ログを編集" : "新規打刻を追加";

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-black/45 print:hidden"
      role="dialog"
      aria-modal="true"
      aria-labelledby="cast-attendance-manual-title"
    >
      <div className="bg-white rounded-xl shadow-xl max-w-lg w-full max-h-[92vh] overflow-hidden flex flex-col border border-gray-200">
        <div className="px-4 py-3 border-b border-gray-100 flex flex-wrap items-center justify-between gap-2 bg-slate-50/90">
          <h2 id="cast-attendance-manual-title" className="text-base font-bold text-gray-900">
            {castName} の勤怠（手動）
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-sm text-gray-600 hover:text-gray-900 px-2 py-1 rounded-md hover:bg-gray-200/80"
          >
            閉じる
          </button>
        </div>

        <div className="px-4 py-2 border-b border-gray-100 bg-amber-50/50 text-xs text-amber-950">
          <span className="font-semibold">{modeLabel}</span>
          <span className="text-gray-600"> · 期間 {periodStartYmd} 〜 {periodEndYmd}</span>
        </div>

        <div className="px-4 py-3 border-b border-gray-100 space-y-2">
          <label className="block">
            <span className="block text-xs font-medium text-gray-600 mb-1">対象日</span>
            <select
              value={selectedYmd}
              onChange={(e) => {
                setSelectedYmd(e.target.value);
                setPanel("edit");
              }}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900"
            >
              {dateOptions.map((ymd) => (
                <option key={ymd} value={ymd}>
                  {ymd}（{formatJaYmd(ymd)}）
                </option>
              ))}
            </select>
          </label>
          {loadingLookup && <p className="text-xs text-gray-500">読み込み中…</p>}
          {loadError && <p className="text-xs text-red-600">{loadError}</p>}
        </div>

        <div className="px-3 pt-2 flex gap-1 border-b border-gray-100">
          <button
            type="button"
            onClick={() => setPanel("edit")}
            className={`px-3 py-2 text-sm font-semibold rounded-t-lg border-b-2 transition-colors ${
              panel === "edit"
                ? "border-blue-600 text-blue-800 bg-white"
                : "border-transparent text-gray-500 hover:text-gray-800"
            }`}
          >
            編集・保存
          </button>
          <button
            type="button"
            onClick={() => setPanel("history")}
            disabled={!attendanceLogId}
            className={`px-3 py-2 text-sm font-semibold rounded-t-lg border-b-2 transition-colors ${
              panel === "history"
                ? "border-blue-600 text-blue-800 bg-white"
                : "border-transparent text-gray-500 hover:text-gray-800"
            } ${!attendanceLogId ? "opacity-40 cursor-not-allowed" : ""}`}
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
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={isSabaki}
                  onChange={(e) => setIsSabaki(e.target.checked)}
                  className="rounded border-gray-300"
                />
                <span className="text-sm text-gray-800">捌き出勤スナップショット（is_sabaki）</span>
              </label>
              <label className="block">
                <span className="block text-xs font-medium text-gray-600 mb-1">確定組数（空欄でクリア）</span>
                <input
                  type="text"
                  inputMode="decimal"
                  value={plannedGroups}
                  onChange={(e) => setPlannedGroups(e.target.value)}
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
                  maxLength={64}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900"
                />
              </label>
              <label className="block">
                <span className="block text-xs font-medium text-gray-600 mb-1">行動詳細（最大255文字）</span>
                <textarea
                  value={actionDetail}
                  onChange={(e) => setActionDetail(e.target.value)}
                  rows={3}
                  maxLength={255}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900 font-mono text-xs"
                />
              </label>
              <label className="block">
                <span className="block text-xs font-medium text-gray-600 mb-1">公休理由</span>
                <input
                  type="text"
                  value={publicHolidayReason}
                  onChange={(e) => setPublicHolidayReason(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900"
                />
              </label>
              <label className="block">
                <span className="block text-xs font-medium text-gray-600 mb-1">半休理由</span>
                <input
                  type="text"
                  value={halfHolidayReason}
                  onChange={(e) => setHalfHolidayReason(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900"
                />
              </label>
              <label className="block">
                <span className="block text-xs font-medium text-gray-600 mb-1">予約の有無</span>
                <select
                  value={hasReservation}
                  onChange={(e) => setHasReservation(e.target.value as "" | "true" | "false")}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900"
                >
                  <option value="">未指定</option>
                  <option value="true">あり</option>
                  <option value="false">なし</option>
                </select>
              </label>
              <label className="block">
                <span className="block text-xs font-medium text-gray-600 mb-1">予約詳細</span>
                <textarea
                  value={reservationDetails}
                  onChange={(e) => setReservationDetails(e.target.value)}
                  rows={2}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900 text-xs"
                />
              </label>

              <div className="flex flex-wrap gap-2 pt-2 border-t border-gray-100">
                <button
                  type="button"
                  disabled={saving || loadingLookup}
                  onClick={() => void handleSave()}
                  className="rounded-lg bg-blue-700 text-white px-4 py-2 text-sm font-semibold hover:bg-blue-800 disabled:opacity-50"
                >
                  {attendanceLogId ? "上書き保存" : "新規作成"}
                </button>
                {attendanceLogId ? (
                  <button
                    type="button"
                    disabled={saving || loadingLookup}
                    onClick={() => void handleDelete()}
                    className="rounded-lg border border-red-300 text-red-700 px-4 py-2 text-sm font-semibold hover:bg-red-50 disabled:opacity-50"
                  >
                    この日のログを削除
                  </button>
                ) : null}
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {!attendanceLogId ? (
                <p className="text-sm text-gray-500">新規作成前の日付では履歴はありません。</p>
              ) : historyLoading ? (
                <p className="text-gray-600">読み込み中…</p>
              ) : historyError ? (
                <p className="text-red-700 text-sm">{historyError}</p>
              ) : histories && histories.length === 0 ? (
                <p className="text-gray-500 text-sm">まだ変更履歴はありません。</p>
              ) : (
                <ul className="space-y-4">
                  {histories?.map((h) => (
                    <li
                      key={h.id}
                      className="rounded-lg border border-gray-100 bg-gray-50/80 p-3 text-xs text-gray-800"
                    >
                      <p className="font-semibold text-gray-900 mb-1">
                        {formatJaDateTime(h.created_at)} ·{" "}
                        {h.action_type === "UPDATE"
                          ? "更新"
                          : h.action_type === "DELETE"
                            ? "削除"
                            : h.action_type === "INSERT"
                              ? "新規作成"
                              : h.action_type}{" "}
                        · {h.editor_display_name}
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
