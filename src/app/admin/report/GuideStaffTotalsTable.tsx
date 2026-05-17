"use client";

import type { GuideStaffTotalRow } from "./guide-report-aggregate";

type Props = {
  staffTotals: GuideStaffTotalRow[];
  forPrint?: boolean;
  emptyMessage?: string;
};

export function GuideStaffTotalsTable({
  staffTotals,
  forPrint = false,
  emptyMessage = "この月の案内実績データはありません。",
}: Props) {
  return (
    <div className="guide-report-staff-table-wrap overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm print:shadow-none print:border print:rounded-none">
      <table
        className={`guide-report-staff-table w-full text-left text-sm ${
          forPrint ? "guide-report-staff-table--print" : "min-w-[640px]"
        }`}
      >
        <thead>
          <tr className="border-b border-gray-200 bg-gray-50">
            <th className="guide-report-staff-name-col px-3 py-3 font-semibold text-gray-900 text-left">
              スタッフ名
            </th>
            <th className="px-2 py-3 text-right font-semibold text-gray-900 whitespace-nowrap">
              {forPrint ? "GOLD組" : "GOLD（組数）"}
            </th>
            <th className="px-2 py-3 text-right font-semibold text-gray-900 whitespace-nowrap">
              {forPrint ? "GOLD人" : "GOLD（人数）"}
            </th>
            <th className="px-2 py-3 text-right font-semibold text-gray-900 whitespace-nowrap">
              {forPrint ? "セク組" : "セクキャバ（組数）"}
            </th>
            <th className="px-2 py-3 text-right font-semibold text-gray-900 whitespace-nowrap">
              {forPrint ? "セク人" : "セクキャバ（人数）"}
            </th>
            <th className="px-2 py-3 text-right font-semibold text-gray-900 whitespace-nowrap">
              {forPrint ? "計組" : "計（組数）"}
            </th>
            <th className="px-2 py-3 text-right font-semibold text-gray-900 whitespace-nowrap">
              {forPrint ? "計人" : "計（人数）"}
            </th>
          </tr>
        </thead>
        <tbody>
          {staffTotals.length === 0 ? (
            <tr>
              <td colSpan={7} className="px-4 py-10 text-center text-gray-500">
                {emptyMessage}
              </td>
            </tr>
          ) : (
            staffTotals.map((row) => (
              <tr
                key={row.staff_name}
                className="border-b border-gray-100 hover:bg-gray-50/80 print:hover:bg-transparent"
              >
                <td className="guide-report-staff-name-col px-3 py-3 font-medium text-gray-900">
                  {row.staff_name}
                </td>
                <td className="px-2 py-3 text-right tabular-nums text-gray-900">{row.goldGroups}</td>
                <td className="px-2 py-3 text-right tabular-nums text-gray-900">{row.goldPeople}</td>
                <td className="px-2 py-3 text-right tabular-nums text-gray-900">{row.sekGroups}</td>
                <td className="px-2 py-3 text-right tabular-nums text-gray-900">{row.sekPeople}</td>
                <td className="px-2 py-3 text-right tabular-nums text-gray-900">{row.guideTotal}</td>
                <td className="px-2 py-3 text-right tabular-nums text-gray-900">{row.peopleTotal}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
