"use client";

import { useActionState, useEffect, useState } from "react";
import { submitShiftAction } from "./actions";
import { SHIFT_TIME_OFF } from "./constants";
import type { SubmitShiftState } from "./types";
import { TIME_OPTIONS_REQUIRED } from "@/lib/time-options";

const WEEKDAY_JA = ["日", "月", "火", "水", "木", "金", "土"];

function formatDateWithWeekday(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00");
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const w = WEEKDAY_JA[d.getDay()];
  return `${m}/${day}(${w})`;
}

type Props = {
  storeId: string;
  storeName: string;
  casts: { id: string; name: string }[];
  dates: string[];
  allowed: boolean;
  loadError: string | null;
  initialSuccess: boolean;
};

export function ShiftSubmitForm({
  storeId,
  storeName,
  casts,
  dates,
  allowed,
  loadError,
  initialSuccess,
}: Props) {
  const [state, formAction, isPending] = useActionState(submitShiftAction, null as SubmitShiftState);
  const [showSuccessBanner, setShowSuccessBanner] = useState(initialSuccess);

  useEffect(() => {
    if (initialSuccess) {
      setShowSuccessBanner(true);
      const t = window.setTimeout(() => setShowSuccessBanner(false), 8000);
      return () => clearTimeout(t);
    }
  }, [initialSuccess]);

  if (loadError) {
    return (
      <div className="mx-auto max-w-lg px-4 py-8">
        <h1 className="text-xl font-bold text-slate-900">シフト提出</h1>
        <p className="mt-4 text-sm text-red-600">{loadError}</p>
      </div>
    );
  }

  if (!allowed) {
    return (
      <div className="mx-auto max-w-lg px-4 py-8">
        <h1 className="text-xl font-bold text-slate-900">シフト提出</h1>
        <p className="mt-4 text-sm text-slate-600">
          この店舗はキャストからのシフト提出を受け付けていません。店長にご確認ください。
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-lg px-4 py-6 pb-10">
      <h1 className="text-xl font-bold text-slate-900">シフト提出</h1>
      {storeName ? (
        <p className="mt-1 text-sm text-slate-600">{storeName}</p>
      ) : null}
      <p className="mt-3 text-xs leading-relaxed text-slate-500">
        明日から7日分の出勤予定を提出します。既存の登録内容はここでは表示されません（提出時に上書きされます）。
      </p>

      {showSuccessBanner && (
        <div
          role="status"
          className="mt-5 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900"
        >
          シフトを提出しました。
        </div>
      )}

      {state?.error && (
        <div className="mt-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {state.error}
        </div>
      )}

      {casts.length === 0 ? (
        <p className="mt-6 text-sm text-slate-600">在籍キャストがいません。店長に登録を依頼してください。</p>
      ) : (
        <form action={formAction} className="mt-6 space-y-6">
          <input type="hidden" name="storeId" value={storeId} />
          <input type="hidden" name="datesJson" value={JSON.stringify(dates)} />

          <div>
            <label htmlFor="castId" className="block text-sm font-medium text-slate-800">
              自分の名前 <span className="text-red-600">*</span>
            </label>
            <select
              id="castId"
              name="castId"
              required
              className="mt-2 w-full min-h-[48px] rounded-xl border border-slate-300 bg-white px-3 text-base text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
              defaultValue=""
            >
              <option value="" disabled>
                選択してください
              </option>
              {casts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-4">
            <p className="text-sm font-medium text-slate-800">直近7日間（明日〜）</p>
            {dates.map((d) => (
              <div
                key={d}
                className="flex flex-col gap-2 rounded-xl border border-slate-200 bg-white p-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <span className="text-sm font-medium text-slate-800">{formatDateWithWeekday(d)}</span>
                <select
                  name={`time_${d}`}
                  className="min-h-[44px] w-full rounded-lg border border-slate-300 bg-white px-2 text-base sm:max-w-[200px]"
                  defaultValue=""
                >
                  <option value="">未選択</option>
                  <option value={SHIFT_TIME_OFF}>休み</option>
                  {TIME_OPTIONS_REQUIRED.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>

          <button
            type="submit"
            disabled={isPending}
            className="flex w-full min-h-[52px] items-center justify-center rounded-xl bg-blue-600 px-4 text-base font-semibold text-white shadow-sm transition hover:bg-blue-700 active:bg-blue-800 disabled:opacity-60"
          >
            {isPending ? "送信中…" : "提出する"}
          </button>
        </form>
      )}
    </div>
  );
}
