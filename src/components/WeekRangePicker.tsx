"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { addCalendarDaysJst, getTodayJst } from "@/lib/date-utils";

type Props = {
  label: string;
  inputId: string;
  baseDate: string;
  onChange: (next: string) => void;
};

/**
 * 週表示の基準日を「前の週 / 今週 / 次の週」で動かせるようにする。
 * 日付入力だけだと毎回カレンダーを開く必要があり、日常操作が重かった。
 */
export function WeekRangePicker({ label, inputId, baseDate, onChange }: Props) {
  const today = getTodayJst();
  const isThisWeek = baseDate === today;

  return (
    <div className="flex flex-wrap items-end gap-2">
      <div>
        <label
          htmlFor={inputId}
          className="mb-2 block text-sm font-medium text-gray-700"
        >
          {label}
        </label>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => onChange(addCalendarDaysJst(baseDate, -7))}
            aria-label="前の週"
            className="inline-flex h-12 min-h-[44px] w-11 items-center justify-center rounded-lg border border-gray-300 bg-white text-gray-700 transition-colors hover:bg-gray-50 touch-manipulation"
          >
            <ChevronLeft className="h-5 w-5" aria-hidden />
          </button>
          <input
            id={inputId}
            type="date"
            value={baseDate}
            onChange={(e) => onChange(e.target.value)}
            className="h-12 min-h-[44px] rounded-lg border border-gray-300 px-4 text-base outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500"
          />
          <button
            type="button"
            onClick={() => onChange(addCalendarDaysJst(baseDate, 7))}
            aria-label="次の週"
            className="inline-flex h-12 min-h-[44px] w-11 items-center justify-center rounded-lg border border-gray-300 bg-white text-gray-700 transition-colors hover:bg-gray-50 touch-manipulation"
          >
            <ChevronRight className="h-5 w-5" aria-hidden />
          </button>
        </div>
      </div>

      <button
        type="button"
        onClick={() => onChange(today)}
        disabled={isThisWeek}
        className="h-12 min-h-[44px] rounded-lg border border-blue-300 bg-blue-50 px-4 text-sm font-semibold text-blue-800 transition-colors hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-45 touch-manipulation"
      >
        今日から
      </button>
    </div>
  );
}
