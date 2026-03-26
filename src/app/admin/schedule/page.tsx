"use client";

import { useEffect, useMemo, useState } from "react";
import { createBrowserSupabaseClient } from "@/lib/supabase-client";
import { getCurrentStoreIdOrNull } from "@/lib/current-store";
import { TIME_OPTIONS_REQUIRED } from "@/lib/time-options";

type Cast = {
  id: string;
  name: string;
  store_id: string;
};

type Store = {
  id: string;
  name: string;
};

export default function AdminSchedulePage() {
  const supabase = useMemo(() => createBrowserSupabaseClient(), []);
  const [casts, setCasts] = useState<Cast[]>([]);
  const [store, setStore] = useState<Store | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<"success" | "error" | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);

  const [castId, setCastId] = useState("");
  const [scheduledDate, setScheduledDate] = useState("");
  const [scheduledTime, setScheduledTime] = useState("20:00");
  const [isDohan, setIsDohan] = useState(false);
  /** 登録と同時に Cron と同一の出勤確認 Flex を Push 送信 */
  const [sendImmediateLine, setSendImmediateLine] = useState(false);
  const [lineFeedback, setLineFeedback] = useState<{
    ok: boolean;
    text: string;
  } | null>(null);

  useEffect(() => {
    async function fetchData() {
      const storeId = getCurrentStoreIdOrNull();
      if (!storeId) {
        setConfigError("NEXT_PUBLIC_DEFAULT_STORE_ID が未設定です");
        setLoading(false);
        return;
      }
      setConfigError(null);
      try {
        const [castsRes, storesRes] = await Promise.all([
          supabase
            .from("casts")
            .select("id, name, store_id")
            .eq("store_id", storeId)
            .eq("is_active", true)
            .order("name"),
          supabase.from("stores").select("id, name").eq("id", storeId).single(),
        ]);

        if (castsRes.data) setCasts(castsRes.data as Cast[]);
        if (storesRes.data) setStore(storesRes.data as Store);
      } catch (err) {
        console.error(err);
        setMessage("error");
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, [supabase]);

  const resetForm = () => {
    setCastId("");
    setScheduledDate("");
    setScheduledTime("20:00");
    setIsDohan(false);
    setSendImmediateLine(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!store) return;

    setSubmitting(true);
    setMessage(null);
    setLineFeedback(null);

    try {
      const res = await fetch("/api/admin/schedule-register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          storeId: store.id,
          castId,
          scheduledDate,
          scheduledTime,
          isDohan,
          sendImmediateLine,
        }),
      });

      const json = (await res.json()) as {
        ok?: boolean;
        error?: string;
        lineSent?: boolean;
        lineWarning?: string;
      };

      if (!res.ok) {
        throw new Error(json.error ?? "登録に失敗しました");
      }

      setMessage("success");

      if (json.lineWarning) {
        setLineFeedback({
          ok: false,
          text: json.lineWarning,
        });
      } else if (sendImmediateLine && json.lineSent) {
        setLineFeedback({
          ok: true,
          text: "出勤確認LINEを送信しました。",
        });
      }

      resetForm();
    } catch (err) {
      console.error(err);
      setMessage("error");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
        <p className="text-gray-500 text-sm sm:text-base">読み込み中...</p>
      </div>
    );
  }

  if (configError) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
        <p className="text-red-600 text-sm sm:text-base text-center">{configError}</p>
      </div>
    );
  }

  return (
    <div className="py-4 sm:py-6 px-3 sm:px-6">
      <div className="max-w-md mx-auto">
        <div className="mb-4 sm:mb-6">
          <h1 className="text-lg sm:text-xl font-bold text-gray-900 mb-1 sm:mb-2">
            出勤予定を登録
          </h1>
          <p className="text-xs sm:text-sm text-gray-600">
            {store?.name ?? "店舗"}
          </p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 sm:p-6 space-y-4 sm:space-y-5"
        >
          {/* キャスト選択 */}
          <div>
            <label
              htmlFor="cast"
              className="block text-sm font-medium text-gray-700 mb-2"
            >
              キャスト
            </label>
            <select
              id="cast"
              value={castId}
              onChange={(e) => setCastId(e.target.value)}
              required
              className="w-full min-h-[48px] h-12 px-4 rounded-lg border border-gray-300 text-base focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
            >
              <option value="">選択してください</option>
              {casts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          {/* 出勤予定日 */}
          <div>
            <label
              htmlFor="date"
              className="block text-sm font-medium text-gray-700 mb-2"
            >
              出勤予定日
            </label>
            <input
              id="date"
              type="date"
              value={scheduledDate}
              onChange={(e) => setScheduledDate(e.target.value)}
              required
              className="w-full min-h-[48px] h-12 px-4 rounded-lg border border-gray-300 text-base focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
            />
          </div>

          {/* 出勤予定時間 */}
          <div>
            <label
              htmlFor="time"
              className="block text-sm font-medium text-gray-700 mb-2"
            >
              出勤予定時間
            </label>
            <select
              id="time"
              value={scheduledTime}
              onChange={(e) => setScheduledTime(e.target.value)}
              required
              className="w-full min-h-[48px] h-12 px-4 rounded-lg border border-gray-300 text-base focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none bg-white"
            >
              {TIME_OPTIONS_REQUIRED.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
            {/* 同伴トグル: ON時はピンクで視認性を確保 */}
            <button
              type="button"
              onClick={() => setIsDohan((prev) => !prev)}
              className={`mt-2 w-full min-h-[40px] px-4 rounded-lg border font-medium transition-colors touch-manipulation ${
                isDohan
                  ? "bg-pink-500 border-pink-600 text-white"
                  : "bg-white border-gray-300 text-gray-600 hover:bg-gray-50"
              }`}
            >
              同伴 {isDohan && "✓"}
            </button>
          </div>

          {message === "success" && (
            <p className="text-green-600 text-sm font-medium">
              登録しました
            </p>
          )}
          {lineFeedback && (
            <p
              className={`text-sm ${lineFeedback.ok ? "text-green-700" : "text-amber-800"}`}
            >
              {lineFeedback.text}
            </p>
          )}
          {message === "error" && (
            <p className="text-red-600 text-sm">
              登録に失敗しました。入力内容を確認してください。
            </p>
          )}

          <label className="flex items-start gap-3 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={sendImmediateLine}
              onChange={(e) => setSendImmediateLine(e.target.checked)}
              className="mt-1 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            <span className="text-sm text-gray-700 leading-snug">
              登録と同時に出勤確認LINEを送信する
              <span className="block text-xs text-gray-500 mt-0.5">
                Cron（/api/remind）と同じ Flex（出勤・遅刻・欠勤ボタン）を即時 Push します
              </span>
            </span>
          </label>

          <button
            type="submit"
            disabled={submitting}
            className="w-full min-h-[48px] h-12 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors touch-manipulation"
          >
            {submitting ? "登録中..." : "登録する"}
          </button>
        </form>

        {casts.length === 0 && (
          <p className="mt-4 text-sm text-amber-700 bg-amber-50 p-4 rounded-lg">
            キャストが登録されていません。先にキャストを追加してください。
          </p>
        )}
      </div>
    </div>
  );
}
