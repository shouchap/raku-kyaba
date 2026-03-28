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

/** 公休・半休ボタンの有無（店舗の system_settings） */
export type AttendanceRemindFlexOptions = {
  enablePublicHoliday?: boolean;
  enableHalfHoliday?: boolean;
};

const BASE_FLEX_BUTTONS: object[] = [
  {
    type: "button",
    style: "primary",
    color: "#2196F3",
    height: "sm",
    action: {
      type: "postback",
      label: "出勤",
      data: "attending",
      displayText: "出勤",
    },
  },
  {
    type: "button",
    style: "primary",
    color: "#FFC107",
    height: "sm",
    action: {
      type: "postback",
      label: "遅刻",
      data: "late",
      displayText: "遅刻",
    },
  },
  {
    type: "button",
    style: "primary",
    color: "#FF5252",
    height: "sm",
    action: {
      type: "postback",
      label: "欠勤",
      data: "absent",
      displayText: "欠勤",
    },
  },
];

/**
 * /api/remind 等と同一の出勤確認 Flex（店舗名ヘッダー・縦ボタン）
 * @param storeName stores.name（テナント表示名。空のときは「店舗」）
 * @param flexOptions 公休・半休は true のときのみフッターに追加
 */
export function buildAttendanceRemindFlexMessage(
  bodyText: string,
  storeName: string | null | undefined,
  flexOptions?: AttendanceRemindFlexOptions
): LineReplyMessage {
  const headerTitle = `${formatFlexHeaderStoreName(storeName)} 出勤確認`;
  const showPublic = flexOptions?.enablePublicHoliday === true;
  const showHalf = flexOptions?.enableHalfHoliday === true;

  const footerContents: object[] = [...BASE_FLEX_BUTTONS];
  if (showPublic) {
    footerContents.push({
      type: "button",
      style: "primary",
      color: "#9C27B0",
      height: "sm",
      action: {
        type: "postback",
        label: "公休",
        data: "public_holiday",
        displayText: "公休",
      },
    });
  }
  if (showHalf) {
    footerContents.push({
      type: "button",
      style: "primary",
      color: "#795548",
      height: "sm",
      action: {
        type: "postback",
        label: "半休",
        data: "half_holiday",
        displayText: "半休",
      },
    });
  }

  return {
    type: "flex",
    altText: `${bodyText.slice(0, 60)}${bodyText.length > 60 ? "…" : ""}\n下のボタンから選択してください。`,
    contents: {
      type: "bubble",
      header: {
        type: "box",
        layout: "vertical",
        contents: [
          {
            type: "separator",
            color: "#D4AF37",
          },
          {
            type: "text",
            text: headerTitle,
            color: "#D4AF37",
            size: "sm",
            weight: "bold",
            margin: "sm",
          },
        ],
      },
      body: {
        type: "box",
        layout: "vertical",
        contents: [
          {
            type: "text",
            text: bodyText,
            wrap: true,
            size: "md",
            color: "#333333",
          },
        ],
      },
      footer: {
        type: "box",
        layout: "vertical",
        spacing: "sm",
        contents: footerContents,
      },
    },
  };
}
