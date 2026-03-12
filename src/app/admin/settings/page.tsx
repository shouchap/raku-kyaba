"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createBrowserSupabaseClient } from "@/lib/supabase-client";

/** 1時間刻みの時刻オプション（00:00〜23:00） */
const HOUR_OPTIONS: string[] = [];
for (let h = 0; h < 24; h++) {
  HOUR_OPTIONS.push(`${String(h).padStart(2, "0")}:00`);
}

type ReminderConfig = {
  enabled: boolean;
  sendTime: string;
  messageTemplate: string;
};

const DEFAULT_CONFIG: ReminderConfig = {
  enabled: true,
  sendTime: "12:00",
  messageTemplate:
    "{name}さん、本日は {time} 出勤予定です。出勤確認をお願いいたします。",
};

export default function AdminSettingsPage() {
  const supabase = useMemo(() => createBrowserSupabaseClient(), []);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<"success" | "error" | null>(null);
  const [config, setConfig] = useState<ReminderConfig>(DEFAULT_CONFIG);

  const fetchConfig = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("system_settings")
        .select("value")
        .eq("key", "reminder_config")
        .maybeSingle();

      if (error) {
        console.error("[Settings] Fetch error:", error);
        return;
      }

      if (data?.value && typeof data.value === "object") {
        const v = data.value as Record<string, unknown>;
        setConfig({
          enabled: Boolean(v.enabled ?? DEFAULT_CONFIG.enabled),
          sendTime:
            typeof v.sendTime === "string" ? v.sendTime : DEFAULT_CONFIG.sendTime,
          messageTemplate:
            typeof v.messageTemplate === "string"
              ? v.messageTemplate
              : DEFAULT_CONFIG.messageTemplate,
        });
      }
    } catch (err) {
      console.error("[Settings] Error:", err);
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    fetchConfig();
  }, [fetchConfig]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setMessage(null);
    try {
      const { error } = await supabase
        .from("system_settings")
        .upsert(
          {
            key: "reminder_config",
            value: {
              enabled: config.enabled,
              sendTime: config.sendTime,
              messageTemplate: config.messageTemplate.trim() || DEFAULT_CONFIG.messageTemplate,
            },
          },
          { onConflict: "key" }
        );

      if (error) throw error;
      setMessage("success");
    } catch (err) {
      console.error("[Settings] Save error:", err);
      setMessage("error");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
        <p className="text-gray-500 text-sm sm:text-base">読み込み中...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 py-4 sm:py-6 px-3 sm:px-6">
      <div className="max-w-2xl mx-auto">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-4 sm:mb-6">
          <div>
            <h1 className="text-lg sm:text-xl font-bold text-gray-900 mb-1 sm:mb-2">
              システム設定
            </h1>
            <p className="text-xs sm:text-sm text-gray-600">
              リマインド・各種設定を管理します
            </p>
          </div>
          <Link
            href="/admin/weekly"
            className="text-sm text-blue-600 hover:text-blue-700 font-medium py-2 min-h-[44px] flex items-center"
          >
            シフト登録へ →
          </Link>
        </div>

        <form
          onSubmit={handleSave}
          className="rounded-lg border border-gray-200 bg-white shadow-sm p-4 sm:p-6"
        >
          <h2 className="text-sm font-medium text-gray-700 mb-6">
            リマインド設定
          </h2>

          {/* 有効/無効 */}
          <div className="mb-6">
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={config.enabled}
                onChange={(e) =>
                  setConfig((c) => ({ ...c, enabled: e.target.checked }))
                }
                className="w-5 h-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <span className="text-sm text-gray-700">
                リマインド送信を有効にする
              </span>
            </label>
          </div>

          {/* 送信時間 */}
          <div className="mb-6">
            <label
              htmlFor="sendTime"
              className="block text-sm font-medium text-gray-700 mb-2"
            >
              送信時間（日本時間）
            </label>
            <select
              id="sendTime"
              value={config.sendTime}
              onChange={(e) =>
                setConfig((c) => ({ ...c, sendTime: e.target.value }))
              }
              className="w-full max-w-[120px] min-h-[44px] px-4 py-2 text-base border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
            >
              {HOUR_OPTIONS.map((h) => (
                <option key={h} value={h}>
                  {h}
                </option>
              ))}
            </select>
          </div>

          {/* メッセージテンプレート */}
          <div className="mb-8">
            <label
              htmlFor="messageTemplate"
              className="block text-sm font-medium text-gray-700 mb-2"
            >
              メッセージテンプレート
            </label>
            <textarea
              id="messageTemplate"
              value={config.messageTemplate}
              onChange={(e) =>
                setConfig((c) => ({
                  ...c,
                  messageTemplate: e.target.value,
                }))
              }
              rows={4}
              placeholder="例: {name}さん、本日は {time} 出勤予定です。"
              className="w-full min-h-[100px] px-4 py-3 text-base border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none placeholder-gray-400 resize-y"
            />
            <p className="text-xs text-gray-500 mt-1">
              ※ {"{name}"} はキャスト名、{"{time}"} は出勤時間に置換されます
            </p>
          </div>

          <button
            type="submit"
            disabled={saving}
            className="w-full min-h-[48px] h-12 px-6 bg-blue-600 text-white text-base font-medium rounded-lg hover:bg-blue-700 focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors touch-manipulation"
          >
            {saving ? "保存中..." : "設定を保存"}
          </button>
        </form>

        {message === "success" && (
          <p className="mt-4 text-green-600 text-sm font-medium">
            保存しました
          </p>
        )}
        {message === "error" && (
          <p className="mt-4 text-red-600 text-sm">
            保存に失敗しました。再度お試しください。
          </p>
        )}
      </div>
    </div>
  );
}
