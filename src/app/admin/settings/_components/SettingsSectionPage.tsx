"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Info } from "lucide-react";
import { useActiveStoreId } from "@/contexts/ActiveStoreContext";
import { DEFAULT_REGULAR_REMIND_BODY } from "@/lib/remind-employment";
import { TIME_OPTIONS } from "@/lib/time-options";
import { canonicalGuideHearingTime } from "@/lib/guide-hearing";
import { DEFAULT_CUSTOM_TERMS, resolveCustomTerms, serializeCustomTerms } from "@/lib/custom-terms";

type Section = "store" | "line" | "features" | "admins";
type BusinessType = "cabaret" | "welfare_b" | "bar";

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

type SnapshotShape = {
  businessType: BusinessType;
  config: ReminderConfig;
  remindTime: string;
  preOpenReportHourJst: string;
  allowShiftSubmission: boolean;
  enablePublicHoliday: boolean;
  enableHalfHoliday: boolean;
  enableReservationCheck: boolean;
  regularHolidays: number[];
  regularStartTime: string;
  regularRemindMessage: string;
  askGuestName: boolean;
  askGuestTime: boolean;
  attendanceFlowType: "default" | "bar_extended";
  isGuideMasterEnabled: boolean;
  isDohanSabakiEnabled: boolean;
  guideHearingEnabled: boolean;
  guideHearingTime: string;
  guideHearingReporterId: string;
  termAttendance: string;
  termCast: string;
};

const REMIND_TIME_OPTIONS = Array.from({ length: 24 }, (_, h) => `${String(h).padStart(2, "0")}:00`);
const PRE_OPEN_HOUR_OPTIONS = Array.from({ length: 24 }, (_, h) => h);
const WEEKDAY_HOLIDAY_LABELS = ["日", "月", "火", "水", "木", "金", "土"] as const;

const DEFAULT_CONFIG: ReminderConfig = {
  enabled: true,
  messageTemplate: "{name}さん、本日は {time} 出勤予定です。出勤確認をお願いいたします。",
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

const CONTROL_CLASS =
  "rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 placeholder:text-slate-400 disabled:bg-slate-100 disabled:text-slate-500 disabled:border-slate-300";

function Tip({ text }: { text: string }) {
  return (
    <span title={text} aria-label={text} className="inline-flex items-center text-slate-400">
      <Info className="h-4 w-4" />
    </span>
  );
}

export default function SettingsSectionPage({ section }: { section: Section }) {
  const activeStoreId = useActiveStoreId();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [initialSnapshot, setInitialSnapshot] = useState("");

  const [businessType, setBusinessType] = useState<BusinessType>("cabaret");
  const [config, setConfig] = useState<ReminderConfig>(DEFAULT_CONFIG);
  const [remindTime, setRemindTime] = useState("07:00");
  const [preOpenReportHourJst, setPreOpenReportHourJst] = useState("");
  const [allowShiftSubmission, setAllowShiftSubmission] = useState(false);
  const [enablePublicHoliday, setEnablePublicHoliday] = useState(false);
  const [enableHalfHoliday, setEnableHalfHoliday] = useState(false);
  const [enableReservationCheck, setEnableReservationCheck] = useState(false);
  const [regularHolidays, setRegularHolidays] = useState<number[]>([]);
  const [regularStartTime, setRegularStartTime] = useState("");
  const [regularRemindMessage, setRegularRemindMessage] = useState(DEFAULT_REGULAR_REMIND_BODY);
  const [askGuestName, setAskGuestName] = useState(true);
  const [askGuestTime, setAskGuestTime] = useState(false);
  const [attendanceFlowType, setAttendanceFlowType] = useState<"default" | "bar_extended">("default");
  const [isGuideMasterEnabled, setIsGuideMasterEnabled] = useState(true);
  const [isDohanSabakiEnabled, setIsDohanSabakiEnabled] = useState(true);
  const [termAttendance, setTermAttendance] = useState(DEFAULT_CUSTOM_TERMS.term_attendance);
  const [termCast, setTermCast] = useState(DEFAULT_CUSTOM_TERMS.term_cast);

  const [guideHearingEnabled, setGuideHearingEnabled] = useState(false);
  const [guideHearingTime, setGuideHearingTime] = useState("02:00");
  const [guideHearingReporterId, setGuideHearingReporterId] = useState("");
  const [guideReporterCandidates, setGuideReporterCandidates] = useState<GuideReporterCandidate[]>([]);

  const [individualTestCastId, setIndividualTestCastId] = useState("");
  const [barSummaryTestCastId, setBarSummaryTestCastId] = useState("");
  const [testingIndividual, setTestingIndividual] = useState(false);
  const [testingBarSummary, setTestingBarSummary] = useState(false);
  const [broadcastingRemind, setBroadcastingRemind] = useState(false);
  const [individualTestDetail, setIndividualTestDetail] = useState<string | null>(null);
  const [barSummaryTestDetail, setBarSummaryTestDetail] = useState<string | null>(null);
  const [broadcastRemindDetail, setBroadcastRemindDetail] = useState<string | null>(null);
  const [broadcastFailedCastNames, setBroadcastFailedCastNames] = useState<string[]>([]);

  const createSnapshotObj = useCallback((): SnapshotShape => {
    return {
      businessType,
      config,
      remindTime,
      preOpenReportHourJst,
      allowShiftSubmission,
      enablePublicHoliday,
      enableHalfHoliday,
      enableReservationCheck,
      regularHolidays: [...regularHolidays].sort((a, b) => a - b),
      regularStartTime,
      regularRemindMessage,
      askGuestName,
      askGuestTime,
      attendanceFlowType,
      isGuideMasterEnabled,
      isDohanSabakiEnabled,
      guideHearingEnabled,
      guideHearingTime,
      guideHearingReporterId,
      termAttendance,
      termCast,
    };
  }, [
    businessType,
    config,
    remindTime,
    preOpenReportHourJst,
    allowShiftSubmission,
    enablePublicHoliday,
    enableHalfHoliday,
    enableReservationCheck,
    regularHolidays,
    regularStartTime,
    regularRemindMessage,
    askGuestName,
    askGuestTime,
    attendanceFlowType,
    isGuideMasterEnabled,
    isDohanSabakiEnabled,
    guideHearingEnabled,
    guideHearingTime,
    guideHearingReporterId,
    termAttendance,
    termCast,
  ]);

  const createSnapshot = useCallback(() => JSON.stringify(createSnapshotObj()), [createSnapshotObj]);

  const isDirty = useMemo(
    () => !loading && initialSnapshot !== "" && createSnapshot() !== initialSnapshot,
    [loading, initialSnapshot, createSnapshot]
  );

  const DIRTY_LABELS: Record<keyof SnapshotShape, string> = {
    businessType: "店舗種別",
    config: "通知メッセージ設定",
    remindTime: "リマインド時刻",
    preOpenReportHourJst: "営業前サマリー時刻",
    allowShiftSubmission: "シフト提出許可",
    enablePublicHoliday: "公休設定",
    enableHalfHoliday: "半休設定",
    enableReservationCheck: "予約確認",
    regularHolidays: "定休日",
    regularStartTime: "レギュラー出勤時間",
    regularRemindMessage: "レギュラーメッセージ",
    askGuestName: "来客名質問",
    askGuestTime: "来店時間質問",
    attendanceFlowType: "出勤確認フロー",
    isGuideMasterEnabled: "案内ヒアリング利用",
    isDohanSabakiEnabled: "同伴・捌き利用",
    guideHearingEnabled: "案内ヒアリング送信",
    guideHearingTime: "案内ヒアリング時刻",
    guideHearingReporterId: "案内ヒアリング報告者",
    termAttendance: "出勤ラベル",
    termCast: "キャストラベル",
  };

  const unsavedChangeLabels = useMemo(() => {
    if (!isDirty || !initialSnapshot) return [] as string[];
    let initialObj: SnapshotShape | null = null;
    try {
      initialObj = JSON.parse(initialSnapshot) as SnapshotShape;
    } catch {
      return ["未保存の変更があります"];
    }
    const current = createSnapshotObj();
    const labels: string[] = [];
    (Object.keys(DIRTY_LABELS) as (keyof SnapshotShape)[]).forEach((key) => {
      if (JSON.stringify(initialObj?.[key]) !== JSON.stringify(current[key])) {
        labels.push(DIRTY_LABELS[key]);
      }
    });
    return labels;
  }, [isDirty, initialSnapshot, createSnapshotObj]);

  const fetchConfig = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/settings?storeId=${encodeURIComponent(activeStoreId)}`);
      if (!res.ok) throw new Error("設定の取得に失敗しました");
      const data = (await res.json()) as Record<string, unknown>;

      setBusinessType(
        data.business_type === "welfare_b"
          ? "welfare_b"
          : data.business_type === "bar"
            ? "bar"
            : "cabaret"
      );
      setRemindTime(
        typeof data.remind_time === "string" && REMIND_TIME_OPTIONS.includes(data.remind_time)
          ? data.remind_time
          : "07:00"
      );
      setAllowShiftSubmission(data.allow_shift_submission === true);
      setEnablePublicHoliday(data.enable_public_holiday === true);
      setEnableHalfHoliday(data.enable_half_holiday === true);
      setEnableReservationCheck(data.enable_reservation_check === true);
      setRegularHolidays(
        Array.isArray(data.regular_holidays)
          ? [...new Set(data.regular_holidays.filter((v) => Number.isInteger(v) && v >= 0 && v <= 6))]
          : []
      );
      setRegularStartTime(typeof data.regular_start_time === "string" ? data.regular_start_time : "");
      setRegularRemindMessage(
        typeof data.regular_remind_message === "string" && data.regular_remind_message.trim()
          ? data.regular_remind_message
          : DEFAULT_REGULAR_REMIND_BODY
      );
      setAskGuestName(data.ask_guest_name !== false);
      setAskGuestTime(data.ask_guest_time === true);
      setAttendanceFlowType(data.attendance_flow_type === "bar_extended" ? "bar_extended" : "default");
      setIsGuideMasterEnabled(data.is_guide_enabled !== false);
      setIsDohanSabakiEnabled(data.is_dohan_sabaki_enabled !== false);
      const terms = resolveCustomTerms(data.custom_terms);
      setTermAttendance(terms.term_attendance);
      setTermCast(terms.term_cast);
      setPreOpenReportHourJst(
        typeof data.pre_open_report_hour_jst === "number" ? String(data.pre_open_report_hour_jst) : ""
      );

      if (data.reminder_config && typeof data.reminder_config === "object") {
        const rc = data.reminder_config as Record<string, unknown>;
        setConfig({
          enabled: Boolean(rc.enabled ?? DEFAULT_CONFIG.enabled),
          messageTemplate:
            (typeof rc.messageTemplate === "string" ? rc.messageTemplate : null) ?? DEFAULT_CONFIG.messageTemplate,
          reply_present:
            (typeof rc.reply_present === "string" ? rc.reply_present : null) ?? DEFAULT_CONFIG.reply_present,
          reply_late: (typeof rc.reply_late === "string" ? rc.reply_late : null) ?? DEFAULT_CONFIG.reply_late,
          reply_absent:
            (typeof rc.reply_absent === "string" ? rc.reply_absent : null) ?? DEFAULT_CONFIG.reply_absent,
          admin_notify_late:
            (typeof rc.admin_notify_late === "string" ? rc.admin_notify_late : null) ??
            DEFAULT_CONFIG.admin_notify_late,
          admin_notify_absent:
            (typeof rc.admin_notify_absent === "string" ? rc.admin_notify_absent : null) ??
            DEFAULT_CONFIG.admin_notify_absent,
          admin_notify_new_cast:
            (typeof rc.admin_notify_new_cast === "string" ? rc.admin_notify_new_cast : null) ??
            DEFAULT_CONFIG.admin_notify_new_cast,
          welcome_message:
            (typeof rc.welcome_message === "string" ? rc.welcome_message : null) ??
            DEFAULT_CONFIG.welcome_message,
        });
      }

      const guideRes = await fetch(`/api/admin/guide-hearing?storeId=${encodeURIComponent(activeStoreId)}`);
      if (guideRes.ok) {
        const g = (await guideRes.json()) as {
          enabled?: boolean;
          sendTime?: string;
          reporterCastId?: string | null;
          reporterCandidates?: GuideReporterCandidate[];
        };
        setGuideHearingEnabled(g.enabled === true);
        setGuideHearingTime(canonicalGuideHearingTime(g.sendTime ?? null) ?? "02:00");
        setGuideHearingReporterId(g.reporterCastId ?? "");
        setGuideReporterCandidates(Array.isArray(g.reporterCandidates) ? g.reporterCandidates : []);
      }
    } finally {
      setLoading(false);
    }
  }, [activeStoreId]);

  useEffect(() => {
    void fetchConfig();
  }, [fetchConfig]);

  // 取得完了時だけベースラインを保存する。`createSnapshot` を deps に入れると
  // 入力のたびに effect が走り initial が上書きされ、isDirty が常に false になる。
  useEffect(() => {
    if (!loading) {
      setInitialSnapshot(createSnapshot());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- ロード完了の1回だけ（createSnapshot はそのレンダーのスナップショット）
  }, [loading]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    setMessage(null);
    try {
      const reminder_config: Record<string, unknown> = {
        enabled: config.enabled,
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
          business_type: businessType,
          remind_time: remindTime,
          reminder_config,
          allow_shift_submission: allowShiftSubmission,
          enable_public_holiday: enablePublicHoliday,
          enable_half_holiday: enableHalfHoliday,
          pre_open_report_hour_jst: preOpenReportHourJst === "" ? null : Number(preOpenReportHourJst),
          enable_reservation_check: enableReservationCheck,
          regular_holidays: regularHolidays,
          regular_remind_message: regularRemindMessage.trim() || DEFAULT_REGULAR_REMIND_BODY,
          regular_start_time: regularStartTime.trim() || null,
          ask_guest_name: askGuestName,
          ask_guest_time: askGuestTime,
          attendance_flow_type: attendanceFlowType,
          is_guide_enabled: isGuideMasterEnabled,
          is_dohan_sabaki_enabled: isDohanSabakiEnabled,
          custom_terms: serializeCustomTerms({
            term_attendance: termAttendance,
            term_cast: termCast,
          }),
        }),
      });
      if (!res.ok) throw new Error("設定保存に失敗しました");

      const guideRes = await fetch("/api/admin/guide-hearing", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          storeId: activeStoreId,
          enabled: guideHearingEnabled,
          sendTime: canonicalGuideHearingTime(guideHearingTime) ?? "02:00",
          reporterCastId: guideHearingReporterId || null,
          guideStaffNames: [],
        }),
      });
      if (!guideRes.ok) throw new Error("案内数ヒアリング保存に失敗しました");

      setInitialSnapshot(createSnapshot());
      setMessage("保存しました");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "保存に失敗しました");
    } finally {
      setSaving(false);
    }
  }, [
    activeStoreId,
    businessType,
    remindTime,
    config,
    allowShiftSubmission,
    enablePublicHoliday,
    enableHalfHoliday,
    preOpenReportHourJst,
    enableReservationCheck,
    regularHolidays,
    regularRemindMessage,
    regularStartTime,
    askGuestName,
    askGuestTime,
    attendanceFlowType,
    isGuideMasterEnabled,
    isDohanSabakiEnabled,
    termAttendance,
    termCast,
    guideHearingEnabled,
    guideHearingTime,
    guideHearingReporterId,
    createSnapshot,
  ]);

  const handleIndividualTest = useCallback(async () => {
    if (!individualTestCastId) return;
    setTestingIndividual(true);
    try {
      const res = await fetch("/api/admin/guide-hearing/individual-test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storeId: activeStoreId, castId: individualTestCastId }),
      });
      const data = (await res.json()) as { error?: string; castName?: string };
      if (!res.ok) throw new Error(data.error ?? "送信失敗");
      setIndividualTestDetail(`${data.castName ?? "対象"} に送信しました`);
    } catch (e) {
      setIndividualTestDetail(e instanceof Error ? e.message : "送信失敗");
    } finally {
      setTestingIndividual(false);
    }
  }, [activeStoreId, individualTestCastId]);

  const handleBarSummaryTest = useCallback(async () => {
    if (!barSummaryTestCastId) return;
    setTestingBarSummary(true);
    try {
      const res = await fetch("/api/admin/daily-bar-summary/individual-test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storeId: activeStoreId, castId: barSummaryTestCastId }),
      });
      const data = (await res.json()) as { error?: string; castName?: string; chunkCount?: number };
      if (!res.ok) throw new Error(data.error ?? "送信失敗");
      setBarSummaryTestDetail(`${data.castName ?? "対象"} に ${data.chunkCount ?? 1} 通送信しました`);
    } catch (e) {
      setBarSummaryTestDetail(e instanceof Error ? e.message : "送信失敗");
    } finally {
      setTestingBarSummary(false);
    }
  }, [activeStoreId, barSummaryTestCastId]);

  const handleBroadcastRemind = useCallback(async () => {
    setBroadcastingRemind(true);
    setBroadcastRemindDetail(null);
    setBroadcastFailedCastNames([]);
    try {
      const res = await fetch("/api/admin/remind/broadcast", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storeId: activeStoreId }),
      });
      const data = (await res.json()) as {
        error?: string;
        skipped?: string | null;
        successCount?: number;
        failureCount?: number;
        totalCandidates?: number;
        failedCastNames?: string[];
      };
      if (!res.ok) throw new Error(data.error ?? "一斉送信に失敗しました");
      if (data.skipped) {
        setBroadcastRemindDetail(`送信スキップ: ${data.skipped}`);
        return;
      }
      setBroadcastRemindDetail(
        `送信完了: 成功 ${data.successCount ?? 0} / 失敗 ${data.failureCount ?? 0} / 対象 ${
          data.totalCandidates ?? 0
        }`
      );
      setBroadcastFailedCastNames(Array.isArray(data.failedCastNames) ? data.failedCastNames : []);
    } catch (e) {
      setBroadcastRemindDetail(e instanceof Error ? e.message : "一斉送信に失敗しました");
      setBroadcastFailedCastNames([]);
    } finally {
      setBroadcastingRemind(false);
    }
  }, [activeStoreId]);

  if (loading) {
    return <div className="app-card p-6 text-sm text-slate-500">設定を読み込み中...</div>;
  }

  const showSave = section !== "admins";

  return (
    <div className="space-y-4 text-slate-900">
      <header className="sticky top-2 z-20 app-card flex items-center justify-between gap-3 p-3 backdrop-blur">
        <div>
          <h1 className="text-base font-bold text-slate-900">
            {section === "store"
              ? "店舗基本設定"
              : section === "line"
                ? "LINE連携・通知"
                : section === "features"
                  ? "業態別・機能ON/OFF"
                  : "権限・管理者"}
          </h1>
          {message ? <p className="text-xs text-slate-500">{message}</p> : null}
          {showSave && isDirty ? (
            <p
              className="mt-1 text-xs text-amber-700"
              title={unsavedChangeLabels.length > 0 ? unsavedChangeLabels.join(" / ") : "未保存の変更があります"}
            >
              未保存の変更: {unsavedChangeLabels.length}件
              {unsavedChangeLabels.length > 0
                ? `（${unsavedChangeLabels.slice(0, 3).join("、")}${unsavedChangeLabels.length > 3 ? " ほか" : ""}）`
                : ""}
            </p>
          ) : null}
        </div>
        {showSave ? (
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={saving || !isDirty}
            className={`min-h-[42px] rounded-lg px-4 text-sm font-semibold transition ${
              isDirty
                ? "bg-blue-600 text-white hover:bg-blue-700"
                : "bg-slate-200 text-slate-500 cursor-not-allowed"
            }`}
          >
            {saving ? "保存中..." : "設定を保存"}
          </button>
        ) : null}
      </header>

      {section === "store" && (
        <div className="space-y-4">
          <section className="app-card p-4 text-slate-900">
            <h2 className="text-sm font-semibold text-slate-900 inline-flex items-center gap-1.5">
              店舗種別 <Tip text="業態によりナビゲーションやレポート表示が切り替わります。" />
            </h2>
            <div className="mt-3 flex flex-wrap gap-4">
              {(["cabaret", "bar", "welfare_b"] as BusinessType[]).map((bt) => (
                <label key={bt} className="inline-flex items-center gap-2 text-sm text-slate-700">
                  <input
                    type="radio"
                    checked={businessType === bt}
                    onChange={() => setBusinessType(bt)}
                    className="h-4 w-4 accent-blue-600 disabled:accent-slate-400"
                  />
                  {bt === "cabaret" ? "キャバクラ" : bt === "bar" ? "BAR" : "福祉"}
                </label>
              ))}
            </div>
          </section>
          <section className="app-card p-4 text-slate-900">
            <h2 className="text-sm font-semibold text-slate-900 inline-flex items-center gap-1.5">
              表示ラベル設定
              <Tip text="レポート・ナビの『出勤』『キャスト』表記を店舗ごとに調整できます。" />
            </h2>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <label className="block text-sm text-slate-700">
                出勤ラベル
                <input
                  value={termAttendance}
                  onChange={(e) => setTermAttendance(e.target.value)}
                  placeholder="出勤"
                  className={`mt-1 w-full ${CONTROL_CLASS}`}
                />
              </label>
              <label className="block text-sm text-slate-700">
                キャストラベル
                <input
                  value={termCast}
                  onChange={(e) => setTermCast(e.target.value)}
                  placeholder="キャスト"
                  className={`mt-1 w-full ${CONTROL_CLASS}`}
                />
              </label>
            </div>
          </section>
          <section className="app-card p-4 text-slate-900">
            <h2 className="text-sm font-semibold text-slate-900">営業時間・定休日</h2>
            <p className="mt-1 text-xs text-slate-500">
              住所・営業時間の詳細編集は店舗管理で行います。
            </p>
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-7">
              {WEEKDAY_HOLIDAY_LABELS.map((label, idx) => (
                <label key={idx} className="inline-flex items-center gap-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={regularHolidays.includes(idx)}
                    onChange={(e) =>
                      setRegularHolidays((prev) =>
                        e.target.checked
                          ? [...new Set([...prev, idx])].sort((a, b) => a - b)
                          : prev.filter((v) => v !== idx)
                      )
                    }
                    className="h-4 w-4 accent-blue-600 disabled:accent-slate-400"
                  />
                  {label}
                </label>
              ))}
            </div>
            <div className="mt-4">
              <label className="block text-sm font-medium text-slate-700">レギュラー出勤時間</label>
              <select
                value={regularStartTime}
                onChange={(e) => setRegularStartTime(e.target.value)}
                className={`mt-1 w-full max-w-xs text-sm ${CONTROL_CLASS}`}
              >
                {TIME_OPTIONS.map((opt) => (
                  <option key={opt.value || "unset"} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          </section>
        </div>
      )}

      {section === "features" && (
        <div className="space-y-4">
          <section className="app-card p-4 space-y-3 text-slate-900">
            <h2 className="text-sm font-semibold text-slate-900">業態別機能フラグ</h2>
            <label className="flex items-start gap-3 text-sm text-slate-700">
              <input type="checkbox" checked={isDohanSabakiEnabled} onChange={(e) => setIsDohanSabakiEnabled(e.target.checked)} className="mt-0.5 h-4 w-4 accent-blue-600 disabled:accent-slate-400" />
              同伴・捌きを利用する
            </label>
            <label className="flex items-start gap-3 text-sm text-slate-700">
              <input type="checkbox" checked={isGuideMasterEnabled} onChange={(e) => setIsGuideMasterEnabled(e.target.checked)} className="mt-0.5 h-4 w-4 accent-blue-600 disabled:accent-slate-400" />
              案内ヒアリングを利用する
            </label>
            <label className="flex items-start gap-3 text-sm text-slate-700">
              <input type="checkbox" checked={enableReservationCheck} onChange={(e) => setEnableReservationCheck(e.target.checked)} className="mt-0.5 h-4 w-4 accent-blue-600 disabled:accent-slate-400" />
              出勤回答時に予約確認
            </label>
            <label className="block text-sm text-slate-700">
              出勤確認フロー
              <select
                value={attendanceFlowType}
                onChange={(e) => setAttendanceFlowType(e.target.value === "bar_extended" ? "bar_extended" : "default")}
                className={`mt-1 block w-full max-w-sm ${CONTROL_CLASS}`}
              >
                <option value="default">標準</option>
                <option value="bar_extended">BAR詳細</option>
              </select>
            </label>
            {businessType === "bar" && (
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                <p className="text-sm font-medium text-slate-800">BAR来客質問</p>
                <label className="mt-2 flex items-start gap-2 text-sm text-slate-700">
                  <input type="checkbox" checked={askGuestName} onChange={(e) => setAskGuestName(e.target.checked)} className="mt-0.5 h-4 w-4 accent-blue-600 disabled:accent-slate-400" />
                  来客名を質問する
                </label>
                <label className="mt-1 flex items-start gap-2 text-sm text-slate-700">
                  <input type="checkbox" checked={askGuestTime} onChange={(e) => setAskGuestTime(e.target.checked)} className="mt-0.5 h-4 w-4 accent-blue-600 disabled:accent-slate-400" />
                  来店時間を質問する
                </label>
              </div>
            )}
          </section>
        </div>
      )}

      {section === "line" && (
        <div className="space-y-4">
          <section className="app-card p-4 space-y-3 text-slate-900">
            <h2 className="text-sm font-semibold text-slate-900">通知設定</h2>
            <label className="flex items-start gap-2 text-sm text-slate-700">
              <input type="checkbox" checked={config.enabled} onChange={(e) => setConfig((c) => ({ ...c, enabled: e.target.checked }))} className="mt-0.5 h-4 w-4 accent-blue-600 disabled:accent-slate-400" />
              リマインドを有効化
            </label>
            <label className="block text-sm text-slate-700">
              リマインド時刻
              <select value={remindTime} onChange={(e) => setRemindTime(e.target.value)} className={`mt-1 block w-full max-w-xs ${CONTROL_CLASS}`}>
                {REMIND_TIME_OPTIONS.map((v) => (
                  <option key={v} value={v}>{v}</option>
                ))}
              </select>
            </label>
            <label className="block text-sm text-slate-700">
              営業前サマリー時刻
              <select value={preOpenReportHourJst} onChange={(e) => setPreOpenReportHourJst(e.target.value)} className={`mt-1 block w-full max-w-xs ${CONTROL_CLASS}`}>
                <option value="">送信しない</option>
                {PRE_OPEN_HOUR_OPTIONS.map((v) => (
                  <option key={v} value={String(v)}>{v}時</option>
                ))}
              </select>
            </label>
            <label className="block text-sm text-slate-700">
              レギュラーメッセージ
              <textarea value={regularRemindMessage} onChange={(e) => setRegularRemindMessage(e.target.value)} rows={3} className={`mt-1 w-full ${CONTROL_CLASS}`} />
            </label>
          </section>

          <section className="app-card border-amber-200 bg-amber-50/40 p-4 space-y-3 text-slate-900">
            <h2 className="text-sm font-semibold text-slate-900">運用テスト・デバッグ</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <p className="text-xs font-medium text-slate-600">出勤確認 個別テスト</p>
                <div className="mt-1 flex gap-2">
                  <select value={individualTestCastId} onChange={(e) => setIndividualTestCastId(e.target.value)} className={`min-w-0 flex-1 text-sm ${CONTROL_CLASS}`}>
                    <option value="">送信先選択</option>
                    {guideReporterCandidates.map((c) => (
                      <option key={c.id} value={c.id} disabled={!c.line_user_id}>
                        {c.name}{c.line_user_id ? "" : "（LINE未連携）"}
                      </option>
                    ))}
                  </select>
                  <button type="button" onClick={() => void handleIndividualTest()} disabled={testingIndividual || !individualTestCastId} className="btn-secondary whitespace-nowrap">
                    送信
                  </button>
                </div>
                {individualTestDetail ? <p className="mt-1 text-xs text-slate-600">{individualTestDetail}</p> : null}
              </div>
              <div>
                <p className="text-xs font-medium text-slate-600">サマリー 個別テスト</p>
                <div className="mt-1 flex gap-2">
                  <select value={barSummaryTestCastId} onChange={(e) => setBarSummaryTestCastId(e.target.value)} className={`min-w-0 flex-1 text-sm ${CONTROL_CLASS}`}>
                    <option value="">送信先選択</option>
                    {guideReporterCandidates.map((c) => (
                      <option key={`sum-${c.id}`} value={c.id} disabled={!c.line_user_id}>
                        {c.name}{c.line_user_id ? "" : "（LINE未連携）"}
                      </option>
                    ))}
                  </select>
                  <button type="button" onClick={() => void handleBarSummaryTest()} disabled={testingBarSummary || !barSummaryTestCastId} className="btn-secondary whitespace-nowrap">
                    送信
                  </button>
                </div>
                {barSummaryTestDetail ? <p className="mt-1 text-xs text-slate-600">{barSummaryTestDetail}</p> : null}
              </div>
            </div>
            <div className="rounded-lg border border-amber-200 bg-white/70 p-3">
              <p className="text-xs font-medium text-slate-700">本日の出勤確認を一斉送信</p>
              <p className="mt-1 text-xs text-slate-600">
                今日の対象者に対して、本番同等の出勤確認を即時送信します（時刻条件は無視）。
              </p>
              <div className="mt-2">
                <button
                  type="button"
                  onClick={() => void handleBroadcastRemind()}
                  disabled={broadcastingRemind}
                  className="btn-secondary"
                >
                  {broadcastingRemind ? "送信中..." : "本日の一斉送信を実行"}
                </button>
              </div>
              {broadcastRemindDetail ? (
                <p className="mt-2 text-xs text-slate-700">{broadcastRemindDetail}</p>
              ) : null}
              {broadcastFailedCastNames.length > 0 ? (
                <p className="mt-1 text-sm text-red-500">
                  ⚠️ 送信失敗: {broadcastFailedCastNames.join(", ")}
                </p>
              ) : null}
            </div>
          </section>
        </div>
      )}

      {section === "admins" && (
        <section className="app-card p-5 text-slate-900">
          <h2 className="text-sm font-semibold text-slate-900">権限・管理者</h2>
          <p className="mt-2 text-sm text-slate-600">
            管理者の追加・店舗割当・LINE管理者IDは専用画面で管理します。
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link href="/admin/stores" className="btn-secondary">店舗管理</Link>
            <Link href="/admin/casts" className="btn-secondary">キャスト/利用者管理</Link>
          </div>
        </section>
      )}
    </div>
  );
}
