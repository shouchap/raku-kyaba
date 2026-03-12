"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createBrowserSupabaseClient } from "@/lib/supabase-client";

const GOLD = "#D4AF37";

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
  const [toast, setToast] = useState<string | null>(null);
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

  const showToast = (message: string) => {
    setToast(message);
    setTimeout(() => setToast(null), 3000);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
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
      showToast("保存しました");
    } catch (err) {
      console.error("[Settings] Save error:", err);
      showToast("保存に失敗しました");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <p className="text-[#D4AF37]/80">読み込み中...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black text-white">
      {/* トースト */}
      {toast && (
        <div
          className="fixed top-6 left-1/2 -translate-x-1/2 z-50 px-6 py-3 rounded-lg bg-[#D4AF37]/20 border border-[#D4AF37] text-[#D4AF37] shadow-lg animate-fade-in"
          role="status"
        >
          {toast}
        </div>
      )}

      <div className="max-w-2xl mx-auto px-4 py-8">
        <div className="flex items-center justify-between mb-8">
          <h1
            className="text-xl font-light tracking-widest text-[#D4AF37]"
            style={{ fontFamily: "'Cinzel', 'Georgia', serif" }}
          >
            システム設定
          </h1>
          <Link
            href="/admin/weekly"
            className="text-sm text-[#D4AF37]/90 hover:text-[#D4AF37] transition-colors"
          >
            シフト登録へ →
          </Link>
        </div>

        <form
          onSubmit={handleSave}
          className="border border-[#D4AF37]/50 rounded-lg p-6 bg-black/80"
        >
          <h2 className="text-sm font-medium text-[#D4AF37]/90 mb-6 tracking-wider">
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
                className="w-5 h-5 rounded border-[#D4AF37]/50 bg-black text-[#D4AF37] focus:ring-[#D4AF37]"
              />
              <span className="text-sm text-[#D4AF37]/90">
                リマインド送信を有効にする
              </span>
            </label>
          </div>

          {/* 送信時間 */}
          <div className="mb-6">
            <label
              htmlFor="sendTime"
              className="block text-sm text-[#D4AF37]/90 mb-2"
            >
              送信時間（日本時間）
            </label>
            <select
              id="sendTime"
              value={config.sendTime}
              onChange={(e) =>
                setConfig((c) => ({ ...c, sendTime: e.target.value }))
              }
              className="w-full max-w-[120px] px-4 py-2 bg-black/80 border border-[#D4AF37]/50 rounded text-white focus:outline-none focus:border-[#D4AF37]"
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
              className="block text-sm text-[#D4AF37]/90 mb-2"
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
              className="w-full px-4 py-3 bg-black/80 border border-[#D4AF37]/50 rounded text-white placeholder-gray-500 focus:outline-none focus:border-[#D4AF37] resize-y"
            />
            <p className="text-xs text-[#D4AF37]/50 mt-1">
              ※ {"{name}"} はキャスト名、{"{time}"} は出勤時間に置換されます
            </p>
          </div>

          <button
            type="submit"
            disabled={saving}
            className="w-full py-3 rounded border-2 border-[#D4AF37] text-[#D4AF37] font-light tracking-widest hover:bg-[#D4AF37]/10 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {saving ? "保存中..." : "設定を保存"}
          </button>
        </form>
      </div>
    </div>
  );
}
