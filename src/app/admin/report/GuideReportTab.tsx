"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { DailyGuideResult } from "@/types/entities";

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function formatYm(year: number, month: number): string {
  return `${year}-${pad2(month)}`;
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
  const ym = useMemo(() => formatYm(year, month), [year, month]);

  const [rows, setRows] = useState<DailyGuideResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchGuideRows = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const url = `/api/admin/guide-report?storeId=${encodeURIComponent(storeId)}&ym=${encodeURIComponent(ym)}`;
      const res = await fetch(url, { credentials: "include" });
      const payload = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        rows?: DailyGuideResult[];
        error?: string;
        details?: string;
      };
      if (!res.ok) {
        throw new Error(
          [payload.error, payload.details].filter(Boolean).join(" — ") ||
            "案内実績の取得に失敗しました"
        );
      }
      setRows(Array.isArray(payload.rows) ? (payload.rows as DailyGuideResult[]) : []);
    } catch (e: unknown) {
      console.error(e);
      setError(e instanceof Error ? e.message : "案内実績の取得に失敗しました");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [storeId, ym]);

  useEffect(() => {
    void fetchGuideRows();
  }, [fetchGuideRows]);

  const totalGuides = useMemo(
    () => rows.reduce((sum, r) => sum + (typeof r.guide_count === "number" ? r.guide_count : 0), 0),
    [rows]
  );

  const staffTotals = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) {
      const name = String(r.staff_name ?? "").trim() || "（無名）";
      m.set(name, (m.get(name) ?? 0) + (typeof r.guide_count === "number" ? r.guide_count : 0));
    }
    return [...m.entries()]
      .map(([staff_name, total]) => ({ staff_name, total }))
      .sort((a, b) => b.total - a.total || a.staff_name.localeCompare(b.staff_name, "ja"));
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

  return (
    <div className="space-y-8">
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
      </section>

      <section aria-labelledby="guide-staff-heading">
        <h2
          id="guide-staff-heading"
          className="mb-3 text-base font-semibold text-gray-900"
        >
          スタッフ別集計
        </h2>
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm print:shadow-none print:border print:rounded-none">
          <table className="min-w-[360px] w-full text-left text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50">
                <th className="px-4 py-3 font-semibold text-gray-900">スタッフ名</th>
                <th className="px-4 py-3 text-right font-semibold text-gray-900">合計（組）</th>
              </tr>
            </thead>
            <tbody>
              {staffTotals.length === 0 ? (
                <tr>
                  <td colSpan={2} className="px-4 py-10 text-center text-gray-500">
                    この月の案内実績データはありません。
                  </td>
                </tr>
              ) : (
                staffTotals.map((row) => (
                  <tr
                    key={row.staff_name}
                    className="border-b border-gray-100 hover:bg-gray-50/80"
                  >
                    <td className="px-4 py-3 font-medium text-gray-900">{row.staff_name}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-gray-900">{row.total}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section aria-labelledby="guide-detail-heading">
        <h2
          id="guide-detail-heading"
          className="mb-3 text-base font-semibold text-gray-900"
        >
          日別明細
        </h2>
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm print:shadow-none print:border print:rounded-none">
          <table className="min-w-[520px] w-full text-left text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50">
                <th className="px-4 py-3 font-semibold text-gray-900 whitespace-nowrap">日付</th>
                <th className="px-4 py-3 font-semibold text-gray-900">スタッフ名</th>
                <th className="px-4 py-3 text-right font-semibold text-gray-900 whitespace-nowrap">
                  組数
                </th>
              </tr>
            </thead>
            <tbody>
              {detailRows.length === 0 ? (
                <tr>
                  <td colSpan={3} className="px-4 py-10 text-center text-gray-500">
                    この月の案内実績データはありません。
                  </td>
                </tr>
              ) : (
                detailRows.map((r) => (
                  <tr
                    key={r.id}
                    className="border-b border-gray-100 hover:bg-gray-50/80"
                  >
                    <td className="px-4 py-3 tabular-nums text-gray-800 whitespace-nowrap">
                      {formatJaDateCell(r.target_date)}
                    </td>
                    <td className="px-4 py-3 font-medium text-gray-900">{r.staff_name}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-gray-900">{r.guide_count}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
