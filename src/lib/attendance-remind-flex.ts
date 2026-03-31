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

/**
 * 出勤確認リマインド用 Flex Message（Bubble）
 * /api/remind・schedule-register から利用
 */
export function buildAttendanceRemindFlexMessage(input: AttendanceRemindFlexInput): LineReplyMessage {
  const storeTrim = String(input.storeName ?? "").trim();
  const headerMain = storeTrim.length > 0 ? storeTrim : "raku-raku出勤";
  const headerColor = storeTrim.length > 0 ? COLOR_NAVY : COLOR_BRAND_MAGENTA;

  const reminderLine = (input.reminderMessageLine ?? "").trim();

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
  ];

  if (reminderLine.length > 0) {
    bodyContents.push({
      type: "text",
      text: reminderLine,
      size: "sm" as const,
      color: COLOR_MUTED_TEXT,
      wrap: true,
    });
  } else {
    bodyContents.push({
      type: "text",
      text: `${input.castName}さん · ${input.scheduledTimeDisplay}`,
      size: "md" as const,
      color: COLOR_MUTED_TEXT,
      weight: "bold" as const,
      wrap: true,
    });
  }

  bodyContents.push({
    type: "text",
    text: "本日は出勤予定ですか？",
    size: "xl" as const,
    weight: "bold" as const,
    color: COLOR_NAVY,
    wrap: true,
    margin: "xl" as const,
  });

  const altBase = `${input.castName}さん ${input.scheduledTimeDisplay} ${input.todayJst} 出勤確認`;
  const altText =
    altBase.length > 380 ? `${altBase.slice(0, 377)}…` : `${altBase}\n下のボタンから選択してください。`;

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
        paddingAll: "20px",
        spacing: "md" as const,
        contents: bodyContents,
      },
      footer: {
        type: "box",
        layout: "vertical" as const,
        paddingAll: "20px",
        paddingTop: "12px",
        spacing: "md" as const,
        contents: buildFooterButtons(input.flexOptions),
      },
    },
  };
}
