import type { LineReplyMessage } from "@/lib/line-reply";

/**
 * Cron（/api/remind）と単日登録の即時送信で共通の、出勤予定時刻の表示文字列
 */
export function formatRemindScheduledTime(
  time: string | null | undefined,
  isDohan?: boolean | null
): string {
  if (!time) return "営業時間";
  const match = String(time).match(/^(\d{1,2}):(\d{2})/);
  const base = match ? `${match[1]}:${match[2]}` : "営業時間";
  return isDohan ? `${base}（同伴）` : base;
}

/**
 * 営業前サマリー・週間通知・一覧表示用: 時刻 + （同伴・捌き）の任意組み合わせ
 */
export function formatScheduleTimeLabel(
  time: string | null | undefined,
  isDohan?: boolean | null,
  isSabaki?: boolean | null
): string {
  const tags: string[] = [];
  if (isDohan) tags.push("同伴");
  if (isSabaki) tags.push("捌き");
  if (!time || String(time).trim() === "") {
    if (tags.length === 0) return "—";
    return tags.join("・");
  }
  const match = String(time).match(/^(\d{1,2}):(\d{2})/);
  const base = match ? `${match[1]}:${match[2]}` : "—";
  if (tags.length === 0) return base;
  return `${base}（${tags.join("・")}）`;
}

/** 名前の横に付ける（同伴・捌き）表記 */
export function formatCastNameAttendanceSuffix(
  isDohan?: boolean | null,
  isSabaki?: boolean | null
): string {
  const tags: string[] = [];
  if (isDohan) tags.push("同伴");
  if (isSabaki) tags.push("捌き");
  if (tags.length === 0) return "";
  return `（${tags.join("・")}）`;
}

/** 捌き出勤向けリマインド本文（時刻行は使わない） */
export function buildSabakiRemindLines(castName: string): {
  reminderMessageLine: string;
  scheduledTimeDisplay: string;
} {
  const n = (castName ?? "").trim() || "キャスト";
  return {
    reminderMessageLine: `${n}さん、本日は捌き出勤よろしくお願いいたします。何時入りか分かればお知らせください。`,
    scheduledTimeDisplay: "捌き出勤",
  };
}

/**
 * reminder_config.messageTemplate の {name} / {time} 置換
 */
export function applyReminderMessageTemplate(
  template: string,
  name: string,
  timeStr: string
): string {
  const safeTpl =
    template && typeof template === "string"
      ? template
      : "{name}さん、本日は {time} 出勤予定です。出勤確認をお願いいたします。";
  return safeTpl
    .replace(/\{name\}/g, name ?? "キャスト")
    .replace(/\{time\}/g, timeStr ?? "営業時間");
}

/** Flex ヘッダー用。空なら「店舗」 */
export function formatFlexHeaderStoreName(storeName: string | null | undefined): string {
  const s = String(storeName ?? "").trim();
  return s.length > 0 ? s : "店舗";
}

/** 半休・公休ボタンの有無（店舗の system_settings） */
export type AttendanceRemindFlexOptions = {
  enablePublicHoliday?: boolean;
  enableHalfHoliday?: boolean;
};

/** ブランド・ボタン配色（夜の店舗向け：マゼンタ／アンバー／グレー） */
const COLOR_BRAND_MAGENTA = "#AD1457";
const COLOR_NAVY = "#1A237E";
const COLOR_ATTEND_PRIMARY = "#C2185B";
const COLOR_LATE_ORANGE = "#EF6C00";
const COLOR_MUTED_GRAY_BTN = "#90A4AE";
const COLOR_HEADER_BG = "#FAFAFA";
const COLOR_BODY_TEXT = "#263238";
const COLOR_MUTED_TEXT = "#607D8B";
const COLOR_SEPARATOR = "#ECEFF1";
/** ラベル「本日の出勤予定時刻」用 */
const COLOR_SCHEDULE_LABEL = "#666666";
/** 時刻を強調しない場合のフォールバック */
const COLOR_TIME_FALLBACK = "#000000";
/** 捌き・入店時間選択ボタン用 */
const COLOR_SABAKI_TIME_BTN = "#F57C00";

/** 「○○さん、」以降の本文（店舗カスタム等）を取り出す */
function extractBodyAfterSanComma(line: string): string | null {
  const t = line.trim();
  const marker = "さん、";
  const i = t.indexOf(marker);
  if (i === -1) return null;
  const rest = t.slice(i + marker.length).trim();
  return rest.length > 0 ? rest : null;
}

/**
 * 構造化レイアウトと重複するテンプレート行は本文補足として出さない
 * （レギュラー店舗文のみ補足表示する想定）
 */
function shouldShowReminderSupplement(
  tail: string | null,
  scheduledTimeDisplay: string,
  showSabaki: boolean
): boolean {
  if (!tail || showSabaki) return false;
  const timeCore = scheduledTimeDisplay.replace(/（同伴）/g, "").trim();
  if (timeCore.length > 0 && tail.includes(timeCore)) return false;
  if (/出勤予定|出勤確認をお願い/.test(tail)) return false;
  return true;
}

export type AttendanceRemindFlexInput = {
  /** キャスト名 */
  castName: string;
  /** 出勤時刻の表示（例: 20:00、同伴時は「20:00（同伴）」） */
  scheduledTimeDisplay: string;
  /** 対象日 YYYY-MM-DD（JST） */
  todayJst: string;
  /** 店舗名。未設定時はヘッダーに「raku-raku出勤」を表示 */
  storeName: string | null | undefined;
  /** 半休・公休ボタン */
  flexOptions?: AttendanceRemindFlexOptions;
  /**
   * reminder_config のテンプレート適用後の1ブロック（任意）。
   * 店舗カスタム文言を本文に小さく表示するために使用
   */
  reminderMessageLine?: string;
  /** 捌きリマインド時: フッターは「入店時間を選択」「まだ未定」の2ボタンのみ（通常の出勤ボタンは出さない） */
  showSabakiTimePicker?: boolean;
};

function buildFooterButtons(flexOptions?: AttendanceRemindFlexOptions): object[] {
  const showHalf = flexOptions?.enableHalfHoliday === true;
  const showPublic = flexOptions?.enablePublicHoliday === true;

  const primaryBtn = (
    label: string,
    data: string,
    displayText: string,
    color: string
  ): object => ({
    type: "button",
    style: "primary" as const,
    color,
    height: "md" as const,
    flex: 0,
    action: {
      type: "postback" as const,
      label,
      data,
      displayText,
    },
  });

  /** お休み系：落ち着いたグレー（secondary + トーンを揃える） */
  const mutedBtn = (label: string, data: string, displayText: string): object => ({
    type: "button",
    style: "primary" as const,
    color: COLOR_MUTED_GRAY_BTN,
    height: "md" as const,
    flex: 0,
    action: {
      type: "postback" as const,
      label,
      data,
      displayText,
    },
  });

  const out: object[] = [
    primaryBtn("出勤", "attending", "出勤", COLOR_ATTEND_PRIMARY),
    primaryBtn("遅刻", "late", "遅刻", COLOR_LATE_ORANGE),
    mutedBtn("お休み（欠勤）", "absent", "欠勤"),
  ];

  if (showHalf) {
    out.push(mutedBtn("半休", "half_holiday", "半休"));
  }
  if (showPublic) {
    out.push(mutedBtn("公休", "public_holiday", "公休"));
  }

  return out;
}

/** 捌き出勤専用フッター: Datetimepicker と「まだ未定」のみ（出勤／遅刻等は含めない） */
function buildSabakiOnlyFooterContents(): object[] {
  return [
    {
      type: "box",
      layout: "vertical" as const,
      spacing: "sm" as const,
      contents: [
        {
          type: "button",
          style: "primary" as const,
          color: COLOR_SABAKI_TIME_BTN,
          height: "md" as const,
          flex: 0,
          action: {
            type: "datetimepicker" as const,
            label: "入店時間を選択する",
            data: "action=sabaki_time_update",
            mode: "time" as const,
            initial: "20:00",
          },
        },
        {
          type: "button",
          style: "primary" as const,
          color: COLOR_MUTED_GRAY_BTN,
          height: "md" as const,
          flex: 0,
          action: {
            type: "postback" as const,
            label: "まだ未定",
            data: "action=sabaki_time_unknown",
            displayText: "まだ未定です",
          },
        },
      ],
    },
  ];
}

/**
 * 出勤確認リマインド用 Flex Message（Bubble）
 * /api/remind・schedule-register から利用
 */
export function buildAttendanceRemindFlexMessage(input: AttendanceRemindFlexInput): LineReplyMessage {
  const storeTrim = String(input.storeName ?? "").trim();
  const headerMain = storeTrim.length > 0 ? storeTrim : "raku-raku出勤";
  const headerColor = storeTrim.length > 0 ? COLOR_NAVY : COLOR_BRAND_MAGENTA;

  const reminderLine = (input.reminderMessageLine ?? "").trim();
  const castLabel = `${String(input.castName ?? "").trim() || "キャスト"} さん`;
  const timeDisplay = String(input.scheduledTimeDisplay ?? "").trim() || "—";
  const timeHighlightColor = headerColor ?? COLOR_TIME_FALLBACK;

  const supplementTail = extractBodyAfterSanComma(reminderLine);
  const showSupplement =
    shouldShowReminderSupplement(supplementTail, timeDisplay, input.showSabakiTimePicker === true) &&
    supplementTail !== null;

  const bodyContents: object[] = [
    {
      type: "text",
      text: `${input.todayJst}（JST）`,
      weight: "bold" as const,
      size: "lg" as const,
      color: COLOR_BODY_TEXT,
      wrap: true,
    },
    {
      type: "separator",
      margin: "lg" as const,
      color: COLOR_SEPARATOR,
    },
    {
      type: "text",
      text: castLabel,
      size: "md" as const,
      color: COLOR_BODY_TEXT,
      wrap: true,
    },
    {
      type: "text",
      text: "本日の出勤予定時刻",
      size: "sm" as const,
      color: COLOR_SCHEDULE_LABEL,
      margin: "md" as const,
      wrap: true,
    },
    {
      type: "text",
      text: timeDisplay,
      size: "3xl" as const,
      weight: "bold" as const,
      color: timeHighlightColor,
      wrap: true,
    },
  ];

  if (input.showSabakiTimePicker === true) {
    bodyContents.push({
      type: "text",
      text: "何時入りか分かればお知らせください。",
      size: "sm" as const,
      color: COLOR_MUTED_TEXT,
      wrap: true,
      margin: "sm" as const,
    });
  } else if (showSupplement && supplementTail) {
    bodyContents.push({
      type: "text",
      text: supplementTail,
      size: "sm" as const,
      color: COLOR_MUTED_TEXT,
      wrap: true,
      margin: "sm" as const,
    });
  }

  bodyContents.push({
    type: "text",
    text: "本日もよろしくお願いします",
    size: "lg" as const,
    weight: "bold" as const,
    color: COLOR_NAVY,
    wrap: true,
    margin: "xl" as const,
  });

  const altBase = `${input.castName}さん ${input.scheduledTimeDisplay} ${input.todayJst} 出勤確認`;
  const altText =
    altBase.length > 380 ? `${altBase.slice(0, 377)}…` : `${altBase}\n下のボタンから選択してください。`;

  const footerContents: object[] =
    input.showSabakiTimePicker === true
      ? buildSabakiOnlyFooterContents()
      : buildFooterButtons(input.flexOptions);

  return {
    type: "flex",
    altText,
    contents: {
      type: "bubble",
      size: "mega" as const,
      header: {
        type: "box",
        layout: "vertical" as const,
        paddingAll: "20px",
        backgroundColor: COLOR_HEADER_BG,
        contents: [
          {
            type: "text",
            text: headerMain,
            color: headerColor,
            size: "xl" as const,
            weight: "bold" as const,
            wrap: true,
          },
          {
            type: "text",
            text: "出勤確認",
            color: COLOR_MUTED_TEXT,
            size: "xs" as const,
            margin: "sm" as const,
          },
        ],
      },
      body: {
        type: "box",
        layout: "vertical" as const,
        paddingTop: "20px",
        paddingBottom: "20px",
        paddingStart: "12px",
        paddingEnd: "12px",
        spacing: "md" as const,
        contents: bodyContents,
      },
      footer: {
        type: "box",
        layout: "vertical" as const,
        paddingAll: "20px",
        paddingTop: "12px",
        spacing: "md" as const,
        contents: footerContents,
      },
    },
  };
}
