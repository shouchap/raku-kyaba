"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { getWeekdayJst } from "@/lib/date-utils";
import {
  DAY_STYLE_TEXT_CLASS,
  getDayStyleForYmd,
} from "@/lib/jp-calendar-style";
import { enumerateInclusiveYmd } from "@/lib/special-shift-dates";

const WEEKDAY_JA = ["日", "月", "火", "水", "木", "金", "土"] as const;

const SUCCESS_MESSAGE =
  "提出が完了しました！この画面を閉じてLINEに戻ってください。";

type Props = {
  eventId: string;
  castId: string;
};

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | {
      status: "ready";
      title: string;
      dates: string[];
      castName: string;
      selected: Set<string>;
    };

export default function SpecialShiftForm({ eventId, castId }: Props) {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [isSending, setIsSending] = useState(false);
  /** 今回のセッションで送信に成功した直後〜「修正する」まで */
  const [isCompleted, setIsCompleted] = useState(false);

  const applyPayload = useCallback(
    (j: {
      event?: { title?: string; start_date?: string; end_date?: string };
      cast?: { name?: string };
      available_dates?: unknown;
    }) => {
      const start = j.event?.start_date;
      const end = j.event?.end_date;
      if (!start || !end) {
        setState({ status: "error", message: "データ形式が不正です" });
        return;
      }
      const dates = enumerateInclusiveYmd(start, end);
      const selected = new Set<string>(
        Array.isArray(j.available_dates)
          ? j.available_dates.filter((x): x is string => typeof x === "string")
          : []
      );
      setState({
        status: "ready",
        title: j.event?.title ?? "",
        dates,
        castName: j.cast?.name ?? "",
        selected,
      });
    },
    []
  );

  const load = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (!opts?.silent) {
        setState({ status: "loading" });
        setIsCompleted(false);
      }
      try {
        const q = new URLSearchParams({ eventId, castId });
        const res = await fetch(`/api/public/special-shift?${q.toString()}`, {
          method: "GET",
        });
        const j = (await res.json().catch(() => ({}))) as Record<string, unknown>;
        if (!res.ok) {
          setState({
            status: "error",
            message: typeof j.error === "string" ? j.error : "読み込みに失敗しました",
          });
          return;
        }
        applyPayload(j);
      } catch {
        setState({ status: "error", message: "通信エラーが発生しました" });
      }
    },
    [eventId, castId, applyPayload]
  );

  useEffect(() => {
    void load();
  }, [load]);

  const toggle = useCallback((ymd: string) => {
    if (isCompleted) return;
    setState((prev) => {
      if (prev.status !== "ready") return prev;
      const next = new Set(prev.selected);
      if (next.has(ymd)) next.delete(ymd);
      else next.add(ymd);
      return { ...prev, selected: next };
    });
  }, [isCompleted]);

  const submit = async () => {
    if (state.status !== "ready" || isSending || isCompleted) return;
    setIsSending(true);
    try {
      const available_dates = [...state.selected].sort();
      const res = await fetch("/api/public/special-shift", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eventId, castId, available_dates }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(typeof j.error === "string" ? j.error : "送信に失敗しました");
        return;
      }
      setIsCompleted(true);
      await load({ silent: true });
    } catch {
      alert("送信に失敗しました");
    } finally {
      setIsSending(false);
    }
  };

  const dateRows = useMemo(() => {
    if (state.status !== "ready") return [];
    return state.dates.map((ymd) => {
      const [, m, d] = ymd.split("-").map(Number);
      const label = `${m}/${d}`;
      const w = WEEKDAY_JA[getWeekdayJst(ymd)];
      const style = getDayStyleForYmd(ymd);
      return { ymd, label, w, style };
    });
  }, [state]);

  if (state.status === "loading") {
    return (
      <div className="mx-auto max-w-lg px-4 py-10 text-center text-slate-600">
        読み込み中…
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className="mx-auto max-w-lg px-4 py-10 text-center text-red-600">
        {state.message}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-lg px-4 py-8 pb-[max(2rem,env(safe-area-inset-bottom))]">
      {isCompleted ? (
        <div
          className="mb-6 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-4 text-emerald-950 shadow-sm"
          role="status"
          aria-live="polite"
        >
          <p className="text-base font-semibold leading-snug">{SUCCESS_MESSAGE}</p>
        </div>
      ) : null}

      <h1 className="text-lg font-bold text-slate-900">{state.title}</h1>
      {state.castName ? (
        <p className="mt-1 text-sm text-slate-600">{state.castName} さん</p>
      ) : null}
      <p className="mt-4 text-sm text-slate-700 leading-relaxed">
        {isCompleted
          ? "提出内容は保存済みです。修正する場合は下の「内容を修正する」から変更できます。"
          : "出勤可能な日にチェックを入れて、「提出する」を押してください。"}
      </p>
      <ul className="mt-6 space-y-3">
        {dateRows.map(({ ymd, label, w, style }) => (
          <li
            key={ymd}
            className={`flex items-center gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2.5 shadow-sm ${
              isCompleted ? "opacity-90" : ""
            }`}
          >
            <label
              className={`flex flex-1 items-center gap-2 ${
                isCompleted ? "cursor-default" : "cursor-pointer"
              }`}
            >
              <input
                type="checkbox"
                className="h-5 w-5 shrink-0 rounded border-slate-300 disabled:cursor-not-allowed"
                checked={state.selected.has(ymd)}
                onChange={() => toggle(ymd)}
                disabled={isCompleted || isSending}
              />
              <span className={`text-base ${DAY_STYLE_TEXT_CLASS[style]}`}>
                {label}
                <span className="ml-1 text-sm font-normal text-slate-500">({w})</span>
              </span>
            </label>
          </li>
        ))}
      </ul>

      <button
        type="button"
        onClick={() => void submit()}
        disabled={isSending || isCompleted}
        className="mt-8 w-full rounded-xl bg-blue-600 py-3.5 text-base font-semibold text-white shadow-sm hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-70 touch-manipulation"
      >
        {isSending ? "送信中…" : isCompleted ? "提出済み" : "提出する"}
      </button>

      {isCompleted ? (
        <button
          type="button"
          className="mt-4 w-full rounded-xl border border-slate-300 bg-white py-3 text-sm font-medium text-slate-800 hover:bg-slate-50 touch-manipulation"
          onClick={() => setIsCompleted(false)}
        >
          内容を修正する
        </button>
      ) : null}
    </div>
  );
}
