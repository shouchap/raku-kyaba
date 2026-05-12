"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Info } from "lucide-react";
import { useActiveStoreId } from "@/contexts/ActiveStoreContext";
import { DEFAULT_REGULAR_REMIND_BODY } from "@/lib/remind-employment";
import {
  getTimeOptions,
  isAllowedShiftTime,
  parseShiftTimeStepMinutes,
  type ShiftTimeStepMinutes,
} from "@/lib/time-options";
import { canonicalGuideHearingTime } from "@/lib/guide-hearing";
import { DEFAULT_CUSTOM_TERMS, resolveCustomTerms, serializeCustomTerms } from "@/lib/custom-terms";
import {
  buildEditablePreOpenReportTemplate,
  PRE_OPEN_REPORT_TEMPLATE_PLACEHOLDER,
} from "@/lib/pre-open-report-customization";
import { buildEditableWeeklyReportTemplate } from "@/lib/weekly-report-customization";
import { buildEditableDailyBarSummaryTemplate } from "@/lib/daily-bar-summary-customization";

type Section = "store" | "line" | "features" | "admins";
type BusinessType = "cabaret" | "welfare_b" | "bar" | "fuzoku";

type ReminderConfig = {
  enabled: boolean;
  messageTemplate: string;
  reply_present: string;
  reply_late: string;
  reply_absent: string;
  reply_public_holiday: string;
  reply_half_holiday: string;
  admin_notify_late: string;
  admin_notify_absent: string;
  admin_notify_present: string;
  admin_notify_public_holiday: string;
  admin_notify_half_holiday: string;
  admin_notify_new_cast: string;
  welcome_message: string;
};

type GuideReporterCandidate = {
  id: string;
  name: string;
  line_user_id: string | null;
};

type MenuSettingEntry = {
  label: string;
  isHidden: boolean;
  order?: number;
};
type MenuSettingsMap = Record<string, MenuSettingEntry>;
type MenuPreset = { id: string; label: string };

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
  guideStaffNamesText: string;
  weeklyReportEnabled: boolean;
  weeklyReportDay: number;
  weeklyReportTime: string;
  menuSettings: MenuSettingsMap;
  termAttendance: string;
  termCast: string;
  shiftTimeStepMinutes: ShiftTimeStepMinutes;
  lineCustomizationText: string;
  preOpenReportTemplateText: string;
  weeklyReportTemplateText: string;
  dailyBarSummaryTemplateText: string;
  remindAdminSummaryTemplateText: string;
  warnUnansweredHeaderText: string;
  warnUnansweredLineTemplateText: string;
  warnUnansweredAndMoreTemplateText: string;
};

const REMIND_TIME_OPTIONS = Array.from({ length: 24 }, (_, h) => `${String(h).padStart(2, "0")}:00`);
const PRE_OPEN_HOUR_OPTIONS = Array.from({ length: 24 }, (_, h) => h);
const WEEKDAY_HOLIDAY_LABELS = ["日", "月", "火", "水", "木", "金", "土"] as const;
const MENU_PRESET_BY_BUSINESS: Record<BusinessType, MenuPreset[]> = {
  cabaret: [
    { id: "shift-input", label: "シフト入力" },
    { id: "shift-list", label: "シフト一覧" },
    { id: "shift-single", label: "単日登録" },
    { id: "special-shift", label: "特別シフト募集" },
    { id: "cast-manage", label: "キャスト管理" },
    { id: "report", label: "月間レポート" },
    { id: "settings", label: "システム設定" },
  ],
  bar: [
    { id: "shift-input", label: "出勤入力" },
    { id: "shift-list", label: "出勤一覧" },
    { id: "shift-single", label: "単日登録" },
    { id: "cast-manage", label: "キャスト管理" },
    { id: "report", label: "BARレポート" },
    { id: "settings", label: "BAR設定" },
  ],
  welfare_b: [
    { id: "cast-manage", label: "利用者管理" },
    { id: "report", label: "日報・実績" },
    { id: "settings", label: "事業所設定" },
  ],
  fuzoku: [
    { id: "shift-input", label: "シフト入力" },
    { id: "shift-list", label: "シフト一覧" },
    { id: "shift-single", label: "単日登録" },
    { id: "special-shift", label: "特別シフト募集" },
    { id: "cast-manage", label: "キャスト管理" },
    { id: "report", label: "月間レポート" },
    { id: "settings", label: "システム設定" },
  ],
};

function normalizeMenuSettings(raw: unknown): MenuSettingsMap {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const rec = raw as Record<string, unknown>;
  const out: MenuSettingsMap = {};
  for (const [key, value] of Object.entries(rec)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const entry = value as Record<string, unknown>;
    if (typeof entry.label !== "string" || typeof entry.isHidden !== "boolean") continue;
    const id = key.trim();
    const label = entry.label.trim();
    if (!id || !label) continue;
    const orderRaw = entry.order;
    const order = typeof orderRaw === "number" && Number.isFinite(orderRaw) ? Math.trunc(orderRaw) : undefined;
    out[id] = order === undefined ? { label, isHidden: entry.isHidden } : { label, isHidden: entry.isHidden, order };
  }
  return out;
}

const DEFAULT_CONFIG: ReminderConfig = {
  enabled: true,
  messageTemplate: "{name}さん、本日は {time} 出勤予定です。出勤確認をお願いいたします。",
  reply_present: "出勤を記録しました。本日もよろしくお願い致します。",
  reply_late:
    "遅刻の連絡を受け付けました。差し支えなければ、このチャットで『理由』と『到着予定時刻』を教えていただけますか？",
  reply_absent:
    "欠勤の連絡を受け付けました。この後、管理者から直接ご連絡させていただきます。",
  reply_public_holiday: "公休の連絡を受け付けました。理由を入力してください。",
  reply_half_holiday: "半休の連絡を受け付けました。理由を入力してください。",
  admin_notify_late:
    "【遅刻連絡】\n{name} さんから遅刻の連絡がありました。理由と到着予定時刻を確認してください。",
  admin_notify_absent:
    "【欠勤連絡】\n{name} さんから欠勤の連絡がありました。至急、連絡・シフト調整をお願いします。",
  admin_notify_present: "【出勤連絡】{name}さんから本日の出勤（予定通り）の連絡がありました。",
  admin_notify_public_holiday:
    "【公休連絡】\n{name} さんから公休の連絡がありました。理由を確認してください。",
  admin_notify_half_holiday:
    "【半休連絡】\n{name} さんから半休の連絡がありました。理由を確認してください。",
  admin_notify_new_cast: "新しく {name} さんが登録されました！",
  welcome_message:
    "{name}さん、はじめまして。出勤・退勤の連絡はこのLINEから行えます。よろしくお願いいたします。",
};

const CONTROL_CLASS =
  "rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 placeholder:text-slate-400 disabled:bg-slate-100 disabled:text-slate-500 disabled:border-slate-300";

/** LINE案内数の入力対象名（改行・カンマ区切り、最大13名） */
function parseGuideStaffNamesFromText(raw: string): string[] {
  const parts = raw
    .split(/[\n,、]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  return [...new Set(parts)].slice(0, 13);
}

function Tip({ text }: { text: string }) {
  return (
    <span title={text} aria-label={text} className="inline-flex items-center text-slate-400">
      <Info className="h-4 w-4" />
    </span>
  );
}

export default function SettingsSectionPage({ section }: { section: Section }) {
  const activeStoreId = useActiveStoreId();
  const router = useRouter();
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
  const [guideStaffNamesText, setGuideStaffNamesText] = useState("");
  const [guideReporterCandidates, setGuideReporterCandidates] = useState<GuideReporterCandidate[]>([]);

  const [guideHearingTestMode, setGuideHearingTestMode] = useState<"reporter" | "cast" | "group">("reporter");
  const [guideHearingTestCastId, setGuideHearingTestCastId] = useState("");
  const [testingGuideHearing, setTestingGuideHearing] = useState(false);
  const [guideHearingTestDetail, setGuideHearingTestDetail] = useState<string | null>(null);

  const [weeklyReportEnabled, setWeeklyReportEnabled] = useState(false);
  const [weeklyReportDay, setWeeklyReportDay] = useState(1);
  const [weeklyReportTime, setWeeklyReportTime] = useState("09:00");
  const [menuSettings, setMenuSettings] = useState<MenuSettingsMap>({});
  const [reminderConfigExtras, setReminderConfigExtras] = useState<Record<string, unknown>>({});
  const [lineCustomizationText, setLineCustomizationText] = useState("{}");
  const [preOpenReportTemplateText, setPreOpenReportTemplateText] = useState(
    PRE_OPEN_REPORT_TEMPLATE_PLACEHOLDER
  );
  const [weeklyReportTemplateText, setWeeklyReportTemplateText] = useState("{weekly_report_body}");
  const [dailyBarSummaryTemplateText, setDailyBarSummaryTemplateText] = useState("{daily_bar_summary_body}");
  const [remindAdminSummaryTemplateText, setRemindAdminSummaryTemplateText] = useState(
    "【システム通知】本日、以下の{count}名に出勤確認のリマインドを送信しました。\n{list}"
  );
  const [warnUnansweredHeaderText, setWarnUnansweredHeaderText] = useState("【未返信アラート】");
  const [warnUnansweredLineTemplateText, setWarnUnansweredLineTemplateText] = useState("・{name} ({time})");
  const [warnUnansweredAndMoreTemplateText, setWarnUnansweredAndMoreTemplateText] = useState("・他{count}名");
  const [shiftTimeStepMinutes, setShiftTimeStepMinutes] = useState<ShiftTimeStepMinutes>(15);

  const [individualTestCastId, setIndividualTestCastId] = useState("");
  const [barSummaryTestCastId, setBarSummaryTestCastId] = useState("");
  const [testingIndividual, setTestingIndividual] = useState(false);
  const [testingBarSummary, setTestingBarSummary] = useState(false);
  const [broadcastingRemind, setBroadcastingRemind] = useState(false);
  const [individualTestDetail, setIndividualTestDetail] = useState<string | null>(null);
  const [barSummaryTestDetail, setBarSummaryTestDetail] = useState<string | null>(null);
  const [broadcastRemindDetail, setBroadcastRemindDetail] = useState<string | null>(null);
  const [broadcastFailedCastNames, setBroadcastFailedCastNames] = useState<string[]>([]);
  const [testingWeeklyReport, setTestingWeeklyReport] = useState(false);
  const [weeklyReportTestDetail, setWeeklyReportTestDetail] = useState<string | null>(null);
  const [weeklyReportTestCastId, setWeeklyReportTestCastId] = useState("");
  const [warnUnansweredTestCastId, setWarnUnansweredTestCastId] = useState("");
  const [testingWarnUnanswered, setTestingWarnUnanswered] = useState(false);
  const [warnUnansweredTestDetail, setWarnUnansweredTestDetail] = useState<string | null>(null);
  const [welfareTestCastId, setWelfareTestCastId] = useState("");
  const [welfareTestSegment, setWelfareTestSegment] = useState<"morning" | "midday" | "evening">(
    "morning"
  );
  const [testingWelfare, setTestingWelfare] = useState(false);
  const [welfareTestDetail, setWelfareTestDetail] = useState<string | null>(null);
  const [preOpenPreviewLoading, setPreOpenPreviewLoading] = useState(false);
  const [preOpenPreviewBaseText, setPreOpenPreviewBaseText] = useState("");
  const [preOpenPreviewEditorText, setPreOpenPreviewEditorText] = useState("");
  const [preOpenPreviewDate, setPreOpenPreviewDate] = useState("");
  const [preOpenPreviewError, setPreOpenPreviewError] = useState<string | null>(null);

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
      guideStaffNamesText,
      weeklyReportEnabled,
      weeklyReportDay,
      weeklyReportTime,
      menuSettings,
      termAttendance,
      termCast,
      shiftTimeStepMinutes,
      lineCustomizationText,
      preOpenReportTemplateText,
      weeklyReportTemplateText,
      dailyBarSummaryTemplateText,
      remindAdminSummaryTemplateText,
      warnUnansweredHeaderText,
      warnUnansweredLineTemplateText,
      warnUnansweredAndMoreTemplateText,
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
    guideStaffNamesText,
    weeklyReportEnabled,
    weeklyReportDay,
    weeklyReportTime,
    menuSettings,
    termAttendance,
    termCast,
    shiftTimeStepMinutes,
    lineCustomizationText,
    preOpenReportTemplateText,
    weeklyReportTemplateText,
    dailyBarSummaryTemplateText,
    remindAdminSummaryTemplateText,
    warnUnansweredHeaderText,
    warnUnansweredLineTemplateText,
    warnUnansweredAndMoreTemplateText,
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
    guideStaffNamesText: "案内入力対象スタッフ名",
    weeklyReportEnabled: "週間レポート自動送信（ON/OFF）",
    weeklyReportDay: "週間レポート送信曜日",
    weeklyReportTime: "週間レポート送信時刻",
    menuSettings: "メニューカスタマイズ",
    termAttendance: "出勤ラベル",
    termCast: "キャストラベル",
    shiftTimeStepMinutes: "シフト時刻の刻み",
    lineCustomizationText: "LINE詳細カスタム(JSON)",
    preOpenReportTemplateText: "営業前サマリーテンプレート",
    weeklyReportTemplateText: "週間レポートテンプレート",
    dailyBarSummaryTemplateText: "出勤確認サマリーテンプレート",
    remindAdminSummaryTemplateText: "出勤確認送信サマリーテンプレート",
    warnUnansweredHeaderText: "未返信アラート見出し",
    warnUnansweredLineTemplateText: "未返信アラート行テンプレート",
    warnUnansweredAndMoreTemplateText: "未返信アラート残数テンプレート",
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
            : data.business_type === "fuzoku"
              ? "fuzoku"
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

      setWeeklyReportEnabled(data.weekly_report_enabled === true);
      const wd = data.weekly_report_day;
      setWeeklyReportDay(
        typeof wd === "number" && Number.isInteger(wd) && wd >= 0 && wd <= 6 ? wd : 1
      );
      const wtime = typeof data.weekly_report_time === "string" ? data.weekly_report_time.trim() : "";
      setWeeklyReportTime(REMIND_TIME_OPTIONS.includes(wtime) ? wtime : "09:00");
      setMenuSettings(normalizeMenuSettings(data.menu_settings));
      setShiftTimeStepMinutes(parseShiftTimeStepMinutes(data.shift_time_step_minutes));
      setReminderConfigExtras({});
      setLineCustomizationText("{}");
      setPreOpenReportTemplateText(PRE_OPEN_REPORT_TEMPLATE_PLACEHOLDER);
      setWeeklyReportTemplateText("{weekly_report_body}");
      setDailyBarSummaryTemplateText("{daily_bar_summary_body}");
      setRemindAdminSummaryTemplateText(
        "【システム通知】本日、以下の{count}名に出勤確認のリマインドを送信しました。\n{list}"
      );
      setWarnUnansweredHeaderText("【未返信アラート】");
      setWarnUnansweredLineTemplateText("・{name} ({time})");
      setWarnUnansweredAndMoreTemplateText("・他{count}名");

      if (data.reminder_config && typeof data.reminder_config === "object") {
        const rc = data.reminder_config as Record<string, unknown>;
        const {
          enabled: _enabled,
          messageTemplate: _mt,
          template: _tpl,
          reply_present: _rp,
          reply_late: _rl,
          reply_absent: _ra,
          reply_public_holiday: _rph,
          reply_half_holiday: _rhh,
          admin_notify_late: _anl,
          admin_notify_absent: _ana,
          admin_notify_present: _anp,
          admin_notify_public_holiday: _anph,
          admin_notify_half_holiday: _anhh,
          admin_notify_new_cast: _ann,
          welcome_message: _wm,
          ...rest
        } = rc;
        setReminderConfigExtras(rest);
        setPreOpenReportTemplateText(
          buildEditablePreOpenReportTemplate(rc) || PRE_OPEN_REPORT_TEMPLATE_PLACEHOLDER
        );
        setWeeklyReportTemplateText(
          buildEditableWeeklyReportTemplate(rc) || "{weekly_report_body}"
        );
        setDailyBarSummaryTemplateText(
          buildEditableDailyBarSummaryTemplate(rc) || "{daily_bar_summary_body}"
        );
        setRemindAdminSummaryTemplateText(
          typeof rc.remind_admin_summary_template === "string" && rc.remind_admin_summary_template.trim()
            ? rc.remind_admin_summary_template
            : "【システム通知】本日、以下の{count}名に出勤確認のリマインドを送信しました。\n{list}"
        );
        setWarnUnansweredHeaderText(
          typeof rc.warn_unanswered_header === "string" && rc.warn_unanswered_header.trim()
            ? rc.warn_unanswered_header
            : "【未返信アラート】"
        );
        setWarnUnansweredLineTemplateText(
          typeof rc.warn_unanswered_line_template === "string" && rc.warn_unanswered_line_template.trim()
            ? rc.warn_unanswered_line_template
            : "・{name} ({time})"
        );
        setWarnUnansweredAndMoreTemplateText(
          typeof rc.warn_unanswered_and_more_template === "string" &&
            rc.warn_unanswered_and_more_template.trim()
            ? rc.warn_unanswered_and_more_template
            : "・他{count}名"
        );
        const lc = rc.line_customization;
        if (lc && typeof lc === "object" && !Array.isArray(lc)) {
          setLineCustomizationText(JSON.stringify(lc, null, 2));
        } else {
          setLineCustomizationText("{}");
        }
        setConfig({
          enabled: Boolean(rc.enabled ?? DEFAULT_CONFIG.enabled),
          messageTemplate:
            (typeof rc.messageTemplate === "string" ? rc.messageTemplate : null) ?? DEFAULT_CONFIG.messageTemplate,
          reply_present:
            (typeof rc.reply_present === "string" ? rc.reply_present : null) ?? DEFAULT_CONFIG.reply_present,
          reply_late: (typeof rc.reply_late === "string" ? rc.reply_late : null) ?? DEFAULT_CONFIG.reply_late,
          reply_absent:
            (typeof rc.reply_absent === "string" ? rc.reply_absent : null) ?? DEFAULT_CONFIG.reply_absent,
          reply_public_holiday:
            (typeof rc.reply_public_holiday === "string" ? rc.reply_public_holiday : null) ??
            DEFAULT_CONFIG.reply_public_holiday,
          reply_half_holiday:
            (typeof rc.reply_half_holiday === "string" ? rc.reply_half_holiday : null) ??
            DEFAULT_CONFIG.reply_half_holiday,
          admin_notify_late:
            (typeof rc.admin_notify_late === "string" ? rc.admin_notify_late : null) ??
            DEFAULT_CONFIG.admin_notify_late,
          admin_notify_absent:
            (typeof rc.admin_notify_absent === "string" ? rc.admin_notify_absent : null) ??
            DEFAULT_CONFIG.admin_notify_absent,
          admin_notify_present:
            (typeof rc.admin_notify_present === "string" ? rc.admin_notify_present : null) ??
            DEFAULT_CONFIG.admin_notify_present,
          admin_notify_public_holiday:
            (typeof rc.admin_notify_public_holiday === "string"
              ? rc.admin_notify_public_holiday
              : null) ?? DEFAULT_CONFIG.admin_notify_public_holiday,
          admin_notify_half_holiday:
            (typeof rc.admin_notify_half_holiday === "string" ? rc.admin_notify_half_holiday : null) ??
            DEFAULT_CONFIG.admin_notify_half_holiday,
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
          guideStaffNames?: string[];
          reporterCandidates?: GuideReporterCandidate[];
        };
        setGuideHearingEnabled(g.enabled === true);
        setGuideHearingTime(canonicalGuideHearingTime(g.sendTime ?? null) ?? "02:00");
        setGuideHearingReporterId(g.reporterCastId ?? "");
        const names = Array.isArray(g.guideStaffNames)
          ? g.guideStaffNames.map((s) => String(s ?? "").trim()).filter(Boolean)
          : [];
        setGuideStaffNamesText(names.join("\n"));
        setGuideReporterCandidates(Array.isArray(g.reporterCandidates) ? g.reporterCandidates : []);
      }

      try {
        setPreOpenPreviewLoading(true);
        setPreOpenPreviewError(null);
        const today = new Date();
        const yyyy = today.getFullYear();
        const mm = String(today.getMonth() + 1).padStart(2, "0");
        const dd = String(today.getDate()).padStart(2, "0");
        const targetDate = `${yyyy}-${mm}-${dd}`;
        setPreOpenPreviewDate(targetDate);
        const q = new URLSearchParams({ storeId: activeStoreId, targetDate });
        const previewRes = await fetch(`/api/admin/pre-open-report/preview?${q.toString()}`);
        const previewData = (await previewRes.json()) as {
          error?: string;
          message?: string;
          baseMessage?: string;
          targetDate?: string;
        };
        if (!previewRes.ok) throw new Error(previewData.error ?? "プレビュー取得に失敗しました");
        setPreOpenPreviewBaseText(
          typeof previewData.baseMessage === "string" ? previewData.baseMessage : ""
        );
        setPreOpenPreviewEditorText(typeof previewData.message === "string" ? previewData.message : "");
      } catch (e) {
        setPreOpenPreviewError(
          e instanceof Error ? e.message : "営業前サマリープレビューの取得に失敗しました"
        );
        setPreOpenPreviewBaseText("");
        setPreOpenPreviewEditorText("");
      } finally {
        setPreOpenPreviewLoading(false);
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
      let lineCustomizationValue: Record<string, unknown> = {};
      try {
        const parsed = JSON.parse(lineCustomizationText.trim() || "{}");
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          throw new Error("LINE詳細カスタム(JSON)はオブジェクト形式で入力してください。");
        }
        lineCustomizationValue = parsed as Record<string, unknown>;
      } catch (e) {
        throw new Error(
          e instanceof Error
            ? `LINE詳細カスタム(JSON)の形式が不正です: ${e.message}`
            : "LINE詳細カスタム(JSON)の形式が不正です。"
        );
      }

      const reminder_config: Record<string, unknown> = {
        ...reminderConfigExtras,
        enabled: config.enabled,
        messageTemplate: config.messageTemplate.trim() || DEFAULT_CONFIG.messageTemplate,
        reply_present: config.reply_present.trim() || DEFAULT_CONFIG.reply_present,
        reply_late: config.reply_late.trim() || DEFAULT_CONFIG.reply_late,
        reply_absent: config.reply_absent.trim() || DEFAULT_CONFIG.reply_absent,
        reply_public_holiday:
          config.reply_public_holiday.trim() || DEFAULT_CONFIG.reply_public_holiday,
        reply_half_holiday: config.reply_half_holiday.trim() || DEFAULT_CONFIG.reply_half_holiday,
        admin_notify_late: config.admin_notify_late.trim() || DEFAULT_CONFIG.admin_notify_late,
        admin_notify_absent: config.admin_notify_absent.trim() || DEFAULT_CONFIG.admin_notify_absent,
        admin_notify_present:
          config.admin_notify_present.trim() || DEFAULT_CONFIG.admin_notify_present,
        admin_notify_public_holiday:
          config.admin_notify_public_holiday.trim() || DEFAULT_CONFIG.admin_notify_public_holiday,
        admin_notify_half_holiday:
          config.admin_notify_half_holiday.trim() || DEFAULT_CONFIG.admin_notify_half_holiday,
        admin_notify_new_cast: config.admin_notify_new_cast.trim() || DEFAULT_CONFIG.admin_notify_new_cast,
        welcome_message: config.welcome_message.trim() || DEFAULT_CONFIG.welcome_message,
        pre_open_report_template:
          preOpenReportTemplateText.trim() || PRE_OPEN_REPORT_TEMPLATE_PLACEHOLDER,
        weekly_report_template: weeklyReportTemplateText.trim() || "{weekly_report_body}",
        daily_bar_summary_template: dailyBarSummaryTemplateText.trim() || "{daily_bar_summary_body}",
        remind_admin_summary_template:
          remindAdminSummaryTemplateText.trim() ||
          "【システム通知】本日、以下の{count}名に出勤確認のリマインドを送信しました。\n{list}",
        warn_unanswered_header: warnUnansweredHeaderText.trim() || "【未返信アラート】",
        warn_unanswered_line_template:
          warnUnansweredLineTemplateText.trim() || "・{name} ({time})",
        warn_unanswered_and_more_template:
          warnUnansweredAndMoreTemplateText.trim() || "・他{count}名",
        line_customization: lineCustomizationValue,
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
          weekly_report_enabled: weeklyReportEnabled,
          weekly_report_day: weeklyReportDay,
          weekly_report_time: weeklyReportTime,
          menu_settings: menuSettings,
          shift_time_step_minutes: shiftTimeStepMinutes,
        }),
      });
      if (!res.ok) throw new Error("設定保存に失敗しました");

      const guideStaffNames = parseGuideStaffNamesFromText(guideStaffNamesText);
      const guideRes = await fetch("/api/admin/guide-hearing", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          storeId: activeStoreId,
          enabled: guideHearingEnabled,
          sendTime: canonicalGuideHearingTime(guideHearingTime) ?? "02:00",
          reporterCastId: guideHearingReporterId || null,
          guideStaffNames,
        }),
      });
      if (!guideRes.ok) throw new Error("案内数ヒアリング保存に失敗しました");

      setInitialSnapshot(createSnapshot());
      setMessage("保存しました");
      router.refresh();
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
    weeklyReportEnabled,
    weeklyReportDay,
    weeklyReportTime,
    menuSettings,
    shiftTimeStepMinutes,
    guideHearingEnabled,
    guideHearingTime,
    guideHearingReporterId,
    guideStaffNamesText,
    createSnapshot,
    router,
    reminderConfigExtras,
    lineCustomizationText,
    preOpenReportTemplateText,
    weeklyReportTemplateText,
    dailyBarSummaryTemplateText,
    remindAdminSummaryTemplateText,
    warnUnansweredHeaderText,
    warnUnansweredLineTemplateText,
    warnUnansweredAndMoreTemplateText,
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

  const handleWeeklyReportTest = useCallback(async () => {
    setTestingWeeklyReport(true);
    setWeeklyReportTestDetail(null);
    try {
      const res = await fetch("/api/admin/weekly-report/test-send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          storeId: activeStoreId,
          castId: weeklyReportTestCastId || undefined,
        }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        chunkCount?: number;
        sendDateYmd?: string;
        castName?: string;
      };
      if (!res.ok) throw new Error(data.error ?? "送信に失敗しました");
      const target = weeklyReportTestCastId
        ? `${data.castName ?? "対象"}宛`
        : "管理者宛";
      setWeeklyReportTestDetail(`${data.sendDateYmd ?? "本日"}基準で ${data.chunkCount ?? 1} 通送信しました（${target}）`);
    } catch (e) {
      setWeeklyReportTestDetail(e instanceof Error ? e.message : "送信に失敗しました");
    } finally {
      setTestingWeeklyReport(false);
    }
  }, [activeStoreId, weeklyReportTestCastId]);

  const handleGuideHearingTest = useCallback(async () => {
    if (guideHearingTestMode === "cast" && !guideHearingTestCastId) {
      setGuideHearingTestDetail("キャストを選択してください");
      return;
    }
    setTestingGuideHearing(true);
    setGuideHearingTestDetail(null);
    try {
      const body: Record<string, unknown> = { storeId: activeStoreId };
      if (guideHearingTestMode === "cast") {
        body.targetCastId = guideHearingTestCastId;
      } else if (guideHearingTestMode === "group") {
        body.sendToLineGroup = true;
      }
      const res = await fetch("/api/admin/guide-hearing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as {
        error?: string;
        recipient?: { kind?: string; name?: string | null };
      };
      if (!res.ok) throw new Error(data.error ?? "送信失敗");
      const r = data.recipient;
      const dest =
        r?.kind === "group"
          ? "公式LINEグループ"
          : r?.kind === "cast"
            ? `${r.name ?? "キャスト"}`
            : `担当（${r?.name ?? ""}）`;
      setGuideHearingTestDetail(`${dest} に起点メッセージを送信しました`);
    } catch (e) {
      setGuideHearingTestDetail(e instanceof Error ? e.message : "送信失敗");
    } finally {
      setTestingGuideHearing(false);
    }
  }, [activeStoreId, guideHearingTestCastId, guideHearingTestMode]);

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

  const handleWelfareTestSend = useCallback(async () => {
    if (!welfareTestCastId) return;
    setTestingWelfare(true);
    setWelfareTestDetail(null);
    try {
      const res = await fetch("/api/admin/welfare/test-send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          storeId: activeStoreId,
          castId: welfareTestCastId,
          segment: welfareTestSegment,
        }),
      });
      const data = (await res.json()) as { error?: string; castName?: string; segment?: string };
      if (!res.ok) throw new Error(data.error ?? "送信失敗");
      const segLabel =
        data.segment === "morning" ? "朝開始" : data.segment === "midday" ? "昼体調確認" : "夕方終了";
      setWelfareTestDetail(`${data.castName ?? "対象"} に「${segLabel}」を送信しました`);
    } catch (e) {
      setWelfareTestDetail(e instanceof Error ? e.message : "送信失敗");
    } finally {
      setTestingWelfare(false);
    }
  }, [activeStoreId, welfareTestCastId, welfareTestSegment]);

  const handleWarnUnansweredTest = useCallback(async () => {
    if (!warnUnansweredTestCastId) return;
    setTestingWarnUnanswered(true);
    setWarnUnansweredTestDetail(null);
    try {
      const res = await fetch("/api/admin/remind/warn-unanswered/test-send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storeId: activeStoreId, castId: warnUnansweredTestCastId }),
      });
      const data = (await res.json()) as { error?: string; castName?: string };
      if (!res.ok) throw new Error(data.error ?? "送信失敗");
      setWarnUnansweredTestDetail(`${data.castName ?? "対象"} に未返信アラート文面を送信しました`);
    } catch (e) {
      setWarnUnansweredTestDetail(e instanceof Error ? e.message : "送信失敗");
    } finally {
      setTestingWarnUnanswered(false);
    }
  }, [activeStoreId, warnUnansweredTestCastId]);

  const handleRefreshPreOpenPreview = useCallback(async () => {
    setPreOpenPreviewLoading(true);
    setPreOpenPreviewError(null);
    try {
      const dateParam = preOpenPreviewDate.trim();
      const q = new URLSearchParams({ storeId: activeStoreId });
      if (dateParam) q.set("targetDate", dateParam);
      const res = await fetch(`/api/admin/pre-open-report/preview?${q.toString()}`);
      const data = (await res.json()) as {
        error?: string;
        message?: string;
        baseMessage?: string;
        targetDate?: string;
      };
      if (!res.ok) throw new Error(data.error ?? "プレビュー取得に失敗しました");
      setPreOpenPreviewBaseText(typeof data.baseMessage === "string" ? data.baseMessage : "");
      setPreOpenPreviewEditorText(typeof data.message === "string" ? data.message : "");
      if (!dateParam && typeof data.targetDate === "string") {
        setPreOpenPreviewDate(data.targetDate);
      }
    } catch (e) {
      setPreOpenPreviewError(e instanceof Error ? e.message : "プレビュー取得に失敗しました");
      setPreOpenPreviewBaseText("");
      setPreOpenPreviewEditorText("");
    } finally {
      setPreOpenPreviewLoading(false);
    }
  }, [activeStoreId, preOpenPreviewDate]);

  const handleEditPreOpenPreview = useCallback(
    (nextText: string) => {
      setPreOpenPreviewEditorText(nextText);
      const base = preOpenPreviewBaseText;
      if (!base) {
        setPreOpenReportTemplateText(nextText.trim() || PRE_OPEN_REPORT_TEMPLATE_PLACEHOLDER);
        return;
      }
      if (nextText.includes(base)) {
        setPreOpenReportTemplateText(
          nextText.replaceAll(base, PRE_OPEN_REPORT_TEMPLATE_PLACEHOLDER) ||
            PRE_OPEN_REPORT_TEMPLATE_PLACEHOLDER
        );
        return;
      }
      setPreOpenReportTemplateText(
        `${nextText.trim()}\n${PRE_OPEN_REPORT_TEMPLATE_PLACEHOLDER}`.trim()
      );
    },
    [preOpenPreviewBaseText]
  );

  const attendanceTemplatePreview = useMemo(() => {
    return (config.messageTemplate || DEFAULT_CONFIG.messageTemplate)
      .replace(/\{name\}/g, "キャスト名")
      .replace(/\{time\}/g, "20:00");
  }, [config.messageTemplate]);

  const weeklyTemplatePreview = useMemo(() => {
    const body = "【週間レポート】店舗名\n対象期間: 2026年5月1日〜7日\n全体の出勤日数（合計）: 25";
    const t = weeklyReportTemplateText.trim() || "{weekly_report_body}";
    return t.includes("{weekly_report_body}") ? t.replaceAll("{weekly_report_body}", body) : `${t}\n${body}`;
  }, [weeklyReportTemplateText]);

  const dailyBarTemplatePreview = useMemo(() => {
    const body = "【営業前サマリー（日報）】\n📅 2026年5月12日\n📊 全体組数: 確定 8組 / 仮 2組";
    const t = dailyBarSummaryTemplateText.trim() || "{daily_bar_summary_body}";
    return t.includes("{daily_bar_summary_body}")
      ? t.replaceAll("{daily_bar_summary_body}", body)
      : `${t}\n${body}`;
  }, [dailyBarSummaryTemplateText]);

  const remindAdminSummaryTemplatePreview = useMemo(() => {
    return (
      remindAdminSummaryTemplateText.trim() ||
      "【システム通知】本日、以下の{count}名に出勤確認のリマインドを送信しました。\n{list}"
    )
      .replaceAll("{count}", "2")
      .replaceAll("{list}", "・キャスト1 (20:00)\n・キャスト2 (21:00)");
  }, [remindAdminSummaryTemplateText]);

  const warnUnansweredTemplatePreview = useMemo(() => {
    const header = warnUnansweredHeaderText.trim() || "【未返信アラート】";
    const line = (warnUnansweredLineTemplateText.trim() || "・{name} ({time})")
      .replaceAll("{name}", "キャスト名")
      .replaceAll("{time}", "21:00");
    const more = (warnUnansweredAndMoreTemplateText.trim() || "・他{count}名").replaceAll(
      "{count}",
      "3"
    );
    return `${header}\n${line}\n${more}`;
  }, [
    warnUnansweredHeaderText,
    warnUnansweredLineTemplateText,
    warnUnansweredAndMoreTemplateText,
  ]);

  const menuEditorItems = useMemo(() => {
    const base = MENU_PRESET_BY_BUSINESS[businessType].map((item, idx) => {
      let defaultLabel = item.label;
      if (item.id === "cast-manage") defaultLabel = `${termCast}管理`;
      if (item.id === "report") defaultLabel = `${termCast}${termAttendance}レポート`;
      const setting = menuSettings[item.id];
      const label = setting?.label?.trim() || defaultLabel;
      const isHidden = setting?.isHidden === true;
      const order = typeof setting?.order === "number" && Number.isFinite(setting.order) ? setting.order : idx;
      return { id: item.id, defaultLabel, label, isHidden, order, idx };
    });
    return base
      .sort((a, b) => (a.order === b.order ? a.idx - b.idx : a.order - b.order))
      .map(({ idx: _dropIdx, ...row }) => row);
  }, [businessType, termAttendance, termCast, menuSettings]);

  const applyMenuOrder = useCallback(
    (orderedIds: string[]) => {
      setMenuSettings((prev) => {
        const next: MenuSettingsMap = {};
        orderedIds.forEach((id, index) => {
          const existing = prev[id];
          const base = MENU_PRESET_BY_BUSINESS[businessType].find((x) => x.id === id);
          let fallbackLabel = base?.label ?? id;
          if (id === "cast-manage") fallbackLabel = `${termCast}管理`;
          if (id === "report") fallbackLabel = `${termCast}${termAttendance}レポート`;
          next[id] = {
            label: existing?.label?.trim() || fallbackLabel,
            isHidden: existing?.isHidden === true,
            order: index,
          };
        });
        return next;
      });
    },
    [businessType, termAttendance, termCast]
  );

  const moveMenuItem = useCallback(
    (id: string, delta: -1 | 1) => {
      const ordered = menuEditorItems.map((x) => x.id);
      const currentIndex = ordered.indexOf(id);
      if (currentIndex < 0) return;
      const nextIndex = currentIndex + delta;
      if (nextIndex < 0 || nextIndex >= ordered.length) return;
      const swapped = [...ordered];
      const tmp = swapped[currentIndex];
      swapped[currentIndex] = swapped[nextIndex];
      swapped[nextIndex] = tmp;
      applyMenuOrder(swapped);
    },
    [menuEditorItems, applyMenuOrder]
  );

  const updateMenuLabel = useCallback(
    (id: string, value: string) => {
      setMenuSettings((prev) => {
        const existing = prev[id];
        const fallback = menuEditorItems.find((x) => x.id === id)?.defaultLabel ?? id;
        return {
          ...prev,
          [id]: {
            label: value.trim() || existing?.label || fallback,
            isHidden: existing?.isHidden === true,
            order: typeof existing?.order === "number" ? existing.order : menuEditorItems.findIndex((x) => x.id === id),
          },
        };
      });
    },
    [menuEditorItems]
  );

  const updateMenuHidden = useCallback(
    (id: string, hidden: boolean) => {
      setMenuSettings((prev) => {
        const existing = prev[id];
        const fallback = menuEditorItems.find((x) => x.id === id)?.defaultLabel ?? id;
        return {
          ...prev,
          [id]: {
            label: existing?.label?.trim() || fallback,
            isHidden: hidden,
            order: typeof existing?.order === "number" ? existing.order : menuEditorItems.findIndex((x) => x.id === id),
          },
        };
      });
    },
    [menuEditorItems]
  );

  const handleResetMenuSettings = useCallback(() => {
    if (!window.confirm("メニューの設定を初期状態に戻しますか？")) return;
    setMenuSettings({});
  }, []);

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
              {(["cabaret", "bar", "welfare_b", "fuzoku"] as BusinessType[]).map((bt) => (
                <label key={bt} className="inline-flex items-center gap-2 text-sm text-slate-700">
                  <input
                    type="radio"
                    checked={businessType === bt}
                    onChange={() => setBusinessType(bt)}
                    className="h-4 w-4 accent-blue-600 disabled:accent-slate-400"
                  />
                  {bt === "cabaret" ? "キャバクラ" : bt === "bar" ? "BAR" : bt === "welfare_b" ? "福祉" : "風俗"}
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
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-sm font-semibold text-slate-900 inline-flex items-center gap-1.5">
                ナビゲーションメニュー設定
                <Tip text="表示名・表示/非表示・並び順をカスタマイズできます。" />
              </h2>
              <button
                type="button"
                onClick={handleResetMenuSettings}
                className="text-xs font-semibold text-rose-600 hover:text-rose-700"
              >
                初期設定に戻す
              </button>
            </div>
            <div className="mt-3 space-y-2">
              {menuEditorItems.map((item, index) => (
                <div
                  key={item.id}
                  className="grid grid-cols-[1fr_auto] items-center gap-3 rounded-xl border border-slate-200 bg-slate-50/70 p-3"
                >
                  <div className="space-y-2">
                    <div className="text-xs text-slate-500">ID: {item.id}</div>
                    <input
                      value={item.label}
                      onChange={(e) => updateMenuLabel(item.id, e.target.value)}
                      className={`w-full ${CONTROL_CLASS}`}
                    />
                    <label className="inline-flex items-center gap-2 text-xs text-slate-700">
                      <input
                        type="checkbox"
                        checked={item.isHidden}
                        onChange={(e) => updateMenuHidden(item.id, e.target.checked)}
                        className="h-4 w-4 accent-blue-600 disabled:accent-slate-400"
                      />
                      この項目を非表示にする
                    </label>
                  </div>
                  <div className="flex flex-col gap-2">
                    <button
                      type="button"
                      onClick={() => moveMenuItem(item.id, -1)}
                      disabled={index === 0}
                      className="rounded-md border border-slate-300 bg-white px-2 py-1 text-sm disabled:opacity-40"
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      onClick={() => moveMenuItem(item.id, 1)}
                      disabled={index === menuEditorItems.length - 1}
                      className="rounded-md border border-slate-300 bg-white px-2 py-1 text-sm disabled:opacity-40"
                    >
                      ↓
                    </button>
                  </div>
                </div>
              ))}
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
              <label className="block text-sm font-medium text-slate-700">シフト時刻の選択刻み</label>
              <p className="mt-0.5 text-xs text-slate-500">
                週間シフト入力・単日登録・キャスト向けシフト提出のプルダウンに反映されます（風俗などで 1
                時間単位にしたい場合は「1時間」を選んでください）。
              </p>
              <select
                value={shiftTimeStepMinutes}
                onChange={(e) => {
                  const next = parseShiftTimeStepMinutes(Number(e.target.value));
                  setShiftTimeStepMinutes(next);
                  setRegularStartTime((prev) => {
                    const t = prev.trim();
                    if (!t) return prev;
                    return isAllowedShiftTime(t, next) ? prev : "";
                  });
                }}
                className={`mt-1 w-full max-w-xs text-sm ${CONTROL_CLASS}`}
              >
                <option value={15}>15分単位</option>
                <option value={60}>1時間単位</option>
              </select>
            </div>
            <div className="mt-4">
              <label className="block text-sm font-medium text-slate-700">レギュラー出勤時間</label>
              <select
                value={regularStartTime}
                onChange={(e) => setRegularStartTime(e.target.value)}
                className={`mt-1 w-full max-w-xs text-sm ${CONTROL_CLASS}`}
              >
                {getTimeOptions(shiftTimeStepMinutes).map((opt) => (
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
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <p className="text-xs font-semibold text-slate-700">この業態で送信される主なLINE</p>
              <p className="mt-1 text-xs text-slate-600">
                {businessType === "welfare_b"
                  ? "出勤確認 / 営業前サマリー / 週間レポート / 未返信アラート / 福祉（朝開始・昼体調確認・夕方終了）"
                  : "出勤確認 / 営業前サマリー / 週間レポート / 未返信アラート"}
              </p>
            </div>
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
              出勤確認メッセージ（通常）
              <p className="mt-0.5 text-xs text-slate-500">
                変数: {"{name}"} = キャスト名, {"{time}"} = 出勤予定時刻
              </p>
              <textarea
                value={config.messageTemplate}
                onChange={(e) => setConfig((c) => ({ ...c, messageTemplate: e.target.value }))}
                rows={3}
                className={`mt-1 w-full ${CONTROL_CLASS}`}
              />
              <p className="mt-1 text-xs text-slate-600">プレビュー: {attendanceTemplatePreview}</p>
            </label>
            <label className="block text-sm text-slate-700">
              レギュラーメッセージ
              <textarea value={regularRemindMessage} onChange={(e) => setRegularRemindMessage(e.target.value)} rows={3} className={`mt-1 w-full ${CONTROL_CLASS}`} />
            </label>
            <details className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <summary className="cursor-pointer text-sm font-medium text-slate-800">
                出勤回答・管理者通知 文面の詳細設定
              </summary>
              <div className="mt-3 space-y-3">
                <label className="block text-sm text-slate-700">
                  回答後メッセージ（出勤）
                  <textarea
                    value={config.reply_present}
                    onChange={(e) => setConfig((c) => ({ ...c, reply_present: e.target.value }))}
                    rows={2}
                    className={`mt-1 w-full ${CONTROL_CLASS}`}
                  />
                </label>
                <label className="block text-sm text-slate-700">
                  回答後メッセージ（遅刻）
                  <textarea
                    value={config.reply_late}
                    onChange={(e) => setConfig((c) => ({ ...c, reply_late: e.target.value }))}
                    rows={2}
                    className={`mt-1 w-full ${CONTROL_CLASS}`}
                  />
                </label>
                <label className="block text-sm text-slate-700">
                  回答後メッセージ（欠勤）
                  <textarea
                    value={config.reply_absent}
                    onChange={(e) => setConfig((c) => ({ ...c, reply_absent: e.target.value }))}
                    rows={2}
                    className={`mt-1 w-full ${CONTROL_CLASS}`}
                  />
                </label>
                <label className="block text-sm text-slate-700">
                  回答後メッセージ（公休）
                  <textarea
                    value={config.reply_public_holiday}
                    onChange={(e) => setConfig((c) => ({ ...c, reply_public_holiday: e.target.value }))}
                    rows={2}
                    className={`mt-1 w-full ${CONTROL_CLASS}`}
                  />
                </label>
                <label className="block text-sm text-slate-700">
                  回答後メッセージ（半休）
                  <textarea
                    value={config.reply_half_holiday}
                    onChange={(e) => setConfig((c) => ({ ...c, reply_half_holiday: e.target.value }))}
                    rows={2}
                    className={`mt-1 w-full ${CONTROL_CLASS}`}
                  />
                </label>
                <label className="block text-sm text-slate-700">
                  管理者通知（出勤）
                  <textarea
                    value={config.admin_notify_present}
                    onChange={(e) => setConfig((c) => ({ ...c, admin_notify_present: e.target.value }))}
                    rows={2}
                    className={`mt-1 w-full ${CONTROL_CLASS}`}
                  />
                </label>
                <label className="block text-sm text-slate-700">
                  管理者通知（遅刻）
                  <textarea
                    value={config.admin_notify_late}
                    onChange={(e) => setConfig((c) => ({ ...c, admin_notify_late: e.target.value }))}
                    rows={2}
                    className={`mt-1 w-full ${CONTROL_CLASS}`}
                  />
                </label>
                <label className="block text-sm text-slate-700">
                  管理者通知（欠勤）
                  <textarea
                    value={config.admin_notify_absent}
                    onChange={(e) => setConfig((c) => ({ ...c, admin_notify_absent: e.target.value }))}
                    rows={2}
                    className={`mt-1 w-full ${CONTROL_CLASS}`}
                  />
                </label>
                <label className="block text-sm text-slate-700">
                  管理者通知（公休）
                  <textarea
                    value={config.admin_notify_public_holiday}
                    onChange={(e) =>
                      setConfig((c) => ({ ...c, admin_notify_public_holiday: e.target.value }))
                    }
                    rows={2}
                    className={`mt-1 w-full ${CONTROL_CLASS}`}
                  />
                </label>
                <label className="block text-sm text-slate-700">
                  管理者通知（半休）
                  <textarea
                    value={config.admin_notify_half_holiday}
                    onChange={(e) =>
                      setConfig((c) => ({ ...c, admin_notify_half_holiday: e.target.value }))
                    }
                    rows={2}
                    className={`mt-1 w-full ${CONTROL_CLASS}`}
                  />
                </label>
              </div>
            </details>
            <label className="block text-sm text-slate-700">
              LINE詳細カスタム(JSON・上級者向け)
              <p className="mt-0.5 text-xs text-slate-500">
                通常は上の入力欄だけ使ってください。ここは画面に無い高度な設定を直接上書きする項目です。
              </p>
              <textarea
                value={lineCustomizationText}
                onChange={(e) => setLineCustomizationText(e.target.value)}
                rows={8}
                spellCheck={false}
                className={`mt-1 w-full font-mono text-xs ${CONTROL_CLASS}`}
              />
            </label>

            <div className="mt-4 pt-4 border-t border-slate-200 space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">出勤確認のテスト</p>
              <div>
                <p className="text-xs font-medium text-slate-600">個別送信</p>
                <div className="mt-1 flex flex-wrap gap-2">
                  <select
                    value={individualTestCastId}
                    onChange={(e) => setIndividualTestCastId(e.target.value)}
                    className={`min-w-0 flex-1 max-w-xs text-sm ${CONTROL_CLASS}`}
                  >
                    <option value="">送信先選択</option>
                    {guideReporterCandidates.map((c) => (
                      <option key={c.id} value={c.id} disabled={!c.line_user_id}>
                        {c.name}
                        {c.line_user_id ? "" : "（LINE未連携）"}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => void handleIndividualTest()}
                    disabled={testingIndividual || !individualTestCastId}
                    className="btn-secondary whitespace-nowrap"
                  >
                    送信
                  </button>
                </div>
                {individualTestDetail ? (
                  <p className="mt-1 text-xs text-slate-600">{individualTestDetail}</p>
                ) : null}
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-3">
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
            </div>

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
              営業前サマリー編集（業態共通）
              <p className="mt-0.5 text-xs text-slate-500">
                プレビュー欄を直接編集してください。内部で {"{summary_body}"} に自動変換します。
              </p>
              <textarea
                value={preOpenReportTemplateText}
                readOnly
                rows={2}
                className={`mt-1 w-full font-mono text-xs ${CONTROL_CLASS}`}
              />
            </label>
            <label className="block text-sm text-slate-700">
              週間レポートテンプレート
              <p className="mt-0.5 text-xs text-slate-500">
                {"{weekly_report_body}"} を差し込み位置として使います。
              </p>
              <textarea
                value={weeklyReportTemplateText}
                onChange={(e) => setWeeklyReportTemplateText(e.target.value)}
                rows={3}
                className={`mt-1 w-full font-mono text-xs ${CONTROL_CLASS}`}
              />
              <textarea
                value={weeklyTemplatePreview}
                readOnly
                rows={4}
                className={`mt-1 w-full font-mono text-xs ${CONTROL_CLASS}`}
              />
            </label>
            <label className="block text-sm text-slate-700">
              出勤確認サマリーテンプレート（BAR日報）
              <p className="mt-0.5 text-xs text-slate-500">
                {"{daily_bar_summary_body}"} を差し込み位置として使います。
              </p>
              <textarea
                value={dailyBarSummaryTemplateText}
                onChange={(e) => setDailyBarSummaryTemplateText(e.target.value)}
                rows={3}
                className={`mt-1 w-full font-mono text-xs ${CONTROL_CLASS}`}
              />
              <textarea
                value={dailyBarTemplatePreview}
                readOnly
                rows={4}
                className={`mt-1 w-full font-mono text-xs ${CONTROL_CLASS}`}
              />
            </label>
            <label className="block text-sm text-slate-700">
              出勤確認送信サマリーテンプレート（管理者通知）
              <p className="mt-0.5 text-xs text-slate-500">変数: {"{count}"}, {"{list}"}</p>
              <textarea
                value={remindAdminSummaryTemplateText}
                onChange={(e) => setRemindAdminSummaryTemplateText(e.target.value)}
                rows={3}
                className={`mt-1 w-full font-mono text-xs ${CONTROL_CLASS}`}
              />
              <textarea
                value={remindAdminSummaryTemplatePreview}
                readOnly
                rows={4}
                className={`mt-1 w-full font-mono text-xs ${CONTROL_CLASS}`}
              />
            </label>
            <details className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <summary className="cursor-pointer text-sm font-medium text-slate-800">
                未返信アラート文面テンプレート
              </summary>
              <div className="mt-3 space-y-3">
                <label className="block text-sm text-slate-700">
                  見出し
                  <textarea
                    value={warnUnansweredHeaderText}
                    onChange={(e) => setWarnUnansweredHeaderText(e.target.value)}
                    rows={2}
                    className={`mt-1 w-full ${CONTROL_CLASS}`}
                  />
                </label>
                <label className="block text-sm text-slate-700">
                  1行テンプレート
                  <p className="mt-0.5 text-xs text-slate-500">変数: {"{name}"}, {"{time}"}</p>
                  <textarea
                    value={warnUnansweredLineTemplateText}
                    onChange={(e) => setWarnUnansweredLineTemplateText(e.target.value)}
                    rows={2}
                    className={`mt-1 w-full font-mono text-xs ${CONTROL_CLASS}`}
                  />
                </label>
                <label className="block text-sm text-slate-700">
                  残数テンプレート
                  <p className="mt-0.5 text-xs text-slate-500">変数: {"{count}"}</p>
                  <textarea
                    value={warnUnansweredAndMoreTemplateText}
                    onChange={(e) => setWarnUnansweredAndMoreTemplateText(e.target.value)}
                    rows={2}
                    className={`mt-1 w-full font-mono text-xs ${CONTROL_CLASS}`}
                  />
                </label>
                <textarea
                  value={warnUnansweredTemplatePreview}
                  readOnly
                  rows={4}
                  className={`w-full font-mono text-xs ${CONTROL_CLASS}`}
                />
              </div>
            </details>
            <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-3 space-y-2">
              <p className="text-xs font-semibold text-slate-800">営業前サマリー 現在送信文面プレビュー</p>
              <p className="text-xs text-slate-600">
                実際の送信ロジックと同じ内容です。キャスト名は「キャスト1」等に置換済みで、この欄を直接編集できます。
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="date"
                  value={preOpenPreviewDate}
                  onChange={(e) => setPreOpenPreviewDate(e.target.value)}
                  className={`w-full max-w-[220px] text-sm ${CONTROL_CLASS}`}
                />
                <button
                  type="button"
                  onClick={() => void handleRefreshPreOpenPreview()}
                  disabled={preOpenPreviewLoading}
                  className="btn-secondary whitespace-nowrap"
                >
                  {preOpenPreviewLoading ? "読込中..." : "プレビュー更新"}
                </button>
              </div>
              <textarea
                value={preOpenPreviewEditorText}
                onChange={(e) => handleEditPreOpenPreview(e.target.value)}
                rows={14}
                className={`w-full font-mono text-xs ${CONTROL_CLASS}`}
              />
              {preOpenPreviewError ? (
                <p className="text-xs text-red-600">{preOpenPreviewError}</p>
              ) : null}
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-3 space-y-2">
              <p className="text-xs font-semibold text-slate-800">営業前サマリー 個別テスト</p>
              <p className="text-xs text-slate-600">選択したキャストへ、営業前サマリー相当のメッセージを1通送信します。</p>
              <div className="flex flex-wrap gap-2">
                <select
                  value={barSummaryTestCastId}
                  onChange={(e) => setBarSummaryTestCastId(e.target.value)}
                  className={`min-w-0 flex-1 max-w-xs text-sm ${CONTROL_CLASS}`}
                >
                  <option value="">送信先選択</option>
                  {guideReporterCandidates.map((c) => (
                    <option key={`sum-${c.id}`} value={c.id} disabled={!c.line_user_id}>
                      {c.name}
                      {c.line_user_id ? "" : "（LINE未連携）"}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => void handleBarSummaryTest()}
                  disabled={testingBarSummary || !barSummaryTestCastId}
                  className="btn-secondary whitespace-nowrap"
                >
                  送信
                </button>
              </div>
              {barSummaryTestDetail ? <p className="text-xs text-slate-600">{barSummaryTestDetail}</p> : null}
            </div>

            {businessType === "welfare_b" ? (
              <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-3 space-y-2">
                <p className="text-xs font-semibold text-slate-800">福祉定期配信 個別テスト</p>
                <p className="text-xs text-slate-600">
                  朝開始・昼体調確認・夕方終了のFlexを、選択した利用者へ1通だけ送信します。
                </p>
                <div className="flex flex-wrap gap-2">
                  <select
                    value={welfareTestSegment}
                    onChange={(e) =>
                      setWelfareTestSegment(
                        e.target.value === "midday"
                          ? "midday"
                          : e.target.value === "evening"
                            ? "evening"
                            : "morning"
                      )
                    }
                    className={`w-full max-w-[220px] text-sm ${CONTROL_CLASS}`}
                  >
                    <option value="morning">朝開始（9:00）</option>
                    <option value="midday">昼体調確認（12:00）</option>
                    <option value="evening">夕方終了（17:00）</option>
                  </select>
                  <select
                    value={welfareTestCastId}
                    onChange={(e) => setWelfareTestCastId(e.target.value)}
                    className={`min-w-0 flex-1 max-w-xs text-sm ${CONTROL_CLASS}`}
                  >
                    <option value="">送信先選択</option>
                    {guideReporterCandidates.map((c) => (
                      <option key={`welfare-${c.id}`} value={c.id} disabled={!c.line_user_id}>
                        {c.name}
                        {c.line_user_id ? "" : "（LINE未連携）"}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => void handleWelfareTestSend()}
                    disabled={testingWelfare || !welfareTestCastId}
                    className="btn-secondary whitespace-nowrap"
                  >
                    {testingWelfare ? "送信中..." : "送信"}
                  </button>
                </div>
                {welfareTestDetail ? <p className="text-xs text-slate-600">{welfareTestDetail}</p> : null}
              </div>
            ) : null}

            <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-3 space-y-2">
              <p className="text-xs font-semibold text-slate-800">未返信アラート文面 個別テスト</p>
              <p className="text-xs text-slate-600">
                reminder_config の未返信アラート文面設定を反映したテキストを、選択先へ1通送信します。
              </p>
              <div className="flex flex-wrap gap-2">
                <select
                  value={warnUnansweredTestCastId}
                  onChange={(e) => setWarnUnansweredTestCastId(e.target.value)}
                  className={`min-w-0 flex-1 max-w-xs text-sm ${CONTROL_CLASS}`}
                >
                  <option value="">送信先選択</option>
                  {guideReporterCandidates.map((c) => (
                    <option key={`warn-unanswered-${c.id}`} value={c.id} disabled={!c.line_user_id}>
                      {c.name}
                      {c.line_user_id ? "" : "（LINE未連携）"}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => void handleWarnUnansweredTest()}
                  disabled={testingWarnUnanswered || !warnUnansweredTestCastId}
                  className="btn-secondary whitespace-nowrap"
                >
                  {testingWarnUnanswered ? "送信中..." : "送信"}
                </button>
              </div>
              {warnUnansweredTestDetail ? (
                <p className="text-xs text-slate-600">{warnUnansweredTestDetail}</p>
              ) : null}
            </div>
          </section>

          {businessType === "cabaret" && (
            <section className="app-card p-4 space-y-3 text-slate-900">
              <h2 className="text-sm font-semibold text-slate-900 inline-flex items-center gap-1.5">
                案内数入力（キャバクラ専用）
                <Tip text="送信時刻・自動送信ON/OFF・受取担当・入力対象名をこのブロックで設定します。Cron は guidance_request_time（未適用時は guide_hearing_time）と JST 整時を照合します。業態別で案内ヒアリングがOFFの店舗では定期送信されません。" />
              </h2>
              <p className="text-xs text-slate-600">
                「案内数の入力対象を選んでください（店舗名）。」とクイックリプライを送り、セクキャバ／GOLD の案内フローを開始します。
              </p>
              {!isGuideMasterEnabled ? (
                <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-2 py-1.5">
                  店舗基本設定の「案内ヒアリングを利用する」がOFFのため、定期ジョブでは送信されません。設定のあとマスターをONにしてください。
                </p>
              ) : null}
              <label className="flex items-start gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={guideHearingEnabled}
                  onChange={(e) => setGuideHearingEnabled(e.target.checked)}
                  className="mt-0.5 h-4 w-4 accent-blue-600 disabled:accent-slate-400"
                />
                案内数入力メッセージを自動送信する（Cron が JST 整時に一致した店舗へ送信）
              </label>
              <label className="block text-sm text-slate-700">
                送信時刻（JST・整時）
                <Tip text="DB の guidance_request_time（マイグレーション未適用時は guide_hearing_time）に保存されます。" />
                <select
                  value={guideHearingTime}
                  onChange={(e) => setGuideHearingTime(e.target.value)}
                  className={`mt-1 block w-full max-w-xs ${CONTROL_CLASS}`}
                >
                  {REMIND_TIME_OPTIONS.map((v) => (
                    <option key={`cab-gh-${v}`} value={v}>
                      {v}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm text-slate-700">
                LINE受取担当（起点メッセージの宛先）
                <select
                  value={guideHearingReporterId}
                  onChange={(e) => setGuideHearingReporterId(e.target.value)}
                  className={`mt-1 block w-full max-w-sm ${CONTROL_CLASS}`}
                >
                  <option value="">選択してください</option>
                  {guideReporterCandidates.map((c) => (
                    <option key={c.id} value={c.id} disabled={!c.line_user_id}>
                      {c.name}
                      {c.line_user_id ? "" : "（LINE未連携）"}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm text-slate-700">
                入力対象スタッフ名（改行またはカンマ区切り・最大13名）
                <textarea
                  value={guideStaffNamesText}
                  onChange={(e) => setGuideStaffNamesText(e.target.value)}
                  rows={4}
                  placeholder={"例）\n山田\n佐藤"}
                  className={`mt-1 w-full max-w-lg font-mono text-sm ${CONTROL_CLASS}`}
                />
              </label>
              {isGuideMasterEnabled ? (
                <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50/70 p-3 space-y-2">
                  <p className="text-xs font-semibold text-slate-800">案内ヒアリング 個別テスト</p>
                  <p className="text-xs text-slate-600">
                    クイックリプライ付きの起点メッセージを手動送信します。担当者宛・別キャスト宛・公式LINEグループ宛を選べます。
                  </p>
                  <label className="block text-xs text-slate-600">
                    送信先
                    <select
                      value={guideHearingTestMode}
                      onChange={(e) => {
                        const v = e.target.value;
                        setGuideHearingTestMode(v === "cast" ? "cast" : v === "group" ? "group" : "reporter");
                        setGuideHearingTestDetail(null);
                      }}
                      className={`mt-1 block w-full max-w-md text-sm ${CONTROL_CLASS}`}
                    >
                      <option value="reporter">受取担当（本番の定期送信と同じ宛先）</option>
                      <option value="cast">指定キャスト（LINEユーザー宛）</option>
                      <option value="group">公式LINEグループ（店舗に紐づくグループID）</option>
                    </select>
                  </label>
                  {guideHearingTestMode === "cast" ? (
                    <select
                      value={guideHearingTestCastId}
                      onChange={(e) => setGuideHearingTestCastId(e.target.value)}
                      className={`block w-full max-w-md text-sm ${CONTROL_CLASS}`}
                    >
                      <option value="">送信先キャストを選択</option>
                      {guideReporterCandidates.map((c) => (
                        <option key={`gh-test-${c.id}`} value={c.id} disabled={!c.line_user_id}>
                          {c.name}
                          {c.line_user_id ? "" : "（LINE未連携）"}
                        </option>
                      ))}
                    </select>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => void handleGuideHearingTest()}
                    disabled={testingGuideHearing}
                    className="btn-secondary"
                  >
                    {testingGuideHearing ? "送信中..." : "起点メッセージをテスト送信"}
                  </button>
                  {guideHearingTestDetail ? (
                    <p className="text-xs text-slate-700">{guideHearingTestDetail}</p>
                  ) : null}
                </div>
              ) : null}
            </section>
          )}

          <section className="app-card p-4 space-y-3 text-slate-900">
            <h2 className="text-sm font-semibold text-slate-900 inline-flex items-center gap-1.5">
              週間レポート自動送信
              <Tip text="管理者LINEへ、直近7日分の集計テキストを毎週自動送信します。送信曜日・時刻の条件一致時のみ送信されます（Vercel / Cron はBearer CRON_SECRET）。" />
            </h2>
            <p className="text-xs text-slate-600">
              対象期間は「送信日の前日」を終端とした過去7日間です。フェーズ1はテキストメッセージのみです。
            </p>
            <label className="flex items-start gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={weeklyReportEnabled}
                onChange={(e) => setWeeklyReportEnabled(e.target.checked)}
                className="mt-0.5 h-4 w-4 accent-blue-600 disabled:accent-slate-400"
              />
              週間レポートを自動送信する
            </label>
            <label className="block text-sm text-slate-700">
              送信曜日（JST）
              <select
                value={weeklyReportDay}
                onChange={(e) => setWeeklyReportDay(Number(e.target.value))}
                className={`mt-1 block w-full max-w-xs ${CONTROL_CLASS}`}
              >
                {WEEKDAY_HOLIDAY_LABELS.map((label, idx) => (
                  <option key={idx} value={idx}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm text-slate-700">
              送信時刻（JST・整時）
              <select
                value={weeklyReportTime}
                onChange={(e) => setWeeklyReportTime(e.target.value)}
                className={`mt-1 block w-full max-w-xs ${CONTROL_CLASS}`}
              >
                {REMIND_TIME_OPTIONS.map((v) => (
                  <option key={`wr-${v}`} value={v}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
            <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50/70 p-3 space-y-2">
              <p className="text-xs font-semibold text-slate-800">週間レポートのテスト送信</p>
              <p className="text-xs text-slate-600">
                設定した曜日・時刻に関係なく、いまの集計を送信します（本番の冪等フラグは更新しません）。
              </p>
              <select
                value={weeklyReportTestCastId}
                onChange={(e) => setWeeklyReportTestCastId(e.target.value)}
                className={`min-w-0 w-full max-w-xs text-sm ${CONTROL_CLASS}`}
              >
                <option value="">管理者宛（既存動作）</option>
                {guideReporterCandidates.map((c) => (
                  <option key={`weekly-test-${c.id}`} value={c.id} disabled={!c.line_user_id}>
                    {c.name}
                    {c.line_user_id ? "" : "（LINE未連携）"}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => void handleWeeklyReportTest()}
                disabled={testingWeeklyReport}
                className="btn-secondary"
              >
                {testingWeeklyReport ? "送信中..." : "今すぐ送信"}
              </button>
              {weeklyReportTestDetail ? (
                <p className="text-xs text-slate-700">{weeklyReportTestDetail}</p>
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
