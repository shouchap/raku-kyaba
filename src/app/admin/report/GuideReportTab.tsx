"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import type { DailyGuideResult } from "@/types/entities";
import { getTodayJst } from "@/lib/date-utils";

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function formatYm(year: number, month: number): string {
  return `${year}-${pad2(month)}`;
}

function getMonthRangeIso(year: number, month: number): { start: string; end: string } {
  const start = `${year}-${pad2(month)}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const end = `${year}-${pad2(month)}-${pad2(lastDay)}`;
  return { start, end };
}

/** 日付セルを yyyy-mm-dd → 「M月D日」 */
function formatJaDateCell(isoDate: string): string {
  const parts = isoDate.split("-").map(Number);
  const [, m, d] = parts;
  if (!m || !d) return isoDate;
  return `${m}月${d}日`;
}

type Props = {
  storeId: string;
  year: number;
  month: number;
  /** 「2026年4月」など */
  monthTitleLabel: string;
};

export function GuideReportTab({ storeId, year, month, monthTitleLabel }: Props) {
  const router = useRouter();
  const ym = useMemo(() => formatYm(year, month), [year, month]);
  const monthBounds = useMemo(() => getMonthRangeIso(year, month), [year, month]);

  const [rows, setRows] = useState<DailyGuideResult[]>([]);
  const [guideStaffNames, setGuideStaffNames] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [toast, setToast] = useState<{ msg: string; kind: "success" | "error" } | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<"create" | "edit">("create");
  const [editingRow, setEditingRow] = useState<DailyGuideResult | null>(null);
  const [formDate, setFormDate] = useState("");
  const [formStaff, setFormStaff] = useState("");
  const [formSekGuideCount, setFormSekGuideCount] = useState(0);
  const [formSekPeopleCount, setFormSekPeopleCount] = useState(0);
  const [formGoldGuideCount, setFormGoldGuideCount] = useState(0);
  const [formGoldPeopleCount, setFormGoldPeopleCount] = useState(0);
  const [modalSaving, setModalSaving] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);

  const defaultTargetDate = useMemo(() => {
    const today = getTodayJst();
    if (today >= monthBounds.start && today <= monthBounds.end) return today;
    return monthBounds.start;
  }, [monthBounds]);

  const showToast = useCallback((msg: string, kind: "success" | "error" = "success") => {
    setToast({ msg, kind });
    window.setTimeout(() => setToast(null), kind === "error" ? 6000 : 4000);
  }, []);

  const refreshData = useCallback(
    async (opts?: { silent?: boolean }) => {
      const silent = opts?.silent === true;
      if (!silent) {
        setLoading(true);
      }
      setError(null);
      try {
        const [reportRes, namesRes] = await Promise.all([
          fetch(
            `/api/admin/guide-report?storeId=${encodeURIComponent(storeId)}&ym=${encodeURIComponent(ym)}`,
            { credentials: "include" }
          ),
          fetch(`/api/admin/guide-hearing?storeId=${encodeURIComponent(storeId)}`, {
            credentials: "include",
          }),
        ]);

        const reportPayload = (await reportRes.json().catch(() => ({}))) as {
          ok?: boolean;
          rows?: DailyGuideResult[];
          error?: string;
          details?: string;
        };
        if (!reportRes.ok) {
          throw new Error(
            [reportPayload.error, reportPayload.details].filter(Boolean).join(" — ") ||
              "案内実績の取得に失敗しました"
          );
        }
        setRows(Array.isArray(reportPayload.rows) ? (reportPayload.rows as DailyGuideResult[]) : []);

        const namesPayload = (await namesRes.json().catch(() => ({}))) as {
          guideStaffNames?: string[];
        };
        setGuideStaffNames(
          Array.isArray(namesPayload.guideStaffNames)
            ? namesPayload.guideStaffNames.map((s) => String(s ?? "").trim()).filter(Boolean)
            : []
        );
      } catch (e: unknown) {
        console.error(e);
        setError(e instanceof Error ? e.message : "案内実績の取得に失敗しました");
        setRows([]);
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [storeId, ym]
  );

  useEffect(() => {
    void refreshData();
  }, [refreshData]);

  const openCreate = () => {
    setModalMode("create");
    setEditingRow(null);
    setFormDate(defaultTargetDate);
    setFormStaff(guideStaffNames[0] ?? "");
    setFormSekGuideCount(0);
    setFormSekPeopleCount(0);
    setFormGoldGuideCount(0);
    setFormGoldPeopleCount(0);
    setModalError(null);
    setModalOpen(true);
  };

  const openEdit = (r: DailyGuideResult) => {
    setModalMode("edit");
    setEditingRow(r);
    setFormDate(r.target_date);
    setFormStaff(r.staff_name);
    setFormSekGuideCount(typeof r.sek_guide_count === "number" ? r.sek_guide_count : 0);
    setFormSekPeopleCount(typeof r.sek_people_count === "number" ? r.sek_people_count : 0);
    setFormGoldGuideCount(typeof r.gold_guide_count === "number" ? r.gold_guide_count : 0);
    setFormGoldPeopleCount(typeof r.gold_people_count === "number" ? r.gold_people_count : 0);
    setModalError(null);
    setModalOpen(true);
  };

  const closeModal = () => {
    if (modalSaving) return;
    setModalOpen(false);
    setModalError(null);
  };

  const saveModal = async () => {
    setModalError(null);
    if (!formDate || formDate < monthBounds.start || formDate > monthBounds.end) {
      setModalError("日付は選択中の月（表示期間）内で指定してください。");
      return;
    }
    const staff = formStaff.trim();
    if (!staff) {
      setModalError("スタッフ名を選択してください。");
      return;
    }
    const fields = [
      formSekGuideCount,
      formSekPeopleCount,
      formGoldGuideCount,
      formGoldPeopleCount,
    ];
    if (fields.some((n) => !Number.isInteger(n) || n < 0 || n > 9999)) {
      setModalError("セク/GOLD の組数・人数はそれぞれ 0〜9999 の整数で入力してください。");
      return;
    }

    setModalSaving(true);
    try {
      if (modalMode === "edit" && editingRow) {
        const patchRes = await fetch("/api/admin/guide-hearing/results", {
          method: "PATCH",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            storeId,
            id: editingRow.id,
            staffName: staff,
            targetDate: formDate,
            sekGuideCount: formSekGuideCount,
            sekPeopleCount: formSekPeopleCount,
            goldGuideCount: formGoldGuideCount,
            goldPeopleCount: formGoldPeopleCount,
          }),
        });
        const patchPayload = (await patchRes.json().catch(() => ({}))) as {
          error?: string;
          details?: string;
        };
        if (!patchRes.ok) {
          throw new Error(
            [patchPayload.error, patchPayload.details].filter(Boolean).join(" — ") || "保存に失敗しました"
          );
        }
      } else {
        const putRes = await fetch("/api/admin/guide-hearing/results", {
          method: "PUT",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            storeId,
            staffName: staff,
            targetDate: formDate,
            sekGuideCount: formSekGuideCount,
            sekPeopleCount: formSekPeopleCount,
            goldGuideCount: formGoldGuideCount,
            goldPeopleCount: formGoldPeopleCount,
          }),
        });
        const putPayload = (await putRes.json().catch(() => ({}))) as { error?: string };
        if (!putRes.ok) {
          throw new Error(putPayload.error ?? "保存に失敗しました");
        }
      }

      setModalOpen(false);
      showToast(modalMode === "create" ? "追加しました。" : "保存しました。", "success");
      await refreshData({ silent: true });
      router.refresh();
    } catch (e: unknown) {
      setModalError(e instanceof Error ? e.message : "保存に失敗しました");
    } finally {
      setModalSaving(false);
    }
  };

  const confirmDelete = async (r: DailyGuideResult) => {
    if (
      !window.confirm(
        `${formatJaDateCell(r.target_date)} · ${r.staff_name}（合計${r.guide_count}組）を削除しますか？`
      )
    ) {
      return;
    }
    try {
      const res = await fetch("/api/admin/guide-hearing/results", {
        method: "DELETE",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storeId, id: r.id }),
      });
      const payload = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        throw new Error(payload.error ?? "削除に失敗しました");
      }
      showToast("削除しました。", "success");
      await refreshData({ silent: true });
      router.refresh();
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : "削除に失敗しました", "error");
    }
  };

  const totalGuides = useMemo(
    () => rows.reduce((sum, r) => sum + (typeof r.guide_count === "number" ? r.guide_count : 0), 0),
    [rows]
  );
  const totalPeople = useMemo(
    () =>
      rows.reduce(
        (sum, r) => sum + (typeof r.people_count === "number" ? r.people_count : 0),
        0
      ),
    [rows]
  );
  const totalSekGroups = useMemo(
    () => rows.reduce((sum, r) => sum + (typeof r.sek_guide_count === "number" ? r.sek_guide_count : 0), 0),
    [rows]
  );
  const totalSekPeople = useMemo(
    () => rows.reduce((sum, r) => sum + (typeof r.sek_people_count === "number" ? r.sek_people_count : 0), 0),
    [rows]
  );
  const totalGoldGroups = useMemo(
    () => rows.reduce((sum, r) => sum + (typeof r.gold_guide_count === "number" ? r.gold_guide_count : 0), 0),
    [rows]
  );
  const totalGoldPeople = useMemo(
    () => rows.reduce((sum, r) => sum + (typeof r.gold_people_count === "number" ? r.gold_people_count : 0), 0),
    [rows]
  );

  const staffTotals = useMemo(() => {
    const m = new Map<
      string,
      { sekG: number; sekP: number; goldG: number; goldP: number; guide: number; people: number }
    >();
    for (const r of rows) {
      const name = String(r.staff_name ?? "").trim() || "（無名）";
      const prev =
        m.get(name) ?? { sekG: 0, sekP: 0, goldG: 0, goldP: 0, guide: 0, people: 0 };
      const sekG = typeof r.sek_guide_count === "number" ? r.sek_guide_count : 0;
      const sekP = typeof r.sek_people_count === "number" ? r.sek_people_count : 0;
      const goldG = typeof r.gold_guide_count === "number" ? r.gold_guide_count : 0;
      const goldP = typeof r.gold_people_count === "number" ? r.gold_people_count : 0;
      const g = typeof r.guide_count === "number" ? r.guide_count : 0;
      const p = typeof r.people_count === "number" ? r.people_count : 0;
      m.set(name, {
        sekG: prev.sekG + sekG,
        sekP: prev.sekP + sekP,
        goldG: prev.goldG + goldG,
        goldP: prev.goldP + goldP,
        guide: prev.guide + g,
        people: prev.people + p,
      });
    }
    return [...m.entries()]
      .map(([staff_name, t]) => ({
        staff_name,
        sekGroups: t.sekG,
        sekPeople: t.sekP,
        goldGroups: t.goldG,
        goldPeople: t.goldP,
        guideTotal: t.guide,
        peopleTotal: t.people,
      }))
      .sort((a, b) => b.guideTotal - a.guideTotal || a.staff_name.localeCompare(b.staff_name, "ja"));
  }, [rows]);

  /** 日付新しい順。同一日はスタッフ名で安定ソート */
  const detailRows = useMemo(() => {
    const list = [...rows];
    list.sort((a, b) => {
      const d = String(b.target_date).localeCompare(String(a.target_date));
      if (d !== 0) return d;
      return String(a.staff_name).localeCompare(String(b.staff_name), "ja");
    });
    return list;
  }, [rows]);

  if (loading) {
    return <p className="text-gray-600">案内実績を読み込み中…</p>;
  }

  const namesReady = guideStaffNames.length > 0;

  return (
    <div className="space-y-8">
      {toast && (
        <div
          role="status"
          className={`print:hidden fixed bottom-4 right-4 z-[60] max-w-sm rounded-lg border px-4 py-3 text-sm font-medium shadow-lg ${
            toast.kind === "error"
              ? "border-red-200 bg-red-50 text-red-900"
              : "border-emerald-200 bg-emerald-50 text-emerald-900"
          }`}
        >
          {toast.msg}
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 print:hidden">
          {error}
        </div>
      )}

      <section
        aria-labelledby="guide-summary-heading"
        className="rounded-2xl border border-emerald-200/80 bg-gradient-to-br from-emerald-50 via-white to-teal-50/60 p-6 shadow-sm"
      >
        <h2 id="guide-summary-heading" className="text-sm font-medium text-emerald-900/90">
          {monthTitleLabel} · 全体の総案内数
        </h2>
        <p className="mt-3 text-4xl font-bold tabular-nums tracking-tight text-emerald-950 sm:text-5xl">
          {totalGuides}
          <span className="ml-2 text-lg font-semibold text-emerald-800 sm:text-xl">組</span>
        </p>
        <p className="mt-2 text-sm font-medium text-emerald-900/90 space-y-1">
          <span className="block">
            セク: <span className="tabular-nums">{totalSekGroups}</span>組・
            <span className="tabular-nums">{totalSekPeople}</span>人
          </span>
          <span className="block">
            GOLD: <span className="tabular-nums">{totalGoldGroups}</span>組・
            <span className="tabular-nums">{totalGoldPeople}</span>人
          </span>
          <span className="block pt-1 border-t border-emerald-200/80">
            合計人数: <span className="tabular-nums">{totalPeople}</span>人
          </span>
        </p>
      </section>

      <section aria-labelledby="guide-staff-heading">
        <h2
          id="guide-staff-heading"
          className="mb-3 text-base font-semibold text-gray-900"
        >
          スタッフ別集計
        </h2>
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm print:shadow-none print:border print:rounded-none">
          <table className="min-w-[640px] w-full text-left text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50">
                <th className="px-3 py-3 font-semibold text-gray-900">スタッフ名</th>
                <th className="px-3 py-3 text-right font-semibold text-gray-900 whitespace-nowrap">
                  セク（組）
                </th>
                <th className="px-3 py-3 text-right font-semibold text-gray-900 whitespace-nowrap">
                  セク（人）
                </th>
                <th className="px-3 py-3 text-right font-semibold text-gray-900 whitespace-nowrap">
                  GOLD（組）
                </th>
                <th className="px-3 py-3 text-right font-semibold text-gray-900 whitespace-nowrap">
                  GOLD（人）
                </th>
                <th className="px-3 py-3 text-right font-semibold text-gray-900 whitespace-nowrap">
                  計（組）
                </th>
                <th className="px-3 py-3 text-right font-semibold text-gray-900 whitespace-nowrap">
                  計（人）
                </th>
              </tr>
            </thead>
            <tbody>
              {staffTotals.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-gray-500">
                    この月の案内実績データはありません。
                  </td>
                </tr>
              ) : (
                staffTotals.map((row) => (
                  <tr
                    key={row.staff_name}
                    className="border-b border-gray-100 hover:bg-gray-50/80"
                  >
                    <td className="px-3 py-3 font-medium text-gray-900">{row.staff_name}</td>
                    <td className="px-3 py-3 text-right tabular-nums text-gray-900">{row.sekGroups}</td>
                    <td className="px-3 py-3 text-right tabular-nums text-gray-900">{row.sekPeople}</td>
                    <td className="px-3 py-3 text-right tabular-nums text-gray-900">{row.goldGroups}</td>
                    <td className="px-3 py-3 text-right tabular-nums text-gray-900">{row.goldPeople}</td>
                    <td className="px-3 py-3 text-right tabular-nums text-gray-900">{row.guideTotal}</td>
                    <td className="px-3 py-3 text-right tabular-nums text-gray-900">{row.peopleTotal}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section aria-labelledby="guide-detail-heading">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 id="guide-detail-heading" className="text-base font-semibold text-gray-900">
            日別明細
          </h2>
          <button
            type="button"
            onClick={openCreate}
            disabled={!namesReady}
            title={
              namesReady
                ? undefined
                : "システム設定で案内スタッフ名を登録してください"
            }
            className="print:hidden inline-flex items-center gap-2 rounded-lg bg-emerald-700 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Plus className="h-4 w-4 shrink-0" aria-hidden />
            新規手動追加
          </button>
        </div>
        {!namesReady && (
          <p className="mb-3 text-xs text-amber-800 print:hidden">
            手動追加・編集には、システム設定の「案内スタッフの名前登録」に少なくとも1名を登録してください。
          </p>
        )}
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm print:shadow-none print:border print:rounded-none">
          <table className="min-w-[880px] w-full text-left text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50">
                <th className="px-3 py-3 font-semibold text-gray-900 whitespace-nowrap">日付</th>
                <th className="px-3 py-3 font-semibold text-gray-900">スタッフ名</th>
                <th className="px-3 py-3 text-right font-semibold text-gray-900 whitespace-nowrap">
                  セク組
                </th>
                <th className="px-3 py-3 text-right font-semibold text-gray-900 whitespace-nowrap">
                  セク人
                </th>
                <th className="px-3 py-3 text-right font-semibold text-gray-900 whitespace-nowrap">
                  GOLD組
                </th>
                <th className="px-3 py-3 text-right font-semibold text-gray-900 whitespace-nowrap">
                  GOLD人
                </th>
                <th className="px-3 py-3 text-right font-semibold text-gray-900 whitespace-nowrap">
                  計組
                </th>
                <th className="px-3 py-3 text-right font-semibold text-gray-900 whitespace-nowrap">
                  計人
                </th>
                <th className="print:hidden px-3 py-3 text-center font-semibold text-gray-900 whitespace-nowrap w-[7rem]">
                  アクション
                </th>
              </tr>
            </thead>
            <tbody>
              {detailRows.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-10 text-center text-gray-500">
                    この月の案内実績データはありません。
                  </td>
                </tr>
              ) : (
                detailRows.map((r) => (
                  <tr
                    key={r.id}
                    className="border-b border-gray-100 hover:bg-gray-50/80"
                  >
                    <td className="px-3 py-3 tabular-nums text-gray-800 whitespace-nowrap">
                      {formatJaDateCell(r.target_date)}
                    </td>
                    <td className="px-3 py-3 font-medium text-gray-900">{r.staff_name}</td>
                    <td className="px-3 py-3 text-right tabular-nums text-gray-900">
                      {typeof r.sek_guide_count === "number" ? r.sek_guide_count : 0}
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums text-gray-900">
                      {typeof r.sek_people_count === "number" ? r.sek_people_count : 0}
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums text-gray-900">
                      {typeof r.gold_guide_count === "number" ? r.gold_guide_count : 0}
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums text-gray-900">
                      {typeof r.gold_people_count === "number" ? r.gold_people_count : 0}
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums text-gray-900">{r.guide_count}</td>
                    <td className="px-3 py-3 text-right tabular-nums text-gray-900">
                      {typeof r.people_count === "number" ? r.people_count : 0}
                    </td>
                    <td className="print:hidden px-3 py-2 text-center">
                      <div className="inline-flex items-center justify-center gap-1">
                        <button
                          type="button"
                          onClick={() => openEdit(r)}
                          disabled={!namesReady}
                          className="rounded-md p-2 text-emerald-800 hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-40"
                          aria-label={`${r.staff_name}の${formatJaDateCell(r.target_date)}を編集`}
                        >
                          <Pencil className="h-4 w-4" aria-hidden />
                        </button>
                        <button
                          type="button"
                          onClick={() => void confirmDelete(r)}
                          className="rounded-md p-2 text-red-700 hover:bg-red-50"
                          aria-label={`${r.staff_name}の${formatJaDateCell(r.target_date)}を削除`}
                        >
                          <Trash2 className="h-4 w-4" aria-hidden />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {modalOpen && (
        <div
          className="print:hidden fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="guide-result-modal-title"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) closeModal();
          }}
        >
          <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-xl border border-gray-200 bg-white p-6 shadow-xl">
            <h3 id="guide-result-modal-title" className="text-lg font-semibold text-gray-900">
              {modalMode === "create" ? "案内実績を追加" : "案内実績を編集"}
            </h3>
            <div className="mt-4 space-y-4">
              <div>
                <label htmlFor="guide-form-date" className="block text-sm font-medium text-gray-700">
                  日付
                </label>
                <input
                  id="guide-form-date"
                  type="date"
                  value={formDate}
                  min={monthBounds.start}
                  max={monthBounds.end}
                  onChange={(e) => setFormDate(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/25 outline-none"
                />
                <p className="mt-1 text-xs text-gray-500">
                  {monthTitleLabel}の範囲（{monthBounds.start} 〜 {monthBounds.end}）のみ
                </p>
              </div>
              <div>
                <label htmlFor="guide-form-staff" className="block text-sm font-medium text-gray-700">
                  スタッフ名
                </label>
                <select
                  id="guide-form-staff"
                  value={formStaff}
                  onChange={(e) => setFormStaff(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/25 outline-none"
                >
                  <option value="">選択してください</option>
                  {guideStaffNames.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="guide-form-sek-g" className="block text-sm font-medium text-gray-700">
                    セク・組数
                  </label>
                  <input
                    id="guide-form-sek-g"
                    type="number"
                    min={0}
                    max={9999}
                    step={1}
                    value={Number.isFinite(formSekGuideCount) ? formSekGuideCount : 0}
                    onChange={(e) => {
                      const raw = e.target.value;
                      if (raw === "") {
                        setFormSekGuideCount(0);
                        return;
                      }
                      const n = parseInt(raw, 10);
                      if (!Number.isNaN(n)) setFormSekGuideCount(n);
                    }}
                    className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/25 outline-none"
                  />
                </div>
                <div>
                  <label htmlFor="guide-form-sek-p" className="block text-sm font-medium text-gray-700">
                    セク・人数
                  </label>
                  <input
                    id="guide-form-sek-p"
                    type="number"
                    min={0}
                    max={9999}
                    step={1}
                    value={Number.isFinite(formSekPeopleCount) ? formSekPeopleCount : 0}
                    onChange={(e) => {
                      const raw = e.target.value;
                      if (raw === "") {
                        setFormSekPeopleCount(0);
                        return;
                      }
                      const n = parseInt(raw, 10);
                      if (!Number.isNaN(n)) setFormSekPeopleCount(n);
                    }}
                    className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/25 outline-none"
                  />
                </div>
                <div>
                  <label htmlFor="guide-form-gold-g" className="block text-sm font-medium text-gray-700">
                    GOLD・組数
                  </label>
                  <input
                    id="guide-form-gold-g"
                    type="number"
                    min={0}
                    max={9999}
                    step={1}
                    value={Number.isFinite(formGoldGuideCount) ? formGoldGuideCount : 0}
                    onChange={(e) => {
                      const raw = e.target.value;
                      if (raw === "") {
                        setFormGoldGuideCount(0);
                        return;
                      }
                      const n = parseInt(raw, 10);
                      if (!Number.isNaN(n)) setFormGoldGuideCount(n);
                    }}
                    className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/25 outline-none"
                  />
                </div>
                <div>
                  <label htmlFor="guide-form-gold-p" className="block text-sm font-medium text-gray-700">
                    GOLD・人数
                  </label>
                  <input
                    id="guide-form-gold-p"
                    type="number"
                    min={0}
                    max={9999}
                    step={1}
                    value={Number.isFinite(formGoldPeopleCount) ? formGoldPeopleCount : 0}
                    onChange={(e) => {
                      const raw = e.target.value;
                      if (raw === "") {
                        setFormGoldPeopleCount(0);
                        return;
                      }
                      const n = parseInt(raw, 10);
                      if (!Number.isNaN(n)) setFormGoldPeopleCount(n);
                    }}
                    className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/25 outline-none"
                  />
                </div>
              </div>
              <p className="text-xs text-gray-500">
                合計組・合計人は、セクと GOLD を足した値として保存されます（LINE ヒアリングと同じ集計です）。
              </p>
              {modalError && (
                <p className="text-sm text-red-700" role="alert">
                  {modalError}
                </p>
              )}
            </div>
            <div className="mt-6 flex flex-wrap justify-end gap-2">
              <button
                type="button"
                onClick={closeModal}
                disabled={modalSaving}
                className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-800 hover:bg-gray-50 disabled:opacity-50"
              >
                キャンセル
              </button>
              <button
                type="button"
                onClick={() => void saveModal()}
                disabled={modalSaving || !namesReady}
                className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {modalSaving ? "保存中…" : "保存"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
