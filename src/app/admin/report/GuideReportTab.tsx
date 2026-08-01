"use client";

import { useRouter } from "next/navigation";
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import type { DailyGuideResult } from "@/types/entities";
import { getTodayJst } from "@/lib/date-utils";
import {
  GUIDE_VENUES,
  emptyGuideVenueCounts,
  guideVenueCountsFromRow,
  sumGuideVenueCounts,
  type GuideVenueCounts,
  type GuideVenueId,
} from "@/lib/guide-venues";
import { aggregateGuideRows } from "./guide-report-aggregate";
import { GuideStaffTotalsTable } from "./GuideStaffTotalsTable";
import { compareDateYmd, type DateSortDir } from "./date-sort";

const BODY_VENUE_KEYS: Record<GuideVenueId, { g: string; p: string }> = {
  gold: { g: "goldGuideCount", p: "goldPeopleCount" },
  sek: { g: "sekGuideCount", p: "sekPeopleCount" },
  lounge: { g: "loungeGuideCount", p: "loungePeopleCount" },
  girls_bar: { g: "girlsBarGuideCount", p: "girlsBarPeopleCount" },
  concecafe: { g: "concecafeGuideCount", p: "concecafePeopleCount" },
  philippine_pub: { g: "philippinePubGuideCount", p: "philippinePubPeopleCount" },
};

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

function formatJaMonthDayYmd(ymd: string): string {
  const [, m, d] = ymd.split("-").map(Number);
  return `${m}月${d}日`;
}

type Props = {
  storeId: string;
  storeName?: string;
  year: number;
  month: number;
  /** 「2026年4月」など */
  monthTitleLabel: string;
  dateSortDir?: DateSortDir;
};

export function GuideReportTab({
  storeId,
  storeName = "",
  year,
  month,
  monthTitleLabel,
  dateSortDir = "desc",
}: Props) {
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
  const [formCounts, setFormCounts] = useState<GuideVenueCounts>(() => emptyGuideVenueCounts());
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
    setFormCounts(emptyGuideVenueCounts());
    setModalError(null);
    setModalOpen(true);
  };

  const openEdit = (r: DailyGuideResult) => {
    setModalMode("edit");
    setEditingRow(r);
    setFormDate(r.target_date);
    setFormStaff(r.staff_name);
    setFormCounts(guideVenueCountsFromRow(r as unknown as Record<string, unknown>));
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
    const fields = GUIDE_VENUES.flatMap((v) => [
      formCounts[v.id].groups,
      formCounts[v.id].people,
    ]);
    if (fields.some((n) => !Number.isInteger(n) || n < 0 || n > 9999)) {
      setModalError("各業態の組数・人数はそれぞれ 0〜9999 の整数で入力してください。");
      return;
    }

    const venueBody: Record<string, number> = {};
    for (const v of GUIDE_VENUES) {
      const keys = BODY_VENUE_KEYS[v.id];
      venueBody[keys.g] = formCounts[v.id].groups;
      venueBody[keys.p] = formCounts[v.id].people;
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
            ...venueBody,
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
            ...venueBody,
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

  const screenAggregate = useMemo(() => aggregateGuideRows(rows), [rows]);
  const { staffTotals } = screenAggregate;

  /** 印刷用: 月初〜今日（JST）までの実績のみ */
  const printEndYmd = useMemo(() => {
    const today = getTodayJst();
    if (today < monthBounds.start) return monthBounds.end;
    return today <= monthBounds.end ? today : monthBounds.end;
  }, [monthBounds]);

  const rowsForPrint = useMemo(
    () =>
      rows.filter((r) => {
        const d = String(r.target_date);
        return d >= monthBounds.start && d <= printEndYmd;
      }),
    [rows, monthBounds.start, printEndYmd]
  );

  const printAggregate = useMemo(() => aggregateGuideRows(rowsForPrint), [rowsForPrint]);
  const printPeriodLabel = `${formatJaMonthDayYmd(monthBounds.start)}〜${formatJaMonthDayYmd(printEndYmd)}`;

  /** 日付順。同一日はスタッフ名で安定ソート */
  const detailRows = useMemo(() => {
    const list = [...rows];
    list.sort((a, b) => {
      const d = compareDateYmd(String(a.target_date), String(b.target_date), dateSortDir);
      if (d !== 0) return d;
      return String(a.staff_name).localeCompare(String(b.staff_name), "ja");
    });
    return list;
  }, [rows, dateSortDir]);

  if (loading) {
    return <p className="text-gray-600">案内実績を読み込み中…</p>;
  }

  const namesReady = guideStaffNames.length > 0;

  const summaryBlock = (
    totals: typeof screenAggregate,
    title: string,
    headingId = "guide-summary-heading"
  ) => (
    <section
      aria-labelledby={headingId}
      className="guide-report-summary rounded-2xl border border-emerald-300 bg-gradient-to-br from-emerald-50 via-white to-teal-50/60 p-5 shadow-sm sm:p-6 print:p-4 print:shadow-none print:!border-gray-400 print:!bg-white print:!bg-none print:rounded-lg print:!text-gray-900"
    >
      <h2
        id={headingId}
        className="text-base font-semibold text-emerald-950 print:text-gray-800"
      >
        {title}
      </h2>
      <div className="mt-3 flex flex-wrap items-end gap-x-8 gap-y-2">
        <p className="text-4xl font-bold tabular-nums tracking-tight text-emerald-950 sm:text-5xl print:text-3xl print:!text-gray-900">
          {totals.totalGuides}
          <span className="ml-2 text-lg font-semibold text-emerald-800 sm:text-xl print:text-base print:!text-gray-700">
            組
          </span>
        </p>
        <p className="text-2xl font-bold tabular-nums text-emerald-900 sm:text-3xl print:text-xl print:!text-gray-800">
          {totals.totalPeople}
          <span className="ml-1.5 text-base font-semibold text-emerald-700 print:text-sm print:!text-gray-600">
            人
          </span>
        </p>
      </div>
      <ul className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6 print:grid-cols-3 print:gap-1.5">
        {GUIDE_VENUES.map((v) => (
          <li
            key={v.id}
            className="rounded-lg border border-emerald-200/80 bg-white/80 px-2.5 py-2 text-sm text-emerald-950 print:border-gray-300 print:bg-white print:!text-gray-800"
          >
            <span className="block text-xs font-semibold text-emerald-800/90 print:!text-gray-600">
              {v.label}
            </span>
            <span className="mt-0.5 block font-medium tabular-nums">
              {totals.byVenue[v.id].groups}組・{totals.byVenue[v.id].people}人
            </span>
          </li>
        ))}
      </ul>
    </section>
  );

  return (
    <div className="guide-report-panel">
      <div className="print:hidden space-y-8">
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

      {summaryBlock(screenAggregate, `${monthTitleLabel} · 全体の総案内数`)}

      <section aria-labelledby="guide-staff-heading">
        <h2 id="guide-staff-heading" className="mb-3 text-base font-semibold text-gray-900">
          スタッフ別集計
        </h2>
        <GuideStaffTotalsTable staffTotals={staffTotals} />
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
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm print:shadow-none print:border print:rounded-none">
          <table className="min-w-[780px] w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-100">
                <th
                  rowSpan={2}
                  className="sticky left-0 z-10 whitespace-nowrap bg-slate-100 px-3 py-2.5 text-left text-sm font-bold text-slate-900 shadow-[2px_0_6px_-2px_rgba(15,23,42,0.12)]"
                >
                  日付
                </th>
                <th
                  rowSpan={2}
                  className="sticky left-[4.5rem] z-10 whitespace-nowrap bg-slate-100 px-3 py-2.5 text-left text-sm font-bold text-slate-900 shadow-[2px_0_6px_-2px_rgba(15,23,42,0.12)] sm:left-[5.5rem]"
                >
                  スタッフ名
                </th>
                {GUIDE_VENUES.map((v) => (
                  <th
                    key={`h-${v.id}`}
                    colSpan={2}
                    className="border-l border-slate-200 px-2 py-2 text-center text-xs font-bold text-slate-800 sm:text-sm"
                  >
                    {v.label}
                  </th>
                ))}
                <th
                  colSpan={2}
                  className="border-l border-slate-300 bg-slate-200/70 px-2 py-2 text-center text-xs font-bold text-slate-900 sm:text-sm"
                >
                  合計
                </th>
                <th
                  rowSpan={2}
                  className="print:hidden border-l border-slate-200 px-3 py-2.5 text-center text-sm font-bold text-slate-900"
                >
                  操作
                </th>
              </tr>
              <tr className="border-b border-slate-200 bg-slate-50">
                {GUIDE_VENUES.map((v) => (
                  <Fragment key={`sub-${v.id}`}>
                    <th className="border-l border-slate-200 px-2 py-1.5 text-center text-xs font-semibold text-slate-600">
                      組
                    </th>
                    <th className="px-2 py-1.5 text-center text-xs font-semibold text-slate-600">
                      人
                    </th>
                  </Fragment>
                ))}
                <th className="border-l border-slate-300 bg-slate-100 px-2 py-1.5 text-center text-xs font-semibold text-slate-700">
                  組
                </th>
                <th className="bg-slate-100 px-2 py-1.5 text-center text-xs font-semibold text-slate-700">
                  人
                </th>
              </tr>
            </thead>
            <tbody>
              {detailRows.length === 0 ? (
                <tr>
                  <td
                    colSpan={3 + GUIDE_VENUES.length * 2 + 2}
                    className="px-4 py-10 text-center text-slate-500"
                  >
                    この月の案内実績データはありません。
                  </td>
                </tr>
              ) : (
                detailRows.map((r) => {
                  const vc = guideVenueCountsFromRow(r as unknown as Record<string, unknown>);
                  return (
                    <tr key={r.id} className="border-b border-slate-100 bg-white hover:bg-slate-50/90">
                      <td className="sticky left-0 z-10 whitespace-nowrap bg-white px-3 py-2.5 tabular-nums text-slate-800 shadow-[2px_0_6px_-2px_rgba(15,23,42,0.12)]">
                        {formatJaDateCell(r.target_date)}
                      </td>
                      <td className="sticky left-[4.5rem] z-10 whitespace-nowrap bg-white px-3 py-2.5 font-medium text-slate-900 shadow-[2px_0_6px_-2px_rgba(15,23,42,0.12)] sm:left-[5.5rem]">
                        {r.staff_name}
                      </td>
                      {GUIDE_VENUES.map((v) => (
                        <Fragment key={`${r.id}-${v.id}`}>
                          <td className="border-l border-slate-100 px-2 py-2.5 text-center tabular-nums text-slate-900">
                            {vc[v.id].groups}
                          </td>
                          <td className="px-2 py-2.5 text-center tabular-nums text-slate-900">
                            {vc[v.id].people}
                          </td>
                        </Fragment>
                      ))}
                      <td className="border-l border-slate-200 bg-slate-50/80 px-2 py-2.5 text-center font-semibold tabular-nums text-slate-900">
                        {r.guide_count}
                      </td>
                      <td className="bg-slate-50/80 px-2 py-2.5 text-center font-semibold tabular-nums text-slate-900">
                        {typeof r.people_count === "number" ? r.people_count : 0}
                      </td>
                      <td className="print:hidden border-l border-slate-100 px-3 py-2 text-center">
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
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>
      </div>

      <div className="hidden print:block guide-report-print report-print-monochrome space-y-5">
        <div className="guide-report-print-header border-b border-gray-400 pb-2">
          <h2 className="text-lg font-bold text-gray-900">案内数レポート</h2>
          {storeName ? <p className="mt-1 text-sm font-medium text-gray-800">{storeName}</p> : null}
          <p className="mt-0.5 text-sm text-gray-700">
            集計期間: {printPeriodLabel}
            {printAggregate.staffTotals.length > 0
              ? ` · ${printAggregate.staffTotals.length}名`
              : ""}
          </p>
        </div>
        {summaryBlock(
          printAggregate,
          `${monthTitleLabel} · 総案内数（${printPeriodLabel}）`,
          "guide-summary-print-heading"
        )}
        <section
          aria-labelledby="guide-staff-print-heading"
          className="guide-report-staff-print-section"
        >
          <h2
            id="guide-staff-print-heading"
            className="mb-2 text-base font-semibold text-gray-900"
          >
            スタッフ別集計
          </h2>
          <GuideStaffTotalsTable staffTotals={printAggregate.staffTotals} forPrint />
        </section>
      </div>

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
                {GUIDE_VENUES.map((v) => (
                  <div key={v.id} className="col-span-2 grid grid-cols-2 gap-3 rounded-lg border border-gray-100 bg-gray-50/60 p-3">
                    <p className="col-span-2 text-xs font-semibold text-gray-700">{v.label}</p>
                    <div>
                      <label
                        htmlFor={`guide-form-${v.id}-g`}
                        className="block text-sm font-medium text-gray-700"
                      >
                        組数
                      </label>
                      <input
                        id={`guide-form-${v.id}-g`}
                        type="number"
                        min={0}
                        max={9999}
                        step={1}
                        value={formCounts[v.id].groups}
                        onChange={(e) => {
                          const raw = e.target.value;
                          const n = raw === "" ? 0 : parseInt(raw, 10);
                          if (Number.isNaN(n)) return;
                          setFormCounts((prev) => ({
                            ...prev,
                            [v.id]: { ...prev[v.id], groups: n },
                          }));
                        }}
                        className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/25 outline-none"
                      />
                    </div>
                    <div>
                      <label
                        htmlFor={`guide-form-${v.id}-p`}
                        className="block text-sm font-medium text-gray-700"
                      >
                        人数
                      </label>
                      <input
                        id={`guide-form-${v.id}-p`}
                        type="number"
                        min={0}
                        max={9999}
                        step={1}
                        value={formCounts[v.id].people}
                        onChange={(e) => {
                          const raw = e.target.value;
                          const n = raw === "" ? 0 : parseInt(raw, 10);
                          if (Number.isNaN(n)) return;
                          setFormCounts((prev) => ({
                            ...prev,
                            [v.id]: { ...prev[v.id], people: n },
                          }));
                        }}
                        className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/25 outline-none"
                      />
                    </div>
                  </div>
                ))}
              </div>
              <p className="text-xs text-gray-500">
                合計組数・合計人数は全業態を足した値として保存されます（現在の合計:{" "}
                {sumGuideVenueCounts(formCounts).guideCount}組・
                {sumGuideVenueCounts(formCounts).peopleCount}人）。
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
