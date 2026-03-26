"use client";

import { useCallback, useEffect, useState } from "react";
import { useActiveStoreId } from "@/contexts/ActiveStoreContext";

/** 00:00〜23:00（1時間刻み） */
const REMIND_TIME_OPTIONS = Array.from({ length: 24 }, (_, h) => {
  const hh = String(h).padStart(2, "0");
  return `${hh}:00`;
});

type ReminderConfig = {
  enabled: boolean;
  messageTemplate: string;
  reply_present: string;
  reply_late: string;
  reply_absent: string;
  admin_notify_late: string;
  admin_notify_absent: string;
  admin_notify_new_cast: string;
  welcome_message: string;
};

const DEFAULT_CONFIG: ReminderConfig = {
  enabled: true,
  messageTemplate:
    "{name}さん、本日は {time} 出勤予定です。出勤確認をお願いいたします。",
  reply_present: "出勤を記録しました。本日もよろしくお願い致します。",
  reply_late:
    "遅刻の連絡を受け付けました。差し支えなければ、このチャットで『理由』と『到着予定時刻』を教えていただけますか？",
  reply_absent:
    "欠勤の連絡を受け付けました。この後、管理者から直接ご連絡させていただきます。",
  admin_notify_late:
    "【遅刻連絡】\n{name} さんから遅刻の連絡がありました。理由と到着予定時刻を確認してください。",
  admin_notify_absent:
    "【欠勤連絡】\n{name} さんから欠勤の連絡がありました。至急、連絡・シフト調整をお願いします。",
  admin_notify_new_cast: "新しく {name} さんが登録されました！",
  welcome_message:
    "{name}さん、はじめまして。出勤・退勤の連絡はこのLINEから行えます。よろしくお願いいたします。",
};

export default function AdminSettingsPage() {
  const activeStoreId = useActiveStoreId();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testComplete, setTestComplete] = useState(false);
  const [message, setMessage] = useState<
    "success" | "error" | "test_success" | "test_error" | null
  >(null);
  const [config, setConfig] = useState<ReminderConfig>(DEFAULT_CONFIG);
  const [remindTime, setRemindTime] = useState("07:00");

  const fetchConfig = useCallback(async () => {
    setLoading(true);
    const storeId = activeStoreId;
    try {
      const res = await fetch(
        `/api/admin/settings?storeId=${encodeURIComponent(storeId)}`
      );
      if (!res.ok) {
        console.error("[Settings] Fetch error:", res.status, await res.text());
        return;
      }
      const data = (await res.json()) as {
        remind_time?: string;
        reminder_config?: Record<string, unknown>;
      };

      if (
        typeof data.remind_time === "string" &&
        REMIND_TIME_OPTIONS.includes(data.remind_time)
      ) {
        setRemindTime(data.remind_time);
      }

      const v = data.reminder_config;
      if (v && typeof v === "object" && !Array.isArray(v)) {
        setConfig({
          enabled: Boolean(v.enabled ?? DEFAULT_CONFIG.enabled),
          messageTemplate:
            (typeof v.messageTemplate === "string" ? v.messageTemplate : null) ??
            (typeof v.template === "string" ? v.template : null) ??
            DEFAULT_CONFIG.messageTemplate,
          reply_present:
            typeof v.reply_present === "string"
              ? v.reply_present
              : DEFAULT_CONFIG.reply_present,
          reply_late:
            typeof v.reply_late === "string"
              ? v.reply_late
              : DEFAULT_CONFIG.reply_late,
          reply_absent:
            typeof v.reply_absent === "string"
              ? v.reply_absent
              : DEFAULT_CONFIG.reply_absent,
          admin_notify_late:
            typeof v.admin_notify_late === "string"
              ? v.admin_notify_late
              : DEFAULT_CONFIG.admin_notify_late,
          admin_notify_absent:
            typeof v.admin_notify_absent === "string"
              ? v.admin_notify_absent
              : DEFAULT_CONFIG.admin_notify_absent,
          admin_notify_new_cast:
            typeof v.admin_notify_new_cast === "string"
              ? v.admin_notify_new_cast
              : DEFAULT_CONFIG.admin_notify_new_cast,
          welcome_message:
            typeof v.welcome_message === "string"
              ? v.welcome_message
              : DEFAULT_CONFIG.welcome_message,
        });
      }
    } catch (err) {
      console.error("[Settings] Error:", err);
    } finally {
      setLoading(false);
    }
  }, [activeStoreId]);

  useEffect(() => {
    fetchConfig();
  }, [fetchConfig]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setMessage(null);
    try {
      const value: Record<string, unknown> = {
        enabled: config.enabled,
        sendTime: remindTime,
        messageTemplate: config.messageTemplate.trim() || DEFAULT_CONFIG.messageTemplate,
        reply_present: config.reply_present.trim() || DEFAULT_CONFIG.reply_present,
        reply_late: config.reply_late.trim() || DEFAULT_CONFIG.reply_late,
        reply_absent: config.reply_absent.trim() || DEFAULT_CONFIG.reply_absent,
        admin_notify_late: config.admin_notify_late.trim() || DEFAULT_CONFIG.admin_notify_late,
        admin_notify_absent: config.admin_notify_absent.trim() || DEFAULT_CONFIG.admin_notify_absent,
        admin_notify_new_cast: config.admin_notify_new_cast.trim() || DEFAULT_CONFIG.admin_notify_new_cast,
        welcome_message: config.welcome_message.trim() || DEFAULT_CONFIG.welcome_message,
      };

      const res = await fetch("/api/admin/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          storeId: activeStoreId,
          remind_time: remindTime,
          reminder_config: value,
        }),
      });

      const payload = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        details?: string;
      };

      if (!res.ok) {
        throw new Error(
          typeof payload.error === "string"
            ? payload.details
              ? `${payload.error}: ${payload.details}`
              : payload.error
            : "保存に失敗しました"
        );
      }
      if (payload.ok !== true) {
        throw new Error(
          typeof payload.error === "string" ? payload.error : "保存に失敗しました"
        );
      }
      setMessage("success");
    } catch (err) {
      console.error("[Settings] Save error:", err);
      setMessage("error");
    } finally {
      setSaving(false);
    }
  };

  const handleTestSend = async () => {
    setTesting(true);
    setTestComplete(false);
    setMessage(null);
    try {
      const res = await fetch("/api/remind?manual=true");
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error ?? "送信に失敗しました");
      }
      setTestComplete(true);
      setMessage("test_success");
      setTimeout(() => {
        setTestComplete(false);
        setTesting(false);
      }, 3000);
    } catch (err) {
      console.error("[Settings] Test send error:", err);
      setMessage("test_error");
      setTesting(false);
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
        <div className="mb-4 sm:mb-6">
          <h1 className="text-lg sm:text-xl font-bold text-gray-900 mb-1 sm:mb-2">
            システム設定
          </h1>
          <p className="text-xs sm:text-sm text-gray-600">
            リマインド・各種設定を管理します
          </p>
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

          <div className="mb-6">
            <label
              htmlFor="remindTime"
              className="block text-sm font-medium text-gray-700 mb-2"
            >
              リマインド送信時刻（日本時間）
            </label>
            <select
              id="remindTime"
              value={remindTime}
              onChange={(e) => setRemindTime(e.target.value)}
              className="w-full max-w-xs min-h-[48px] px-4 py-3 text-base border border-gray-300 rounded-lg bg-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
            >
              {REMIND_TIME_OPTIONS.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <p className="text-xs text-gray-500 mt-2">
              設定した時刻（分は常に :00）の日本時間に、本日未送信の店舗だけが対象でリマインドが送信されます。保存すると店舗マスタに反映されます。
              本番では毎時 GET /api/remind を呼ぶスケジューラが必要です（Vercel Pro なら crons で毎時可。Hobby は .github/workflows/remind-cron.yml の例を参照）。
            </p>
          </div>

          {/* リマインドメッセージテンプレート */}
          <div className="mb-8">
            <label
              htmlFor="messageTemplate"
              className="block text-sm font-medium text-gray-700 mb-2"
            >
              リマインドメッセージテンプレート
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
              placeholder="例: {name}さん、本日は {time} 出勤予定です。出勤確認をお願いいたします。"
              className="w-full min-h-[100px] px-4 py-3 text-base border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none placeholder-gray-400 resize-y"
            />
            <p className="text-xs text-gray-500 mt-1">
              ※ {"{name}"} はキャスト名、{"{time}"} は出勤時間に置換されます
            </p>
          </div>

          {/* ボタン押下時の自動返信メッセージ */}
          <h3 className="text-sm font-medium text-gray-700 mb-3 mt-8">
            ボタン押下時の自動返信
          </h3>
          <div className="mb-6">
            <label
              htmlFor="reply_present"
              className="block text-sm font-medium text-gray-700 mb-2"
            >
              出勤ボタンへの返信
            </label>
            <textarea
              id="reply_present"
              value={config.reply_present}
              onChange={(e) =>
                setConfig((c) => ({ ...c, reply_present: e.target.value }))
              }
              rows={2}
              placeholder="例: 出勤を記録しました。本日もよろしくお願い致します。"
              className="w-full min-h-[60px] px-4 py-3 text-base border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none placeholder-gray-400 resize-y"
            />
          </div>
          <div className="mb-6">
            <label
              htmlFor="reply_late"
              className="block text-sm font-medium text-gray-700 mb-2"
            >
              遅刻ボタンへの返信
            </label>
            <textarea
              id="reply_late"
              value={config.reply_late}
              onChange={(e) =>
                setConfig((c) => ({ ...c, reply_late: e.target.value }))
              }
              rows={2}
              placeholder="例: 遅刻の連絡を受け付けました。理由と到着予定時刻を教えてください。"
              className="w-full min-h-[60px] px-4 py-3 text-base border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none placeholder-gray-400 resize-y"
            />
          </div>
          <div className="mb-6">
            <label
              htmlFor="reply_absent"
              className="block text-sm font-medium text-gray-700 mb-2"
            >
              欠勤ボタンへの返信
            </label>
            <textarea
              id="reply_absent"
              value={config.reply_absent}
              onChange={(e) =>
                setConfig((c) => ({ ...c, reply_absent: e.target.value }))
              }
              rows={2}
              placeholder="例: 欠勤の連絡を受け付けました。管理者からご連絡します。"
              className="w-full min-h-[60px] px-4 py-3 text-base border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none placeholder-gray-400 resize-y"
            />
          </div>

          {/* 管理者への通知メッセージ */}
          <h3 className="text-sm font-medium text-gray-700 mb-3 mt-8">
            管理者への通知メッセージ
          </h3>
          <div className="mb-6">
            <label
              htmlFor="admin_notify_late"
              className="block text-sm font-medium text-gray-700 mb-2"
            >
              遅刻時の管理者通知
            </label>
            <textarea
              id="admin_notify_late"
              value={config.admin_notify_late}
              onChange={(e) =>
                setConfig((c) => ({ ...c, admin_notify_late: e.target.value }))
              }
              rows={2}
              placeholder="例: 【遅刻連絡】{name} さんから遅刻の連絡がありました。"
              className="w-full min-h-[60px] px-4 py-3 text-base border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none placeholder-gray-400 resize-y"
            />
            <p className="text-xs text-gray-500 mt-1">
              ※ {"{name}"} はキャスト名に置換されます
            </p>
          </div>
          <div className="mb-8">
            <label
              htmlFor="admin_notify_absent"
              className="block text-sm font-medium text-gray-700 mb-2"
            >
              欠勤時の管理者通知
            </label>
            <textarea
              id="admin_notify_absent"
              value={config.admin_notify_absent}
              onChange={(e) =>
                setConfig((c) => ({ ...c, admin_notify_absent: e.target.value }))
              }
              rows={2}
              placeholder="例: 【欠勤連絡】{name} さんから欠勤の連絡がありました。"
              className="w-full min-h-[60px] px-4 py-3 text-base border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none placeholder-gray-400 resize-y"
            />
            <p className="text-xs text-gray-500 mt-1">
              ※ {"{name}"} はキャスト名に置換されます
            </p>
          </div>

          {/* 新人登録時のメッセージ */}
          <h3 className="text-sm font-medium text-gray-700 mb-3 mt-8">
            新人登録時のメッセージ
          </h3>
          <div className="mb-6">
            <label
              htmlFor="admin_notify_new_cast"
              className="block text-sm font-medium text-gray-700 mb-2"
            >
              新人登録時の管理者通知
            </label>
            <textarea
              id="admin_notify_new_cast"
              value={config.admin_notify_new_cast}
              onChange={(e) =>
                setConfig((c) => ({ ...c, admin_notify_new_cast: e.target.value }))
              }
              rows={2}
              placeholder="例: 新しく {name} さんが登録されました！"
              className="w-full min-h-[60px] px-4 py-3 text-base border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none placeholder-gray-400 resize-y"
            />
            <p className="text-xs text-gray-500 mt-1">
              ※ {"{name}"} はキャスト名に置換されます
            </p>
          </div>
          <div className="mb-8">
            <label
              htmlFor="welcome_message"
              className="block text-sm font-medium text-gray-700 mb-2"
            >
              新人への挨拶メッセージ
            </label>
            <textarea
              id="welcome_message"
              value={config.welcome_message}
              onChange={(e) =>
                setConfig((c) => ({ ...c, welcome_message: e.target.value }))
              }
              rows={3}
              placeholder="例: {name}さん、はじめまして。出勤・退勤の連絡はこのLINEから行えます。"
              className="w-full min-h-[80px] px-4 py-3 text-base border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none placeholder-gray-400 resize-y"
            />
            <p className="text-xs text-gray-500 mt-1">
              ※ {"{name}"} はキャスト名に置換されます（友だち追加時に本人へ送信）
            </p>
          </div>

          <div className="flex flex-col sm:flex-row gap-3">
            <button
              type="submit"
              disabled={saving || testing}
              className="flex-1 min-h-[48px] h-12 px-6 bg-blue-600 text-white text-base font-medium rounded-lg hover:bg-blue-700 focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors touch-manipulation"
            >
              {saving ? "保存中..." : "設定を保存"}
            </button>
            <button
              type="button"
              onClick={handleTestSend}
              disabled={saving || testing}
              className="flex-1 min-h-[48px] h-12 px-6 bg-gray-700 text-white text-base font-medium rounded-lg hover:bg-gray-800 focus:ring-2 focus:ring-gray-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors touch-manipulation"
            >
              {testing
                ? testComplete
                  ? "テスト送信完了"
                  : "送信中..."
                : "今すぐテスト送信（本日分）"}
            </button>
          </div>
        </form>

        {message === "success" && (
          <p className="mt-4 text-green-600 text-sm font-medium">
            保存しました
          </p>
        )}
        {message === "test_success" && (
          <p className="mt-4 text-green-600 text-sm font-medium">
            テスト送信が完了しました
          </p>
        )}
        {message === "error" && (
          <p className="mt-4 text-red-600 text-sm">
            保存に失敗しました。再度お試しください。
          </p>
        )}
        {message === "test_error" && (
          <p className="mt-4 text-red-600 text-sm">
            テスト送信に失敗しました。再度お試しください。
          </p>
        )}
      </div>
    </div>
  );
}
