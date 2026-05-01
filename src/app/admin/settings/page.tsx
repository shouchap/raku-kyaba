"use client";

import { useCallback, useEffect, useState } from "react";
import { useActiveStoreId } from "@/contexts/ActiveStoreContext";
import { DEFAULT_REGULAR_REMIND_BODY } from "@/lib/remind-employment";
import {
  DEFAULT_WELFARE_MESSAGE_EVENING,
  DEFAULT_WELFARE_MESSAGE_MIDDAY,
  DEFAULT_WELFARE_MESSAGE_MORNING,
  DEFAULT_WELFARE_WORK_ITEMS_CSV,
} from "@/lib/welfare-line-flex";
import { TIME_OPTIONS } from "@/lib/time-options";

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

type GuideReporterCandidate = {
  id: string;
  name: string;
  line_user_id: string | null;
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

function normalizeGuideHearingTime(value: string): string {
  const m = value.trim().match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  if (!m) return "02:00";
  return `${m[1]}:00`;
}

export default function AdminSettingsPage() {
  const activeStoreId = useActiveStoreId();
  const [businessType, setBusinessType] = useState<"cabaret" | "welfare_b" | "bar">("cabaret");
  /** BAR（ELINE）向け LINE 来客ヒアリング */
  const [askGuestName, setAskGuestName] = useState(true);
  const [askGuestTime, setAskGuestTime] = useState(false);
  const [welfareMorning, setWelfareMorning] = useState("");
  const [welfareMidday, setWelfareMidday] = useState("");
  const [welfareEvening, setWelfareEvening] = useState("");
  /** LINE 友だち追加時（follow）の返信。空欄でキャバクラ系既定へフォールバック */
  const [welfareWelcome, setWelfareWelcome] = useState("");
  /** 作業項目（1行1項目）。保存時にカンマ結合 */
  const [welfareWorkItemRows, setWelfareWorkItemRows] = useState<string[]>([""]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testingGuide, setTestingGuide] = useState(false);
  const [testComplete, setTestComplete] = useState(false);
  const [guideTestComplete, setGuideTestComplete] = useState(false);
  const [testErrorDetail, setTestErrorDetail] = useState<string | null>(null);
  const [guideTestErrorDetail, setGuideTestErrorDetail] = useState<string | null>(null);
  const [guideTestResultDetail, setGuideTestResultDetail] = useState<string | null>(null);
  const [message, setMessage] = useState<
    "success" | "error" | "test_success" | "test_error" | "guide_test_success" | "guide_test_error" | null
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
  /** 週間シフト「レギュラー一括設定」用のデフォルト出勤時刻（空＝未設定） */
  const [regularStartTime, setRegularStartTime] = useState("");
  const [guideHearingEnabled, setGuideHearingEnabled] = useState(false);
  const [guideHearingTime, setGuideHearingTime] = useState("02:00");
  const [guideHearingReporterId, setGuideHearingReporterId] = useState("");
  const [guideReporterCandidates, setGuideReporterCandidates] = useState<GuideReporterCandidate[]>([]);
  const [guideStaffInput, setGuideStaffInput] = useState("");
  const [guideStaffNames, setGuideStaffNames] = useState<string[]>([]);

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
        welfare_message_welcome?: string | null;
        welfare_work_items?: string | null;
        remind_time?: string;
        allow_shift_submission?: boolean;
        pre_open_report_hour_jst?: number | null;
        enable_public_holiday?: boolean;
        enable_half_holiday?: boolean;
        enable_reservation_check?: boolean;
        ask_guest_name?: boolean;
        ask_guest_time?: boolean;
        regular_holidays?: number[];
        regular_remind_message?: string;
        regular_start_time?: string | null;
        reminder_config?: Record<string, unknown>;
      };

      setBusinessType(
        data.business_type === "welfare_b"
          ? "welfare_b"
          : data.business_type === "bar"
            ? "bar"
            : "cabaret"
      );
      setAskGuestName(data.ask_guest_name !== false);
      setAskGuestTime(data.ask_guest_time === true);
      setWelfareMorning(
        typeof data.welfare_message_morning === "string" ? data.welfare_message_morning : ""
      );
      setWelfareMidday(
        typeof data.welfare_message_midday === "string" ? data.welfare_message_midday : ""
      );
      setWelfareEvening(
        typeof data.welfare_message_evening === "string" ? data.welfare_message_evening : ""
      );
      setWelfareWelcome(
        typeof data.welfare_message_welcome === "string" ? data.welfare_message_welcome : ""
      );
      {
        const csv =
          typeof data.welfare_work_items === "string" ? data.welfare_work_items.trim() : "";
        const parts = csv
          ? csv
              .split(",")
              .map((s) => s.trim())
              .filter((s) => s.length > 0)
          : [];
        setWelfareWorkItemRows(parts.length > 0 ? parts : [""]);
      }

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

      if (typeof data.regular_start_time === "string" && data.regular_start_time.trim()) {
        const rst = data.regular_start_time.trim();
        const allowed = TIME_OPTIONS.some((o) => o.value === rst);
        setRegularStartTime(allowed ? rst : "");
      } else {
        setRegularStartTime("");
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

      const guideRes = await fetch(
        `/api/admin/guide-hearing?storeId=${encodeURIComponent(storeId)}`
      );
      if (guideRes.ok) {
        const guideData = (await guideRes.json()) as {
          enabled?: boolean;
          sendTime?: string;
          reporterCastId?: string | null;
          reporterCandidates?: GuideReporterCandidate[];
          guideStaffNames?: string[];
        };
        setGuideHearingEnabled(guideData.enabled === true);
        if (
          typeof guideData.sendTime === "string" &&
          REMIND_TIME_OPTIONS.includes(guideData.sendTime)
        ) {
          setGuideHearingTime(guideData.sendTime);
        }
        setGuideHearingReporterId(
          typeof guideData.reporterCastId === "string" ? guideData.reporterCastId : ""
        );
        setGuideReporterCandidates(
          Array.isArray(guideData.reporterCandidates) ? guideData.reporterCandidates : []
        );
        setGuideStaffNames(
          Array.isArray(guideData.guideStaffNames)
            ? guideData.guideStaffNames.map((v) => String(v ?? "").trim()).filter(Boolean)
            : []
        );
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

  const saveGuideHearing = async () => {
    const res = await fetch("/api/admin/guide-hearing", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        storeId: activeStoreId,
        enabled: guideHearingEnabled,
        sendTime: normalizeGuideHearingTime(guideHearingTime),
        reporterCastId: guideHearingReporterId === "" ? null : guideHearingReporterId,
        guideStaffNames,
      }),
    });
    if (!res.ok) {
      const payload = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(payload.error ?? "案内数ヒアリング設定の保存に失敗しました");
    }
  };

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
            business_type: "welfare_b",
            welfare_message_morning: welfareMorning,
            welfare_message_midday: welfareMidday,
            welfare_message_evening: welfareEvening,
            welfare_message_welcome: welfareWelcome,
            welfare_work_items: welfareWorkItemRows.map((s) => s.trim()).filter(Boolean).join(","),
            regular_holidays: regularHolidays,
            regular_start_time: regularStartTime.trim() === "" ? null : regularStartTime.trim(),
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
        await saveGuideHearing();
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
          regular_start_time: regularStartTime.trim() === "" ? null : regularStartTime.trim(),
          business_type: businessType,
          ask_guest_name: askGuestName,
          ask_guest_time: askGuestTime,
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
      await saveGuideHearing();
      setMessage("success");
    } catch (err) {
      console.error("[Settings] Save error:", err);
      setMessage("error");
    } finally {
      setSaving(false);
    }
  };

  const handleRemindTestSend = async () => {
    setTesting(true);
    setTestComplete(false);
    setTestErrorDetail(null);
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
      setTestErrorDetail(err instanceof Error ? err.message : "テスト送信に失敗しました");
      setMessage("test_error");
      setTesting(false);
    }
  };

  const handleGuideHearingTestSend = async () => {
    setTestingGuide(true);
    setGuideTestComplete(false);
    setGuideTestErrorDetail(null);
    setGuideTestResultDetail(null);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/guide-hearing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storeId: activeStoreId }),
      });
      const data = (await res.json()) as {
        error?: string;
        sent?: number;
        failedCount?: number;
        tokenSource?: string;
        targetCount?: number;
        reporter?: { name?: string | null };
      };
      if (!res.ok) {
        throw new Error(data.error ?? "送信に失敗しました");
      }
      const sent = typeof data.sent === "number" ? data.sent : 0;
      const failedCount = typeof data.failedCount === "number" ? data.failedCount : 0;
      const tokenSource = typeof data.tokenSource === "string" ? data.tokenSource : "unknown";
      const targetCount = typeof data.targetCount === "number" ? data.targetCount : 0;
      const reporterName = data.reporter?.name?.trim() || "担当者";
      setGuideTestResultDetail(
        `${reporterName}へ送信 ${sent}件 / 対象スタッフ ${targetCount}名（失敗 ${failedCount}件, token: ${tokenSource}）`
      );
      setGuideTestComplete(true);
      setMessage("guide_test_success");
      setTimeout(() => {
        setGuideTestComplete(false);
        setTestingGuide(false);
      }, 3000);
    } catch (err) {
      console.error("[Settings] Guide test send error:", err);
      setGuideTestErrorDetail(
        err instanceof Error ? err.message : "案内数ヒアリングのテスト送信に失敗しました"
      );
      setMessage("guide_test_error");
      setTestingGuide(false);
    }
  };

  const guideHearingSection = (
    <div className="mb-8 rounded-lg border border-emerald-200 bg-emerald-50/60 px-4 py-4">
      <h3 className="text-sm font-medium text-gray-900 mb-3">案内数ヒアリング設定</h3>
      <label className="flex items-start gap-3 cursor-pointer mb-4">
        <input
          type="checkbox"
          checked={guideHearingEnabled}
          onChange={(e) => setGuideHearingEnabled(e.target.checked)}
          className="mt-0.5 h-5 w-5 shrink-0 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500"
        />
        <span className="text-sm text-gray-700 leading-snug">
          営業終了時に担当者へ LINE で案内実績をヒアリングする（セクキャバ・GOLD の組数・人数を順に入力）
        </span>
      </label>

      <label htmlFor="guideHearingTime" className="block text-sm font-medium text-gray-700 mb-2">
        送信時刻（日本時間）
      </label>
      <select
        id="guideHearingTime"
        value={guideHearingTime}
        onChange={(e) => setGuideHearingTime(e.target.value)}
        className="w-full max-w-xs min-h-[48px] px-4 py-3 text-base border border-gray-300 rounded-lg bg-white focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none"
      >
        {REMIND_TIME_OPTIONS.map((t) => (
          <option key={`guide-${t}`} value={t}>
            {t}
          </option>
        ))}
      </select>
      <p className="mt-2 text-xs text-gray-500">
        ヒアリング対象の個別指定は「キャスト管理」画面で設定します。
      </p>
      <label htmlFor="guideHearingReporter" className="block text-sm font-medium text-gray-700 mt-4 mb-2">
        LINE受取担当者（1名）
      </label>
      <select
        id="guideHearingReporter"
        value={guideHearingReporterId}
        onChange={(e) => setGuideHearingReporterId(e.target.value)}
        className="w-full max-w-md min-h-[48px] px-4 py-3 text-base border border-gray-300 rounded-lg bg-white focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none"
      >
        <option value="">未選択</option>
        {guideReporterCandidates.map((c) => (
          <option key={c.id} value={c.id} disabled={!c.line_user_id}>
            {c.name}{c.line_user_id ? "" : "（LINE未連携）"}
          </option>
        ))}
      </select>
      <label htmlFor="guideStaffInput" className="block text-sm font-medium text-gray-700 mt-4 mb-2">
        案内スタッフの名前登録
      </label>
      <div className="flex flex-col sm:flex-row gap-2">
        <input
          id="guideStaffInput"
          type="text"
          value={guideStaffInput}
          onChange={(e) => setGuideStaffInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            e.preventDefault();
            const name = guideStaffInput.trim();
            if (!name) return;
            setGuideStaffNames((prev) => (prev.includes(name) ? prev : [...prev, name]));
            setGuideStaffInput("");
          }}
          placeholder="例: A君"
          className="w-full max-w-md min-h-[48px] px-4 py-3 text-base border border-gray-300 rounded-lg bg-white focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none"
        />
        <button
          type="button"
          onClick={() => {
            const name = guideStaffInput.trim();
            if (!name) return;
            setGuideStaffNames((prev) => (prev.includes(name) ? prev : [...prev, name]));
            setGuideStaffInput("");
          }}
          className="min-h-[48px] px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700"
        >
          追加
        </button>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {guideStaffNames.length === 0 ? (
          <p className="text-xs text-gray-500">未登録です。入力して追加してください。</p>
        ) : (
          guideStaffNames.map((name) => (
            <span
              key={name}
              className="inline-flex items-center gap-2 rounded-full bg-emerald-100 text-emerald-900 px-3 py-1 text-xs"
            >
              {name}
              <button
                type="button"
                onClick={() => setGuideStaffNames((prev) => prev.filter((v) => v !== name))}
                className="text-emerald-700 hover:text-emerald-900"
                aria-label={`${name} を削除`}
              >
                ×
              </button>
            </span>
          ))
        )}
      </div>
    </div>
  );

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
              ? "福祉施設向けの定期配信メッセージを管理します"
              : businessType === "bar"
                ? "BAR 向けのリマインド・来客ヒアリングを管理します"
                : "リマインド・各種設定を管理します"}
          </p>
        </div>

        <form
          onSubmit={handleSave}
          className="rounded-lg border border-gray-200 bg-white shadow-sm p-4 sm:p-6"
        >
          <div className="mb-8 rounded-lg border border-amber-200 bg-amber-50/60 px-4 py-4">
            <h3 className="text-sm font-medium text-gray-900 mb-3">業態</h3>
            <p className="text-xs text-gray-600 mb-4">
              キャバクラ・BAR・福祉で、LINEのリマインドやヒアリングの挙動、および日報のデータ構造が異なります。店舗の業態に合わせて正しく選択してください。
            </p>
            <div className="flex flex-col sm:flex-row flex-wrap gap-3">
              <label className="inline-flex items-center gap-2 cursor-pointer text-sm text-gray-800">
                <input
                  type="radio"
                  name="storeBusinessType"
                  checked={businessType === "cabaret"}
                  onChange={() => setBusinessType("cabaret")}
                  className="h-4 w-4 border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                キャバクラ
              </label>
              <label className="inline-flex items-center gap-2 cursor-pointer text-sm text-gray-800">
                <input
                  type="radio"
                  name="storeBusinessType"
                  checked={businessType === "bar"}
                  onChange={() => setBusinessType("bar")}
                  className="h-4 w-4 border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                BAR
              </label>
              <label className="inline-flex items-center gap-2 cursor-pointer text-sm text-gray-800">
                <input
                  type="radio"
                  name="storeBusinessType"
                  checked={businessType === "welfare_b"}
                  onChange={() => setBusinessType("welfare_b")}
                  className="h-4 w-4 border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                福祉
              </label>
            </div>
          </div>

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
              <div className="mb-8">
                <label
                  htmlFor="welfareWelcome"
                  className="block text-sm font-medium text-gray-700 mb-2"
                >
                  ウェルカムメッセージ（友だち追加時）
                </label>
                <p className="text-xs sm:text-sm text-gray-600 mb-3">
                  LINE で事業所の公式アカウントを友だち追加した直後に送るテキストです。文面中の{" "}
                  <code className="text-gray-800 bg-gray-100 px-1 rounded">{"{name}"}</code>
                  {" "}
                  は表示名に置き換えられます。空欄のまま保存すると、キャバクラ向けの既定文面（システム設定のウェルカムと同じ系統）にフォールバックします。改行はそのまま送信されます。
                </p>
                <textarea
                  id="welfareWelcome"
                  value={welfareWelcome}
                  onChange={(e) => setWelfareWelcome(e.target.value)}
                  rows={5}
                  placeholder={DEFAULT_CONFIG.welcome_message}
                  className="w-full min-h-[120px] px-4 py-3 text-base border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none resize-y whitespace-pre-wrap"
                />
              </div>
              <div className="mb-8">
                <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                  <span className="block text-sm font-medium text-gray-700">作業項目の設定</span>
                  <button
                    type="button"
                    onClick={() => setWelfareWorkItemRows((rows) => [...rows, ""])}
                    className="text-sm font-medium text-blue-700 hover:text-blue-900 px-3 py-1.5 rounded-lg border border-blue-200 bg-blue-50 hover:bg-blue-100"
                  >
                    項目の追加
                  </button>
                </div>
                <ul className="space-y-3">
                  {welfareWorkItemRows.map((value, index) => (
                    <li key={index} className="flex flex-col sm:flex-row gap-2 sm:items-center">
                      <input
                        type="text"
                        id={`welfareWorkItem-${index}`}
                        name={`welfareWorkItem-${index}`}
                        value={value}
                        onChange={(e) => {
                          const v = e.target.value;
                          setWelfareWorkItemRows((rows) =>
                            rows.map((row, i) => (i === index ? v : row))
                          );
                        }}
                        placeholder={
                          index === 0 ? DEFAULT_WELFARE_WORK_ITEMS_CSV.split(",")[0] : "作業名"
                        }
                        className="flex-1 min-h-[48px] px-4 py-3 text-base border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                        autoComplete="off"
                      />
                      <button
                        type="button"
                        onClick={() =>
                          setWelfareWorkItemRows((rows) => {
                            if (rows.length <= 1) return [""];
                            return rows.filter((_, i) => i !== index);
                          })
                        }
                        className="shrink-0 min-h-[48px] px-4 py-2 text-sm font-medium text-red-700 border border-red-200 rounded-lg bg-red-50 hover:bg-red-100 sm:w-24"
                      >
                        削除
                      </button>
                    </li>
                  ))}
                </ul>
                <p className="text-xs text-gray-500 mt-3">
                  1行に1項目。すべて空欄で保存すると既定（{DEFAULT_WELFARE_WORK_ITEMS_CSV}
                  ）が使われます。夕方の「作業を終了する」後のボタンに反映されます。
                </p>
              </div>
              <div className="mb-6">
                <label
                  htmlFor="regularStartTimeWelfare"
                  className="block text-sm font-medium text-gray-700 mb-2"
                >
                  レギュラー出勤時間（週間シフト一括入力用）
                </label>
                <select
                  id="regularStartTimeWelfare"
                  value={regularStartTime}
                  onChange={(e) => setRegularStartTime(e.target.value)}
                  className="w-full max-w-xs min-h-[48px] px-4 py-3 text-base border border-gray-300 rounded-lg bg-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                >
                  {TIME_OPTIONS.map((opt) => (
                    <option key={opt.value || "unset-w"} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-gray-500 mt-2">
                  週間シフトの「レギュラー一括設定」に使用します。未選択（—）のままでは一括設定は使えません。
                </p>
              </div>
              <div className="mb-8 rounded-lg border border-gray-200 bg-gray-50/80 px-4 py-4">
                <h3 className="text-sm font-medium text-gray-800 mb-3">定休日設定</h3>
                <p className="text-xs text-gray-600 mb-3">
                  チェックした曜日は定休日として扱い、その日の朝・昼・夕の自動配信（GET /api/welfare/cron）をスキップします。0=日曜〜6=土曜です。
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
              {guideHearingSection}
              <div className="flex flex-col sm:flex-row flex-wrap gap-2">
                <button
                  type="submit"
                  disabled={saving || testing || testingGuide}
                  className="flex-1 min-h-[44px] min-w-0 px-2 py-2.5 sm:px-4 bg-blue-600 text-white text-[11px] font-medium leading-tight rounded-lg hover:bg-blue-700 focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors touch-manipulation whitespace-nowrap sm:text-sm"
                >
                  {saving ? "保存中..." : "設定を保存"}
                </button>
                <button
                  type="button"
                  onClick={handleRemindTestSend}
                  disabled={saving || testing || testingGuide}
                  className="flex-1 min-h-[44px] min-w-0 px-2 py-2.5 sm:px-4 bg-gray-700 text-white text-[11px] font-medium leading-tight rounded-lg hover:bg-gray-800 focus:ring-2 focus:ring-gray-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors touch-manipulation whitespace-nowrap sm:text-sm"
                >
                  {testing ? (testComplete ? "送信完了" : "送信中…") : "キャスト本日テスト送信"}
                </button>
                <button
                  type="button"
                  onClick={handleGuideHearingTestSend}
                  disabled={saving || testing || testingGuide}
                  className="flex-1 min-h-[44px] min-w-0 px-2 py-2.5 sm:px-4 bg-emerald-700 text-white text-[11px] font-medium leading-tight rounded-lg hover:bg-emerald-800 focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors touch-manipulation whitespace-nowrap sm:text-sm"
                >
                  {testingGuide ? (guideTestComplete ? "送信完了" : "送信中…") : "ヒアリングテスト送信"}
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

          <div className="mb-6">
            <label
              htmlFor="regularStartTime"
              className="block text-sm font-medium text-gray-700 mb-2"
            >
              レギュラー出勤時間（週間シフト一括入力用）
            </label>
            <select
              id="regularStartTime"
              value={regularStartTime}
              onChange={(e) => setRegularStartTime(e.target.value)}
              className="w-full max-w-xs min-h-[48px] px-4 py-3 text-base border border-gray-300 rounded-lg bg-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
            >
              {TIME_OPTIONS.map((opt) => (
                <option key={opt.value || "unset"} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
            <p className="text-xs text-gray-500 mt-2">
              週間シフト登録画面の「レギュラー一括設定」で、勤務形態がレギュラーのキャストにこの時刻をまとめて入れます。「—」のままでは一括設定は使えません（保存後も未設定扱い）。
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

          {businessType === "bar" && (
            <div className="mb-8 rounded-lg border border-indigo-200 bg-indigo-50/70 px-4 py-4">
              <h3 className="text-sm font-medium text-gray-900 mb-2">
                出勤時の質問設定（BAR）
              </h3>
              <p className="text-xs text-gray-600 mb-4">
                組数の回答後、来客の名前・来店時間をどこまで聞くかを店舗ごとに設定します（BAR
                業態の LINE のみ）。
              </p>
              <label className="flex items-start gap-3 cursor-pointer mb-4">
                <input
                  type="checkbox"
                  checked={askGuestName}
                  onChange={(e) => setAskGuestName(e.target.checked)}
                  className="mt-0.5 h-5 w-5 shrink-0 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                <span className="text-sm text-gray-700 leading-snug">
                  来客の名前を質問する（組数ぶん「◯組目のお客様のお名前…」と順に聞きます）
                </span>
              </label>
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={askGuestTime}
                  onChange={(e) => setAskGuestTime(e.target.checked)}
                  className="mt-0.5 h-5 w-5 shrink-0 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                <span className="text-sm text-gray-700 leading-snug">
                  来客の時間を質問する（来店予定の Flex・組ごとの時間ループ）
                </span>
              </label>
              <p className="text-xs text-gray-500 mt-3 pl-8">
                名前をオフにし時間をオンにした場合は、キャバクラ系と同様に組数の直後から来店時間の
                Flex に進みます。両方オフの場合は組数のみ記録して完了します。
              </p>
            </div>
          )}

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
          {guideHearingSection}

          <div className="flex flex-col sm:flex-row flex-wrap gap-2">
            <button
              type="submit"
              disabled={saving || testing || testingGuide}
              className="flex-1 min-h-[44px] min-w-0 px-2 py-2.5 sm:px-4 bg-blue-600 text-white text-[11px] font-medium leading-tight rounded-lg hover:bg-blue-700 focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors touch-manipulation whitespace-nowrap sm:text-sm"
            >
              {saving ? "保存中..." : "設定を保存"}
            </button>
            <button
              type="button"
              onClick={handleRemindTestSend}
              disabled={saving || testing || testingGuide}
              className="flex-1 min-h-[44px] min-w-0 px-2 py-2.5 sm:px-4 bg-gray-700 text-white text-[11px] font-medium leading-tight rounded-lg hover:bg-gray-800 focus:ring-2 focus:ring-gray-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors touch-manipulation whitespace-nowrap sm:text-sm"
            >
              {testing ? (testComplete ? "送信完了" : "送信中…") : "キャスト本日テスト送信"}
            </button>
            <button
              type="button"
              onClick={handleGuideHearingTestSend}
              disabled={saving || testing || testingGuide}
              className="flex-1 min-h-[44px] min-w-0 px-2 py-2.5 sm:px-4 bg-emerald-700 text-white text-[11px] font-medium leading-tight rounded-lg hover:bg-emerald-800 focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors touch-manipulation whitespace-nowrap sm:text-sm"
            >
              {testingGuide ? (guideTestComplete ? "送信完了" : "送信中…") : "ヒアリングテスト送信"}
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
        {message === "guide_test_success" && (
          <div className="mt-4 space-y-1">
            <p className="text-green-600 text-sm font-medium">
              案内数ヒアリングのテスト送信が完了しました
            </p>
            {guideTestResultDetail && (
              <p className="text-xs text-gray-600">{guideTestResultDetail}</p>
            )}
          </div>
        )}
        {message === "error" && (
          <p className="mt-4 text-red-600 text-sm">
            保存に失敗しました。再度お試しください。
          </p>
        )}
        {message === "test_error" && (
          <p className="mt-4 text-red-600 text-sm">
            {testErrorDetail ?? "テスト送信に失敗しました。再度お試しください。"}
          </p>
        )}
        {message === "guide_test_error" && (
          <p className="mt-4 text-red-600 text-sm">
            {guideTestErrorDetail ??
              "案内数ヒアリングのテスト送信に失敗しました。再度お試しください。"}
          </p>
        )}
      </div>
    </div>
  );
}
