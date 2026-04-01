"use client";

import { useCallback, useEffect, useState } from "react";
import { useActiveStoreId } from "@/contexts/ActiveStoreContext";
import { DEFAULT_REGULAR_REMIND_BODY } from "@/lib/remind-employment";
import {
  DEFAULT_WELFARE_MESSAGE_EVENING,
  DEFAULT_WELFARE_MESSAGE_MIDDAY,
  DEFAULT_WELFARE_MESSAGE_MORNING,
} from "@/lib/welfare-line-flex";

/** 00:00〜23:00（1時間刻み） */
const REMIND_TIME_OPTIONS = Array.from({ length: 24 }, (_, h) => {
  const hh = String(h).padStart(2, "0");
  return `${hh}:00`;
});

/** 営業前サマリー送信 JST 時（stores.pre_open_report_hour_jst）。空文字は NULL（送信しない） */
const PRE_OPEN_HOUR_OPTIONS = Array.from({ length: 24 }, (_, h) => h);

/** 定休日: 0=日曜 … 6=土曜 */
const WEEKDAY_HOLIDAY_LABELS = ["日", "月", "火", "水", "木", "金", "土"] as const;

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
  const [businessType, setBusinessType] = useState<"cabaret" | "welfare_b">("cabaret");
  const [welfareMorning, setWelfareMorning] = useState("");
  const [welfareMidday, setWelfareMidday] = useState("");
  const [welfareEvening, setWelfareEvening] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testComplete, setTestComplete] = useState(false);
  const [message, setMessage] = useState<
    "success" | "error" | "test_success" | "test_error" | null
  >(null);
  const [saveWarning, setSaveWarning] = useState<string | null>(null);
  const [config, setConfig] = useState<ReminderConfig>(DEFAULT_CONFIG);
  const [remindTime, setRemindTime] = useState("07:00");
  const [allowShiftSubmission, setAllowShiftSubmission] = useState(false);
  const [enablePublicHoliday, setEnablePublicHoliday] = useState(false);
  const [enableHalfHoliday, setEnableHalfHoliday] = useState(false);
  /** 空文字 = 送信しない（NULL）、"0"〜"23" = その時台に送信 */
  const [preOpenReportHourJst, setPreOpenReportHourJst] = useState("");
  const [enableReservationCheck, setEnableReservationCheck] = useState(false);
  /** 定休日（曜日インデックス 0〜6） */
  const [regularHolidays, setRegularHolidays] = useState<number[]>([]);
  /** レギュラー向けリマインド本文（「○○さん、」の後） */
  const [regularRemindMessage, setRegularRemindMessage] = useState(DEFAULT_REGULAR_REMIND_BODY);

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
        business_type?: string;
        welfare_message_morning?: string | null;
        welfare_message_midday?: string | null;
        welfare_message_evening?: string | null;
        remind_time?: string;
        allow_shift_submission?: boolean;
        pre_open_report_hour_jst?: number | null;
        enable_public_holiday?: boolean;
        enable_half_holiday?: boolean;
        enable_reservation_check?: boolean;
        regular_holidays?: number[];
        regular_remind_message?: string;
        reminder_config?: Record<string, unknown>;
      };

      setBusinessType(data.business_type === "welfare_b" ? "welfare_b" : "cabaret");
      setWelfareMorning(
        typeof data.welfare_message_morning === "string" ? data.welfare_message_morning : ""
      );
      setWelfareMidday(
        typeof data.welfare_message_midday === "string" ? data.welfare_message_midday : ""
      );
      setWelfareEvening(
        typeof data.welfare_message_evening === "string" ? data.welfare_message_evening : ""
      );

      if (
        typeof data.remind_time === "string" &&
        REMIND_TIME_OPTIONS.includes(data.remind_time)
      ) {
        setRemindTime(data.remind_time);
      }
      setAllowShiftSubmission(data.allow_shift_submission === true);
      setEnablePublicHoliday(data.enable_public_holiday === true);
      setEnableHalfHoliday(data.enable_half_holiday === true);
      setEnableReservationCheck(data.enable_reservation_check === true);

      if (Array.isArray(data.regular_holidays)) {
        setRegularHolidays(
          [...new Set(data.regular_holidays.filter((n) => Number.isInteger(n) && n >= 0 && n <= 6))].sort(
            (a, b) => a - b
          )
        );
      } else {
        setRegularHolidays([]);
      }

      if (typeof data.regular_remind_message === "string" && data.regular_remind_message.trim()) {
        setRegularRemindMessage(data.regular_remind_message.trim());
      } else {
        setRegularRemindMessage(DEFAULT_REGULAR_REMIND_BODY);
      }

      const p = data.pre_open_report_hour_jst;
      if (typeof p === "number" && Number.isInteger(p) && p >= 0 && p <= 23) {
        setPreOpenReportHourJst(String(p));
      } else {
        setPreOpenReportHourJst("");
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
    setSaveWarning(null);
    try {
      if (businessType === "welfare_b") {
        const res = await fetch("/api/admin/settings", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            storeId: activeStoreId,
            welfare_settings_patch: true,
            welfare_message_morning: welfareMorning,
            welfare_message_midday: welfareMidday,
            welfare_message_evening: welfareEvening,
          }),
        });

        const payload = (await res.json().catch(() => ({}))) as {
          ok?: boolean;
          error?: string;
          details?: string;
          code?: string;
          hint?: string;
        };

        if (!res.ok) {
          throw new Error(
            typeof payload.error === "string"
              ? [payload.error, payload.details, payload.code ? `code=${payload.code}` : ""]
                  .filter(Boolean)
                  .join(" — ")
              : "保存に失敗しました"
          );
        }
        if (payload.ok !== true) {
          throw new Error(
            typeof payload.error === "string" ? payload.error : "保存に失敗しました"
          );
        }
        setMessage("success");
        return;
      }

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
          allow_shift_submission: allowShiftSubmission,
          enable_public_holiday: enablePublicHoliday,
          enable_half_holiday: enableHalfHoliday,
          pre_open_report_hour_jst:
            preOpenReportHourJst === "" ? null : parseInt(preOpenReportHourJst, 10),
          enable_reservation_check: enableReservationCheck,
          regular_holidays: regularHolidays,
          regular_remind_message:
            regularRemindMessage.trim() || DEFAULT_REGULAR_REMIND_BODY,
        }),
      });

      const payload = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        details?: string;
        code?: string;
        hint?: string;
        warning?: string;
        remind_time_persisted?: boolean;
      };

      if (!res.ok) {
        throw new Error(
          typeof payload.error === "string"
            ? [
                payload.error,
                payload.details,
                payload.code ? `code=${payload.code}` : "",
                payload.hint ? `hint=${payload.hint}` : "",
              ]
                .filter(Boolean)
                .join(" — ")
            : "保存に失敗しました"
        );
      }
      if (payload.ok !== true) {
        throw new Error(
          typeof payload.error === "string" ? payload.error : "保存に失敗しました"
        );
      }
      if (typeof payload.warning === "string" && payload.warning.trim()) {
        setSaveWarning(payload.warning.trim());
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
            {businessType === "welfare_b"
              ? "B型事業所向けの定期配信メッセージを管理します"
              : "リマインド・各種設定を管理します"}
          </p>
        </div>

        <form
          onSubmit={handleSave}
          className="rounded-lg border border-gray-200 bg-white shadow-sm p-4 sm:p-6"
        >
          {businessType === "welfare_b" ? (
            <>
              <h2 className="text-sm font-medium text-gray-700 mb-6">
                B型・定期配信メッセージ
              </h2>
              <p className="text-xs sm:text-sm text-gray-600 mb-6">
                朝9時・昼12時・夕17時の自動配信（GET /api/welfare/cron）に表示する本文です。空欄のまま保存するとシステム既定の文面が使われます。
              </p>
              <div className="mb-6">
                <label
                  htmlFor="welfareMorning"
                  className="block text-sm font-medium text-gray-700 mb-2"
                >
                  朝の点呼・作業開始メッセージ
                </label>
                <textarea
                  id="welfareMorning"
                  value={welfareMorning}
                  onChange={(e) => setWelfareMorning(e.target.value)}
                  rows={4}
                  placeholder={DEFAULT_WELFARE_MESSAGE_MORNING}
                  className="w-full min-h-[96px] px-4 py-3 text-base border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none resize-y"
                />
              </div>
              <div className="mb-6">
                <label
                  htmlFor="welfareMidday"
                  className="block text-sm font-medium text-gray-700 mb-2"
                >
                  昼の体調確認メッセージ
                </label>
                <textarea
                  id="welfareMidday"
                  value={welfareMidday}
                  onChange={(e) => setWelfareMidday(e.target.value)}
                  rows={4}
                  placeholder={DEFAULT_WELFARE_MESSAGE_MIDDAY}
                  className="w-full min-h-[96px] px-4 py-3 text-base border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none resize-y"
                />
              </div>
              <div className="mb-8">
                <label
                  htmlFor="welfareEvening"
                  className="block text-sm font-medium text-gray-700 mb-2"
                >
                  夕方の終了報告メッセージ
                </label>
                <textarea
                  id="welfareEvening"
                  value={welfareEvening}
                  onChange={(e) => setWelfareEvening(e.target.value)}
                  rows={4}
                  placeholder={DEFAULT_WELFARE_MESSAGE_EVENING}
                  className="w-full min-h-[96px] px-4 py-3 text-base border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none resize-y"
                />
              </div>
              <div className="flex flex-col sm:flex-row gap-3">
                <button
                  type="submit"
                  disabled={saving}
                  className="flex-1 min-h-[48px] h-12 px-6 bg-blue-600 text-white text-base font-medium rounded-lg hover:bg-blue-700 focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors touch-manipulation"
                >
                  {saving ? "保存中..." : "設定を保存"}
                </button>
              </div>
            </>
          ) : (
            <>
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
              本番では毎時 GET /api/remind を呼ぶスケジューラが必要です（例: Google Cloud Scheduler、Vercel Pro の crons など）。
            </p>
          </div>

          <div className="mb-6">
            <label
              htmlFor="regularRemindMessage"
              className="block text-sm font-medium text-gray-700 mb-2"
            >
              レギュラー向けリマインドメッセージ
            </label>
            <textarea
              id="regularRemindMessage"
              value={regularRemindMessage}
              onChange={(e) => setRegularRemindMessage(e.target.value)}
              rows={3}
              className="w-full min-h-[80px] px-4 py-3 text-base border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none resize-y"
              placeholder={DEFAULT_REGULAR_REMIND_BODY}
            />
            <p className="text-xs text-gray-500 mt-2">
              勤務形態が「レギュラー」のキャストに送る Flex 本文です。先頭に「（名前）さん、」が付きます。空にして保存した場合は「
              {DEFAULT_REGULAR_REMIND_BODY}」が使われます。
            </p>
          </div>

          <div className="mb-8 rounded-lg border border-gray-200 bg-gray-50/80 px-4 py-4">
            <h3 className="text-sm font-medium text-gray-800 mb-3">定休日設定</h3>
            <p className="text-xs text-gray-600 mb-3">
              チェックした曜日は定休日として扱い、その日のリマインド一斉送信（タイマー起動時）をスキップします。インデックスは 0=日曜〜6=土曜です。
            </p>
            <div className="flex flex-wrap gap-3 sm:gap-4">
              {WEEKDAY_HOLIDAY_LABELS.map((label, idx) => (
                <label
                  key={idx}
                  className="inline-flex items-center gap-2 cursor-pointer text-sm text-gray-800"
                >
                  <input
                    type="checkbox"
                    checked={regularHolidays.includes(idx)}
                    onChange={(e) => {
                      setRegularHolidays((prev) => {
                        if (e.target.checked) {
                          return [...new Set([...prev, idx])].sort((a, b) => a - b);
                        }
                        return prev.filter((d) => d !== idx);
                      });
                    }}
                    className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  <span>{label}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="mb-8 rounded-lg border border-gray-200 bg-gray-50/80 px-4 py-4">
            <h3 className="text-sm font-medium text-gray-800 mb-3">シフト提出</h3>
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={allowShiftSubmission}
                onChange={(e) => setAllowShiftSubmission(e.target.checked)}
                className="mt-0.5 h-5 w-5 shrink-0 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <span className="text-sm text-gray-700 leading-snug">
                キャストからのシフト提出を受け付ける
              </span>
            </label>
            <p className="text-xs text-gray-500 mt-2 pl-8">
              ON のときのみ、週間シフト一覧画面に「来週のシフトを提出する」導線（開発中）を表示します。
            </p>
          </div>

          <div className="mb-8 rounded-lg border border-gray-200 bg-gray-50/80 px-4 py-4">
            <h3 className="text-sm font-medium text-gray-800 mb-3">出勤確認（LINE Flex）</h3>
            <label className="flex items-start gap-3 cursor-pointer mb-4">
              <input
                type="checkbox"
                checked={enableHalfHoliday}
                onChange={(e) => setEnableHalfHoliday(e.target.checked)}
                className="mt-0.5 h-5 w-5 shrink-0 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <span className="text-sm text-gray-700 leading-snug">
                半休機能を有効にする（出勤確認カードに「半休」ボタンを表示）
              </span>
            </label>
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={enablePublicHoliday}
                onChange={(e) => setEnablePublicHoliday(e.target.checked)}
                className="mt-0.5 h-5 w-5 shrink-0 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <span className="text-sm text-gray-700 leading-snug">
                公休機能を有効にする（出勤確認カードに「公休」ボタンを表示）
              </span>
            </label>
            <p className="text-xs text-gray-500 mt-2 pl-8">
              どちらもオフの場合は、出勤・遅刻・欠勤の3ボタンのみが表示されます。業態に合わせて店舗ごとに設定してください。
            </p>
          </div>

          <div className="mb-8 rounded-lg border border-gray-200 bg-gray-50/80 px-4 py-4">
            <h3 className="text-sm font-medium text-gray-800 mb-3">出勤回答時の予約確認</h3>
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={enableReservationCheck}
                onChange={(e) => setEnableReservationCheck(e.target.checked)}
                className="mt-0.5 h-5 w-5 shrink-0 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <span className="text-sm text-gray-700 leading-snug">
                出勤回答時に予約（客予定）を確認する
              </span>
            </label>
            <p className="text-xs text-gray-500 mt-2 pl-8">
              ON のときのみ、出勤ボタン押下後に同伴・来客予定の Flex ヒアリングを送ります。OFF
              のときは「出勤を記録しました」の完了メッセージのみです。
            </p>
          </div>

          <div className="mb-8 rounded-lg border border-gray-200 bg-gray-50/80 px-4 py-4">
            <h3 className="text-sm font-medium text-gray-800 mb-3">営業前サマリー（日報）</h3>
            <label
              htmlFor="preOpenReportHour"
              className="block text-sm font-medium text-gray-700 mb-2"
            >
              送信時刻（日本時間）
            </label>
            <select
              id="preOpenReportHour"
              value={preOpenReportHourJst}
              onChange={(e) => setPreOpenReportHourJst(e.target.value)}
              className="w-full max-w-xs min-h-[48px] px-4 py-3 text-base border border-gray-300 rounded-lg bg-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
            >
              <option value="">送信しない</option>
              {PRE_OPEN_HOUR_OPTIONS.map((h) => (
                <option key={h} value={String(h)}>
                  {h}時
                </option>
              ))}
            </select>
            <p className="text-xs text-gray-500 mt-2">
              毎時0分（JST）にスケジューラが営業前サマリー API を店舗 ID なしで呼ぶと、送信時刻が一致する店舗だけに送られます。「送信しない」は NULL
              です。テストは <code className="text-xs bg-gray-100 px-1 rounded">?storeId=UUID</code> で強制送信できます。
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
            </>
          )}
        </form>

        {message === "success" && (
          <div className="mt-4 space-y-2">
            <p className="text-green-600 text-sm font-medium">保存しました</p>
            {saveWarning && (
              <p className="text-amber-800 text-sm bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                {saveWarning}
              </p>
            )}
          </div>
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
