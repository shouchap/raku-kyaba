"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { getWeekdayJst } from "@/lib/date-utils";
import {
  DAY_STYLE_TEXT_CLASS,
  getDayStyleForYmd,
} from "@/lib/jp-calendar-style";
import { enumerateInclusiveYmd } from "@/lib/special-shift-dates";

const WEEKDAY_JA = ["日", "月", "火", "水", "木", "金", "土"] as const;

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
  const [saving, setSaving] = useState(false);
  const [doneMessage, setDoneMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setState({ status: "loading" });
    setDoneMessage(null);
    try {
      const q = new URLSearchParams({ eventId, castId });
      const res = await fetch(`/api/public/special-shift?${q.toString()}`, {
        method: "GET",
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setState({
          status: "error",
          message: typeof j.error === "string" ? j.error : "読み込みに失敗しました",
        });
        return;
      }
      const dates = enumerateInclusiveYmd(j.event.start_date, j.event.end_date);
      const selected = new Set<string>(
        Array.isArray(j.available_dates) ? j.available_dates : []
      );
      setState({
        status: "ready",
        title: j.event.title,
        dates,
        castName: j.cast?.name ?? "",
        selected,
      });
    } catch {
      setState({ status: "error", message: "通信エラーが発生しました" });
    }
  }, [eventId, castId]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggle = useCallback((ymd: string) => {
    setState((prev) => {
      if (prev.status !== "ready") return prev;
      const next = new Set(prev.selected);
      if (next.has(ymd)) next.delete(ymd);
      else next.add(ymd);
      return { ...prev, selected: next };
    });
  }, []);

  const submit = async () => {
    if (state.status !== "ready") return;
    setSaving(true);
    setDoneMessage(null);
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
      setDoneMessage("提出しました。ありがとうございます。");
      await load();
    } catch {
      alert("送信に失敗しました");
    } finally {
      setSaving(false);
    }
  };

  const dateRows = useMemo(() => {
    if (state.status !== "ready") return [];
    return state.dates.map((ymd) => {
      const [y, m, d] = ymd.split("-").map(Number);
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
      <h1 className="text-lg font-bold text-slate-900">{state.title}</h1>
      {state.castName ? (
        <p className="mt-1 text-sm text-slate-600">{state.castName} さん</p>
      ) : null}
      <p className="mt-4 text-sm text-slate-700 leading-relaxed">
        出勤可能な日にチェックを入れて、「提出する」を押してください。
      </p>
      <ul className="mt-6 space-y-3">
        {dateRows.map(({ ymd, label, w, style }) => (
          <li
            key={ymd}
            className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2.5 shadow-sm"
          >
            <label className="flex flex-1 cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                className="h-5 w-5 shrink-0 rounded border-slate-300"
                checked={state.selected.has(ymd)}
                onChange={() => toggle(ymd)}
              />
              <span className={`text-base ${DAY_STYLE_TEXT_CLASS[style]}`}>
                {label}
                <span className="ml-1 text-sm font-normal text-slate-500">({w})</span>
              </span>
            </label>
          </li>
        ))}
      </ul>
      {doneMessage ? (
        <p className="mt-4 text-sm font-medium text-green-700">{doneMessage}</p>
      ) : null}
      <button
        type="button"
        onClick={() => void submit()}
        disabled={saving}
        className="mt-8 w-full rounded-xl bg-blue-600 py-3.5 text-base font-semibold text-white shadow-sm hover:bg-blue-700 disabled:opacity-60 touch-manipulation"
      >
        {saving ? "送信中…" : "提出する"}
      </button>
    </div>
  );
}
