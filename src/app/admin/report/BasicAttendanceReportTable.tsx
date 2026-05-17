"use client";

import { Fragment } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { CastReport, CastReportSortKey } from "./cast-report-types";

function formatJaMonthDay(dateStr: string): string {
  const [, m, d] = dateStr.split("-").map(Number);
  return `${m}月${d}日`;
}

function hasAccordionDetail(r: CastReport): boolean {
  return r.incidents.length > 0 || r.sabakiDates.length > 0;
}

type Props = {
  rows: CastReport[];
  totalReportCount: number;
  attendanceLabel: string;
  sortKey: CastReportSortKey;
  sortDir: "asc" | "desc";
  onToggleSort: (key: CastReportSortKey) => void;
  expanded: Set<string>;
  onToggleExpand: (castId: string) => void;
  emptyMessage: string;
  filterEmptyMessage: string;
  /** 印刷用: 詳細行を常に展開・ソート操作なし */
  forPrint?: boolean;
};

export function BasicAttendanceReportTable({
  rows,
  totalReportCount,
  attendanceLabel,
  sortKey,
  sortDir,
  onToggleSort,
  expanded,
  onToggleExpand,
  emptyMessage,
  filterEmptyMessage,
  forPrint = false,
}: Props) {
  return (
    <div className="report-table-wrap basic-attendance-table-wrap overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm print:shadow-none print:border print:rounded-none">
      <table className="report-table basic-attendance-table min-w-[880px] w-full text-left text-sm">
        <thead>
          <tr className="border-b border-gray-200 bg-gray-50">
            {!forPrint && <th className="print:hidden px-1 py-3 w-10" />}
            <th className="px-3 py-3">
              {forPrint ? (
                <span className="font-semibold text-gray-900">利用者名</span>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => onToggleSort("name")}
                    className="print:hidden font-semibold text-gray-900 hover:text-blue-700 inline-flex items-center gap-1"
                  >
                    利用者名
                    {sortKey === "name" && (sortDir === "asc" ? " ↑" : " ↓")}
                  </button>
                  <span className="hidden font-semibold text-gray-900 print:inline">
                    利用者名
                  </span>
                </>
              )}
            </th>
            <th className="px-3 py-3 text-right">
              {forPrint ? (
                <span className="font-semibold text-gray-900">{attendanceLabel}日数</span>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => onToggleSort("attendance")}
                    className="print:hidden font-semibold text-gray-900 hover:text-blue-700"
                  >
                    {attendanceLabel}日数
                    {sortKey === "attendance" && (sortDir === "asc" ? " ↑" : " ↓")}
                  </button>
                  <span className="hidden font-semibold text-gray-900 print:inline">
                    {attendanceLabel}日数
                  </span>
                </>
              )}
            </th>
            <th className="px-3 py-3 text-right">
              {forPrint ? (
                <span className="font-semibold text-gray-900">同伴</span>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => onToggleSort("dohan")}
                    className="print:hidden font-semibold text-gray-900 hover:text-blue-700"
                  >
                    同伴
                    {sortKey === "dohan" && (sortDir === "asc" ? " ↑" : " ↓")}
                  </button>
                  <span className="hidden font-semibold text-gray-900 print:inline">同伴</span>
                </>
              )}
            </th>
            <th className="px-3 py-3 text-right">
              {forPrint ? (
                <span className="font-semibold text-gray-900">捌き</span>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => onToggleSort("sabaki")}
                    className="print:hidden font-semibold text-gray-900 hover:text-blue-700"
                    title="捌き出勤の日数"
                  >
                    捌き
                    {sortKey === "sabaki" && (sortDir === "asc" ? " ↑" : " ↓")}
                  </button>
                  <span className="hidden font-semibold text-gray-900 print:inline">捌き</span>
                </>
              )}
            </th>
            <th className="px-3 py-3 text-right">
              {forPrint ? (
                <span className="font-semibold text-gray-900">遅刻</span>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => onToggleSort("late")}
                    className="print:hidden font-semibold text-gray-900 hover:text-blue-700"
                  >
                    遅刻
                    {sortKey === "late" && (sortDir === "asc" ? " ↑" : " ↓")}
                  </button>
                  <span className="hidden font-semibold text-gray-900 print:inline">遅刻</span>
                </>
              )}
            </th>
            <th className="px-3 py-3 text-right">
              {forPrint ? (
                <span className="font-semibold text-gray-900">欠勤</span>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => onToggleSort("absent")}
                    className="print:hidden font-semibold text-gray-900 hover:text-blue-700"
                  >
                    欠勤
                    {sortKey === "absent" && (sortDir === "asc" ? " ↑" : " ↓")}
                  </button>
                  <span className="hidden font-semibold text-gray-900 print:inline">欠勤</span>
                </>
              )}
            </th>
            <th className="px-3 py-3 text-right">
              {forPrint ? (
                <span className="font-semibold text-gray-900">半休</span>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => onToggleSort("halfHoliday")}
                    className="print:hidden font-semibold text-gray-900 hover:text-blue-700"
                  >
                    半休
                    {sortKey === "halfHoliday" && (sortDir === "asc" ? " ↑" : " ↓")}
                  </button>
                  <span className="hidden font-semibold text-gray-900 print:inline">半休</span>
                </>
              )}
            </th>
            <th className="px-3 py-3 text-right">
              {forPrint ? (
                <span className="font-semibold text-gray-900">公休</span>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => onToggleSort("publicHoliday")}
                    className="print:hidden font-semibold text-gray-900 hover:text-blue-700"
                  >
                    公休
                    {sortKey === "publicHoliday" && (sortDir === "asc" ? " ↑" : " ↓")}
                  </button>
                  <span className="hidden font-semibold text-gray-900 print:inline">公休</span>
                </>
              )}
            </th>
            <th className="px-3 py-3 text-right">
              {forPrint ? (
                <span className="font-semibold text-gray-900">未入力</span>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => onToggleSort("unfilled")}
                    className="print:hidden font-semibold text-gray-900 hover:text-blue-700"
                    title="定休日を除く、月初から今日までの暦日のうちシフト未登録または未回答の日数"
                  >
                    未入力
                    {sortKey === "unfilled" && (sortDir === "asc" ? " ↑" : " ↓")}
                  </button>
                  <span className="hidden font-semibold text-gray-900 print:inline">未入力</span>
                </>
              )}
            </th>
          </tr>
        </thead>
        <tbody>
          {totalReportCount === 0 ? (
            <tr>
              <td colSpan={forPrint ? 9 : 10} className="px-3 py-8 text-center text-gray-500">
                {emptyMessage}
              </td>
            </tr>
          ) : rows.length === 0 ? (
            <tr>
              <td colSpan={forPrint ? 9 : 10} className="px-3 py-8 text-center text-gray-500">
                {filterEmptyMessage}
              </td>
            </tr>
          ) : (
            rows.map((r) => {
              const open = forPrint || expanded.has(r.castId);
              const showToggle = hasAccordionDetail(r);
              return (
                <Fragment key={r.castId}>
                  <tr className="border-b border-gray-100 hover:bg-gray-50/80">
                    {!forPrint && (
                      <td className="print:hidden px-1 py-2 text-center">
                        {showToggle ? (
                          <button
                            type="button"
                            onClick={() => onToggleExpand(r.castId)}
                            className="p-1 rounded-md text-gray-600 hover:bg-gray-200"
                            aria-expanded={open}
                            aria-label="遅刻・休み・捌きの詳細を表示"
                          >
                            {open ? (
                              <ChevronDown className="h-5 w-5" />
                            ) : (
                              <ChevronRight className="h-5 w-5" />
                            )}
                          </button>
                        ) : (
                          <span className="inline-block w-7" />
                        )}
                      </td>
                    )}
                    <td className="px-3 py-3 font-medium text-gray-900">
                      <span className="inline-flex flex-col items-start gap-1">
                        <span className="inline-flex items-center gap-1.5 flex-wrap">
                          {r.name}
                          {r.departedAt && (
                            <span className="inline-flex shrink-0 items-center rounded border border-rose-200 bg-rose-50 px-1.5 py-0.5 text-xs font-semibold text-rose-900">
                              退店
                            </span>
                          )}
                          {r.sabakiCount > 0 && (
                            <span
                              className="inline-flex items-center justify-center rounded border border-amber-500 bg-amber-50 px-1.5 py-0.5 text-xs font-semibold text-amber-900 tabular-nums"
                              title="期間内に捌き出勤のシフトあり"
                            >
                              捌
                            </span>
                          )}
                        </span>
                        {r.departedAt && (
                          <span className="text-xs font-normal text-gray-600">
                            退店日 {formatJaMonthDay(r.departedAt)}
                            {r.departureReason?.trim()
                              ? ` · ${r.departureReason.trim()}`
                              : " · （理由の記載なし）"}
                          </span>
                        )}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums">{r.attendanceDays}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{r.dohanCount}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{r.sabakiCount}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{r.lateCount}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{r.absentCount}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{r.halfHolidayCount}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{r.publicHolidayCount}</td>
                    <td
                      className={`px-3 py-3 text-right tabular-nums ${
                        r.unfilledDays >= 1 ? "text-red-500 font-semibold" : "text-gray-900"
                      }`}
                    >
                      {r.unfilledDays}
                    </td>
                  </tr>
                  {showToggle && (
                    <tr
                      className={`report-detail-row bg-gray-50/90 ${open || forPrint ? "" : "hidden"}`}
                    >
                      <td colSpan={forPrint ? 9 : 10} className="px-4 py-3 text-sm text-gray-700">
                        <ul className="space-y-2 pl-2 border-l-2 border-blue-200">
                          {r.sabakiDates.length > 0 && (
                            <li className="list-none text-amber-950">
                              <span className="inline-flex items-center gap-1.5">
                                <span
                                  className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-amber-600 bg-amber-100 text-xs font-bold text-amber-900"
                                  aria-hidden
                                >
                                  捌
                                </span>
                                <span>
                                  捌き出勤: {r.sabakiDates.map(formatJaMonthDay).join("、")}
                                </span>
                              </span>
                            </li>
                          )}
                          {r.incidents.map((inc, idx) => {
                            const label =
                              inc.kind === "late"
                                ? "遅刻"
                                : inc.kind === "absent"
                                  ? "欠勤"
                                  : inc.kind === "half_holiday"
                                    ? "半休"
                                    : inc.kind === "public_holiday"
                                      ? "公休"
                                      : "—";
                            const reasonText = inc.reason?.trim() || "（理由なし）";
                            return (
                              <li key={`${inc.dateStr}-${inc.kind}-${idx}`}>
                                {formatJaMonthDay(inc.dateStr)} [{label}]：{reasonText}
                              </li>
                            );
                          })}
                        </ul>
                        {!forPrint && (
                          <p className="mt-3 text-xs text-gray-600 print:hidden border-t border-gray-200/80 pt-3">
                            打刻の新規追加・編集・削除は、画面上部の「+ 勤怠を手動編集・追加」から行えます。
                          </p>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}

