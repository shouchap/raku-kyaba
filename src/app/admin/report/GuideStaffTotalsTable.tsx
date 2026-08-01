"use client";

import { Fragment } from "react";
import { GUIDE_VENUES } from "@/lib/guide-venues";
import type { GuideStaffTotalRow } from "./guide-report-aggregate";

type Props = {
  staffTotals: GuideStaffTotalRow[];
  forPrint?: boolean;
  emptyMessage?: string;
};

/** スタッフ名列: 横書き固定・縮まない（CJK 1文字折り返し防止） */
const NAME_COL =
  "guide-report-staff-name-col sticky left-0 z-10 whitespace-nowrap bg-inherit px-3 py-2.5 text-left font-semibold text-slate-900 shadow-[2px_0_6px_-2px_rgba(15,23,42,0.12)]";

const NUM_COL = "px-2 py-2.5 text-center tabular-nums text-slate-900";

export function GuideStaffTotalsTable({
  staffTotals,
  forPrint = false,
  emptyMessage = "この月の案内実績データはありません。",
}: Props) {
  const colCount = 1 + GUIDE_VENUES.length * 2 + 2;
  return (
    <div className="guide-report-staff-table-wrap overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm print:shadow-none print:border print:rounded-none">
      <table
        className={`guide-report-staff-table w-full border-collapse text-left text-sm ${
          forPrint ? "guide-report-staff-table--print" : "min-w-[720px]"
        }`}
      >
        <thead>
          <tr className="border-b border-slate-200 bg-slate-100">
            <th
              rowSpan={2}
              className={`${NAME_COL} bg-slate-100 align-middle text-sm font-bold`}
            >
              スタッフ名
            </th>
            {GUIDE_VENUES.map((v) => (
              <th
                key={`${v.id}-h`}
                colSpan={2}
                className="border-l border-slate-200 px-2 py-2 text-center text-xs font-bold text-slate-800 sm:text-sm"
              >
                {forPrint ? v.shortLabel : v.label}
              </th>
            ))}
            <th
              colSpan={2}
              className="border-l border-slate-300 bg-slate-200/70 px-2 py-2 text-center text-xs font-bold text-slate-900 sm:text-sm"
            >
              合計
            </th>
          </tr>
          <tr className="border-b border-slate-200 bg-slate-50">
            {GUIDE_VENUES.map((v) => (
              <Fragment key={`${v.id}-sub`}>
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
          {staffTotals.length === 0 ? (
            <tr>
              <td colSpan={colCount} className="px-4 py-10 text-center text-slate-500">
                {emptyMessage}
              </td>
            </tr>
          ) : (
            staffTotals.map((row) => (
              <tr
                key={row.staff_name}
                className="border-b border-slate-100 bg-white hover:bg-slate-50/90 print:hover:bg-transparent"
              >
                <td className={`${NAME_COL} bg-white font-medium`}>{row.staff_name}</td>
                {GUIDE_VENUES.map((v) => (
                  <Fragment key={`${row.staff_name}-${v.id}`}>
                    <td className={`${NUM_COL} border-l border-slate-100`}>
                      {row.byVenue[v.id].groups}
                    </td>
                    <td className={NUM_COL}>{row.byVenue[v.id].people}</td>
                  </Fragment>
                ))}
                <td
                  className={`${NUM_COL} border-l border-slate-200 bg-slate-50/80 font-semibold`}
                >
                  {row.guideTotal}
                </td>
                <td className={`${NUM_COL} bg-slate-50/80 font-semibold`}>{row.peopleTotal}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
