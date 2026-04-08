"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createBrowserSupabaseClient } from "@/lib/supabase-client";
import { useActiveStoreId } from "@/contexts/ActiveStoreContext";

type EventRow = {
  id: string;
  title: string;
  start_date: string;
  end_date: string;
  created_at: string;
};

type CastOption = { id: string; name: string };

export default function AdminSpecialShiftPage() {
  const activeStoreId = useActiveStoreId();
  const supabase = useMemo(() => createBrowserSupabaseClient(), []);

  const [events, setEvents] = useState<EventRow[]>([]);
  const [casts, setCasts] = useState<CastOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [title, setTitle] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [creating, setCreating] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const [testCastId, setTestCastId] = useState("");
  const [sendingEventId, setSendingEventId] = useState<string | null>(null);

  const fetchEvents = useCallback(async () => {
    setLoading(true);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/special-shift-events", { credentials: "include" });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMessage(typeof j.error === "string" ? j.error : "一覧の取得に失敗しました");
        setEvents([]);
        return;
      }
      setEvents(Array.isArray(j.events) ? j.events : []);
    } catch {
      setMessage("一覧の取得に失敗しました");
      setEvents([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchCasts = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from("casts")
        .select("id, name")
        .eq("store_id", activeStoreId)
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      const list = (data ?? []) as CastOption[];
      setCasts(list);
      setTestCastId((prev) => prev || list[0]?.id || "");
    } catch {
      setCasts([]);
    }
  }, [supabase, activeStoreId]);

  useEffect(() => {
    void fetchEvents();
  }, [fetchEvents]);

  useEffect(() => {
    void fetchCasts();
  }, [fetchCasts]);

  const createEvent = async () => {
    const t = title.trim();
    if (!t || !startDate || !endDate) {
      alert("タイトル・開始日・終了日を入力してください");
      return;
    }
    setCreating(true);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/special-shift-events", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: t, start_date: startDate, end_date: endDate }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(typeof j.error === "string" ? j.error : "作成に失敗しました");
        return;
      }
      setTitle("");
      setStartDate("");
      setEndDate("");
      await fetchEvents();
      setMessage("企画を作成しました");
    } catch {
      alert("作成に失敗しました");
    } finally {
      setCreating(false);
    }
  };

  const sendLine = async (eventId: string, mode: "test" | "bulk") => {
    if (mode === "test" && !testCastId) {
      alert("送信先のキャストを選んでください");
      return;
    }
    const ok =
      mode === "bulk"
        ? window.confirm(
            "この店舗のアクティブなキャスト全員に LINE を送信します。よろしいですか？"
          )
        : true;
    if (!ok) return;

    setSendingEventId(eventId);
    setMessage(null);
    try {
      const res = await fetch(`/api/admin/special-shift-events/${eventId}/line-send`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          mode === "test" ? { mode: "test", castId: testCastId } : { mode: "bulk" }
        ),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(typeof j.error === "string" ? j.error : "送信に失敗しました");
        return;
      }
      if (mode === "bulk") {
        setMessage(
          `一括送信: 成功 ${j.successCount ?? 0} 件 / 失敗 ${j.failCount ?? 0} 件`
        );
      } else {
        setMessage("テスト送信が完了しました");
      }
    } catch {
      alert("送信に失敗しました");
    } finally {
      setSendingEventId(null);
    }
  };

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <div className="border-b border-slate-100 pb-4">
        <h1 className="text-xl font-bold text-slate-900">特別期間シフト募集</h1>
        <p className="mt-1 text-sm text-slate-600">
          GW・お盆など長期間の出勤確認を LINE で案内し、Web フォームで回収します。
        </p>
      </div>

      <section className="mt-8 max-w-xl space-y-4">
        <h2 className="text-sm font-semibold text-slate-800">新規企画</h2>
        <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50/80 p-4">
          <label className="block">
            <span className="text-xs font-medium text-slate-600">タイトル</span>
            <input
              type="text"
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              placeholder="例: 2026年GW出勤確認"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="text-xs font-medium text-slate-600">開始日</span>
              <input
                type="date"
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-slate-600">終了日</span>
              <input
                type="date"
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </label>
          </div>
          <button
            type="button"
            onClick={() => void createEvent()}
            disabled={creating}
            className="rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
          >
            {creating ? "作成中…" : "企画を作成"}
          </button>
        </div>
      </section>

      <section className="mt-10">
        <h2 className="text-sm font-semibold text-slate-800">テスト送信の宛先</h2>
        <p className="mt-1 text-xs text-slate-500">
          「個別送信（テスト用）」で使用するキャストを選びます。
        </p>
        <select
          className="mt-2 w-full max-w-md rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
          value={testCastId}
          onChange={(e) => setTestCastId(e.target.value)}
        >
          <option value="">選択してください</option>
          {casts.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </section>

      <section className="mt-10">
        <h2 className="text-sm font-semibold text-slate-800">企画一覧</h2>
        {message ? <p className="mt-2 text-sm text-green-700">{message}</p> : null}
        {loading ? (
          <p className="mt-4 text-sm text-slate-500">読み込み中…</p>
        ) : events.length === 0 ? (
          <p className="mt-4 text-sm text-slate-500">まだ企画がありません。</p>
        ) : (
          <ul className="mt-4 space-y-4">
            {events.map((ev) => (
              <li
                key={ev.id}
                className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="font-medium text-slate-900">{ev.title}</p>
                    <p className="mt-1 text-xs text-slate-500">
                      {ev.start_date} 〜 {ev.end_date}
                    </p>
                  </div>
                  <Link
                    href={`/admin/shifts/special/${ev.id}`}
                    className="shrink-0 text-sm font-medium text-blue-700 hover:underline"
                  >
                    提出状況
                  </Link>
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={sendingEventId === ev.id}
                    onClick={() => void sendLine(ev.id, "test")}
                    className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-50"
                  >
                    {sendingEventId === ev.id ? "送信中…" : "個別送信（テスト用）"}
                  </button>
                  <button
                    type="button"
                    disabled={sendingEventId === ev.id}
                    onClick={() => void sendLine(ev.id, "bulk")}
                    className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-900 hover:bg-amber-100 disabled:opacity-50"
                  >
                    {sendingEventId === ev.id ? "送信中…" : "一括送信"}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
