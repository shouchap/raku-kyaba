"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createBrowserSupabaseClient } from "@/lib/supabase-client";
import { getTodayJst } from "@/lib/date-utils";
import type { CastInterviewRecordRow } from "@/app/api/admin/cast-interview-records/route";

type CastOption = { castId: string; name: string };

function formatJaMonthDay(dateStr: string): string {
  const [, m, d] = dateStr.split("-").map(Number);
  if (!m || !d) return dateStr;
  return `${m}月${d}日`;
}

type Props = {
  storeId: string;
  storeName?: string;
  periodStartYmd: string;
  periodEndYmd: string;
  /** 印刷時の集計終了日（月間は月初〜今日）。未指定時は periodEndYmd */
  printPeriodEndYmd?: string;
  castOptions: CastOption[];
  filterCastId: string;
  castLabel: string;
};

export function CastInterviewRecordsPanel({
  storeId,
  storeName = "",
  periodStartYmd,
  periodEndYmd,
  printPeriodEndYmd,
  castOptions: castOptionsProp,
  filterCastId,
  castLabel,
}: Props) {
  const supabase = useMemo(() => createBrowserSupabaseClient(), []);
  const [allCastOptions, setAllCastOptions] = useState<CastOption[]>([]);
  const [rows, setRows] = useState<CastInterviewRecordRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [formCastId, setFormCastId] = useState("");
  const [formDate, setFormDate] = useState(getTodayJst);
  const [formContent, setFormContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDate, setEditDate] = useState("");
  const [editContent, setEditContent] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const fetchRows = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        storeId,
        start: periodStartYmd,
        end: periodEndYmd,
      });
      if (filterCastId) params.set("castId", filterCastId);
      const res = await fetch(`/api/admin/cast-interview-records?${params.toString()}`, {
        credentials: "include",
      });
      const payload = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        rows?: CastInterviewRecordRow[];
        error?: string;
        details?: string;
      };
      if (!res.ok) {
        throw new Error(
          [payload.error, payload.details].filter(Boolean).join(" — ") ||
            "面談記録の取得に失敗しました"
        );
      }
      setRows(Array.isArray(payload.rows) ? payload.rows : []);
    } catch (e: unknown) {
      console.error(e);
      setError(e instanceof Error ? e.message : "面談記録の取得に失敗しました");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [storeId, periodStartYmd, periodEndYmd, filterCastId]);

  useEffect(() => {
    void fetchRows();
  }, [fetchRows]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error: castErr } = await supabase
        .from("casts")
        .select("id, name, display_name")
        .eq("store_id", storeId)
        .eq("is_active", true)
        .order("name");
      if (cancelled) return;
      if (castErr || !data) {
        setAllCastOptions(castOptionsProp);
        return;
      }
      setAllCastOptions(
        data.map((c) => {
          const row = c as { id: string; name: string; display_name?: string | null };
          const name = row.name;
          const d = row.display_name?.trim();
          return {
            castId: row.id,
            name: d ? `${d}（${name}）` : name,
          };
        })
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase, storeId, castOptionsProp]);

  const castOptions = allCastOptions.length > 0 ? allCastOptions : castOptionsProp;

  useEffect(() => {
    if (filterCastId) {
      setFormCastId(filterCastId);
    } else if (castOptions.length > 0 && !formCastId) {
      setFormCastId(castOptions[0].castId);
    }
  }, [filterCastId, castOptions, formCastId]);

  const displayRows = useMemo(() => {
    if (!filterCastId) return rows;
    return rows.filter((r) => r.cast_id === filterCastId);
  }, [rows, filterCastId]);

  /** キャストごとにまとめ、各キャスト内は面談日の新しい順 */
  const groupedByCast = useMemo(() => {
    const map = new Map<
      string,
      { castName: string; records: CastInterviewRecordRow[] }
    >();
    for (const row of displayRows) {
      const castId = row.cast_id;
      const castName = row.cast_name?.trim() || "—";
      const bucket = map.get(castId);
      if (bucket) {
        bucket.records.push(row);
      } else {
        map.set(castId, { castName, records: [row] });
      }
    }
    const groups = [...map.entries()].map(([castId, { castName, records }]) => {
      records.sort((a, b) => {
        const byDate = b.interview_date.localeCompare(a.interview_date);
        if (byDate !== 0) return byDate;
        return b.created_at.localeCompare(a.created_at);
      });
      return { castId, castName, records };
    });
    groups.sort((a, b) => a.castName.localeCompare(b.castName, "ja"));
    return groups;
  }, [displayRows]);

  const handleCreate = async () => {
    const castId = formCastId.trim();
    const interviewDate = formDate.trim();
    const content = formContent.trim();
    if (!castId || !interviewDate || !content) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/cast-interview-records", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storeId, castId, interviewDate, content }),
      });
      const payload = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        details?: string;
      };
      if (!res.ok) {
        throw new Error(
          [payload.error, payload.details].filter(Boolean).join(" — ") ||
            "保存に失敗しました"
        );
      }
      setFormContent("");
      await fetchRows();
    } catch (e: unknown) {
      console.error(e);
      setError(e instanceof Error ? e.message : "保存に失敗しました");
    } finally {
      setSaving(false);
    }
  };

  const startEdit = (row: CastInterviewRecordRow) => {
    setEditingId(row.id);
    setEditDate(row.interview_date);
    setEditContent(row.content);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditDate("");
    setEditContent("");
  };

  const handleSaveEdit = async () => {
    if (!editingId) return;
    const interviewDate = editDate.trim();
    const content = editContent.trim();
    if (!interviewDate || !content) return;
    setSaving(true);
    setError(null);
    try {
      const params = new URLSearchParams({ storeId });
      const res = await fetch(
        `/api/admin/cast-interview-records/${encodeURIComponent(editingId)}?${params.toString()}`,
        {
          method: "PATCH",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ interviewDate, content }),
        }
      );
      const payload = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        details?: string;
      };
      if (!res.ok) {
        throw new Error(
          [payload.error, payload.details].filter(Boolean).join(" — ") ||
            "更新に失敗しました"
        );
      }
      cancelEdit();
      await fetchRows();
    } catch (e: unknown) {
      console.error(e);
      setError(e instanceof Error ? e.message : "更新に失敗しました");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (row: CastInterviewRecordRow) => {
    const ok = window.confirm(
      `${row.cast_name}さんの ${formatJaMonthDay(row.interview_date)} の面談記録を削除しますか？`
    );
    if (!ok) return;
    setDeletingId(row.id);
    setError(null);
    try {
      const params = new URLSearchParams({ storeId });
      const res = await fetch(
        `/api/admin/cast-interview-records/${encodeURIComponent(row.id)}?${params.toString()}`,
        { method: "DELETE", credentials: "include" }
      );
      const payload = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        details?: string;
      };
      if (!res.ok) {
        throw new Error(
          [payload.error, payload.details].filter(Boolean).join(" — ") ||
            "削除に失敗しました"
        );
      }
      if (editingId === row.id) cancelEdit();
      await fetchRows();
    } catch (e: unknown) {
      console.error(e);
      setError(e instanceof Error ? e.message : "削除に失敗しました");
    } finally {
      setDeletingId(null);
    }
  };

  const printEnd = printPeriodEndYmd ?? periodEndYmd;
  const periodLabel = `${formatJaMonthDay(periodStartYmd)}〜${formatJaMonthDay(periodEndYmd)}`;
  const printPeriodLabel = `${formatJaMonthDay(periodStartYmd)}〜${formatJaMonthDay(printEnd)}`;
  const summaryLabel =
    displayRows.length === 0 ? "0件" : `${displayRows.length}件 · ${groupedByCast.length}名`;

  return (
    <div className="interview-records-panel space-y-6 print:space-y-0">
      <div className="interview-records-add-form rounded-xl border border-fuchsia-200/90 bg-white p-4 shadow-sm sm:p-5 print:hidden">
        <h2 className="text-base font-semibold text-gray-900">面談記録を追加</h2>
        <p className="mt-1 text-xs text-gray-600">
          面談日と内容を入力して保存します。一覧は{castLabel}ごとにまとめて表示します（集計期間:{" "}
          {formatJaMonthDay(periodStartYmd)}〜{formatJaMonthDay(periodEndYmd)}）。
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="block sm:col-span-1">
            <span className="mb-1.5 block text-xs font-medium text-gray-600">{castLabel}</span>
            <select
              value={formCastId}
              onChange={(e) => setFormCastId(e.target.value)}
              disabled={Boolean(filterCastId) || saving || castOptions.length === 0}
              className="w-full min-h-[44px] rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-fuchsia-500 focus:ring-2 focus:ring-fuchsia-500/20 disabled:bg-gray-50"
            >
              {castOptions.length === 0 ? (
                <option value="">（対象なし）</option>
              ) : (
                castOptions.map((o) => (
                  <option key={o.castId} value={o.castId}>
                    {o.name}
                  </option>
                ))
              )}
            </select>
          </label>
          <label className="block sm:col-span-1">
            <span className="mb-1.5 block text-xs font-medium text-gray-600">面談日</span>
            <input
              type="date"
              value={formDate}
              onChange={(e) => setFormDate(e.target.value)}
              disabled={saving}
              className="w-full min-h-[44px] rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 outline-none focus:border-fuchsia-500 focus:ring-2 focus:ring-fuchsia-500/20"
            />
          </label>
          <label className="block sm:col-span-2">
            <span className="mb-1.5 block text-xs font-medium text-gray-600">面談内容</span>
            <textarea
              value={formContent}
              onChange={(e) => setFormContent(e.target.value)}
              rows={5}
              disabled={saving}
              placeholder="面談の要点・フォロー内容などを記入"
              className="w-full min-h-[120px] rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 outline-none focus:border-fuchsia-500 focus:ring-2 focus:ring-fuchsia-500/20"
            />
          </label>
        </div>
        <div className="mt-3 flex justify-end">
          <button
            type="button"
            onClick={() => void handleCreate()}
            disabled={
              saving ||
              !formCastId ||
              !formDate.trim() ||
              !formContent.trim() ||
              castOptions.length === 0
            }
            className="min-h-[44px] rounded-lg bg-fuchsia-600 px-5 py-2 text-sm font-semibold text-white hover:bg-fuchsia-700 disabled:opacity-50"
          >
            {saving ? "保存中..." : "面談記録を保存"}
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 print:hidden">
          {error}
        </div>
      )}

      <div className="interview-records-list report-print-monochrome rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden print:rounded-none print:border print:shadow-none">
        <div className="interview-records-list-header border-b border-gray-100 px-4 py-3 sm:px-5 print:py-2">
          <h2 className="text-base font-semibold text-gray-900 print:text-lg">面談記録一覧</h2>
          <p className="mt-0.5 text-xs text-gray-600 print:hidden">
            {loading ? "読み込み中…" : summaryLabel}
          </p>
          <div className="hidden print:block mt-1 text-sm text-gray-800">
            {storeName ? <p className="font-medium">{storeName}</p> : null}
            <p className="text-gray-700">
              集計期間: {printPeriodLabel}
              {!loading && displayRows.length > 0 ? ` · ${summaryLabel}` : null}
            </p>
          </div>
        </div>
        {loading ? (
          <p className="px-4 py-8 text-sm text-gray-500">読み込み中…</p>
        ) : displayRows.length === 0 ? (
          <p className="px-4 py-8 text-sm text-gray-500 text-center print:py-4">
            この期間の面談記録はまだありません。
          </p>
        ) : (
          <div className="interview-records-groups divide-y divide-gray-200 print:divide-gray-400">
            {groupedByCast.map((group) => (
              <section
                key={group.castId}
                className="interview-records-cast-section print:break-inside-avoid"
              >
                <header className="interview-records-cast-header flex flex-wrap items-baseline justify-between gap-x-3 border-b border-fuchsia-100 bg-fuchsia-50/70 px-4 py-2.5 sm:px-5 print:border-gray-400 print:bg-gray-100 print:py-2">
                  <h3 className="text-sm font-semibold text-gray-900 print:text-base">{group.castName}</h3>
                  <span className="text-xs text-gray-600 tabular-nums print:text-sm">
                    {group.records.length}件
                  </span>
                </header>
                <ul className="interview-records-entries divide-y divide-gray-100 print:divide-gray-300">
                  {group.records.map((row) => {
                    const isEditing = editingId === row.id;
                    return (
                      <li
                        key={row.id}
                        className="interview-record-entry px-4 py-2.5 sm:px-5 sm:pl-6 border-l-2 border-fuchsia-200/90 print:border-0 print:px-3 print:py-2"
                      >
                        {isEditing ? (
                    <div className="space-y-3 print:hidden">
                      <label className="block">
                        <span className="mb-1 block text-xs font-medium text-gray-600">面談日</span>
                        <input
                          type="date"
                          value={editDate}
                          onChange={(e) => setEditDate(e.target.value)}
                          disabled={saving}
                          className="w-full max-w-xs min-h-[40px] rounded-lg border border-gray-300 px-3 py-2 text-sm"
                        />
                      </label>
                      <label className="block">
                        <span className="mb-1 block text-xs font-medium text-gray-600">面談内容</span>
                        <textarea
                          value={editContent}
                          onChange={(e) => setEditContent(e.target.value)}
                          rows={4}
                          disabled={saving}
                          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                        />
                      </label>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => void handleSaveEdit()}
                          disabled={saving || !editDate.trim() || !editContent.trim()}
                          className="min-h-[40px] rounded-lg bg-fuchsia-600 px-4 py-2 text-sm font-medium text-white hover:bg-fuchsia-700 disabled:opacity-50"
                        >
                          {saving ? "保存中..." : "更新"}
                        </button>
                        <button
                          type="button"
                          onClick={cancelEdit}
                          disabled={saving}
                          className="min-h-[40px] rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-800 hover:bg-gray-50"
                        >
                          キャンセル
                        </button>
                      </div>
                    </div>
                        ) : (
                          <div className="interview-record-view flex items-start justify-between gap-3 print:block">
                            <div className="interview-record-body min-w-0 flex-1 space-y-1 print:grid print:grid-cols-[5.5rem_1fr] print:gap-x-3 print:gap-y-0 print:space-y-0">
                              <p className="interview-record-date text-sm font-semibold text-fuchsia-950 tabular-nums leading-tight print:text-black print:text-[11pt]">
                                {formatJaMonthDay(row.interview_date)}
                              </p>
                              <p className="interview-record-content whitespace-pre-wrap break-words text-sm text-gray-800 leading-snug print:text-[10.5pt] print:leading-relaxed print:text-black">
                                {row.content}
                              </p>
                            </div>
                            <div className="interview-record-actions flex shrink-0 gap-1.5 print:hidden">
                              <button
                                type="button"
                                onClick={() => startEdit(row)}
                                disabled={deletingId !== null || saving}
                                className="rounded-md border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-800 hover:bg-gray-50 disabled:opacity-50"
                              >
                                編集
                              </button>
                              <button
                                type="button"
                                onClick={() => void handleDelete(row)}
                                disabled={deletingId === row.id || saving}
                                className="rounded-md border border-red-200 px-2.5 py-1 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
                              >
                                {deletingId === row.id ? "削除中..." : "削除"}
                              </button>
                            </div>
                          </div>
                        )}
                </li>
              );
                  })}
                </ul>
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
