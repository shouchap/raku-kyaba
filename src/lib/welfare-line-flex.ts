/**
 * B型事業所（welfare_b）向け Flex Message（キャバクラ系ロジックと独立）
 */
import type { LineReplyMessage } from "@/lib/line-reply";

const BODY_COLOR = "#37474F";
const BTN_PRIMARY = "#00838F";

/** DB が NULL のとき cron / Flex で使う既定文 */
export const DEFAULT_WELFARE_MESSAGE_MORNING =
  "おはようございます！本日の作業を開始する際は、下のボタンを押してください。";
export const DEFAULT_WELFARE_MESSAGE_MIDDAY = "お疲れ様です！本日の体調はどうですか？！";
export const DEFAULT_WELFARE_MESSAGE_EVENING =
  "本日の作業お疲れ様でした！作業終了の報告をお願いします。";

function resolveWelfareBody(custom: string | null | undefined, fallback: string): string {
  const t = typeof custom === "string" ? custom.trim() : "";
  return t.length > 0 ? t : fallback;
}

function postbackButton(label: string, data: string): object {
  return {
    type: "button" as const,
    style: "primary" as const,
    color: BTN_PRIMARY,
    height: "md" as const,
    action: {
      type: "postback" as const,
      label,
      data,
      displayText: label,
    },
  };
}

/** ① 朝9:00 作業開始 */
export function buildWelfareMorningStartFlexMessage(
  bodyText?: string | null
): LineReplyMessage {
  const text = resolveWelfareBody(bodyText, DEFAULT_WELFARE_MESSAGE_MORNING);
  return {
    type: "flex",
    altText: `${text}（ボタンから操作）`,
    contents: {
      type: "bubble",
      size: "mega" as const,
      body: {
        type: "box",
        layout: "vertical" as const,
        paddingAll: "20px",
        spacing: "md" as const,
        contents: [
          {
            type: "text",
            text,
            wrap: true,
            weight: "bold" as const,
            size: "md" as const,
            color: BODY_COLOR,
          },
        ],
      },
      footer: {
        type: "box",
        layout: "vertical" as const,
        paddingAll: "20px",
        paddingTop: "12px",
        spacing: "sm" as const,
        contents: [postbackButton("▶️ 作業を開始する", "welfare_action=start_work")],
      },
    },
  };
}

/** ② 昼12:00 体調 */
export function buildWelfareMiddayHealthFlexMessage(
  bodyText?: string | null
): LineReplyMessage {
  const text = resolveWelfareBody(bodyText, DEFAULT_WELFARE_MESSAGE_MIDDAY);
  return {
    type: "flex",
    altText: `${text}（ボタンから回答）`,
    contents: {
      type: "bubble",
      size: "mega" as const,
      body: {
        type: "box",
        layout: "vertical" as const,
        paddingAll: "20px",
        spacing: "md" as const,
        contents: [
          {
            type: "text",
            text,
            wrap: true,
            weight: "bold" as const,
            size: "md" as const,
            color: BODY_COLOR,
          },
        ],
      },
      footer: {
        type: "box",
        layout: "vertical" as const,
        paddingAll: "20px",
        paddingTop: "12px",
        spacing: "sm" as const,
        contents: [
          postbackButton("😆 良好", "welfare_action=health_good"),
          postbackButton("😖 少ししんどい", "welfare_action=health_soso"),
          postbackButton("🤢 不調", "welfare_action=health_bad"),
        ],
      },
    },
  };
}

/** ③ 夕方17:00 作業終了 */
export function buildWelfareEveningEndFlexMessage(
  bodyText?: string | null
): LineReplyMessage {
  const text = resolveWelfareBody(bodyText, DEFAULT_WELFARE_MESSAGE_EVENING);
  return {
    type: "flex",
    altText: `${text}（ボタンから操作）`,
    contents: {
      type: "bubble",
      size: "mega" as const,
      body: {
        type: "box",
        layout: "vertical" as const,
        paddingAll: "20px",
        spacing: "md" as const,
        contents: [
          {
            type: "text",
            text,
            wrap: true,
            weight: "bold" as const,
            size: "md" as const,
            color: BODY_COLOR,
          },
        ],
      },
      footer: {
        type: "box",
        layout: "vertical" as const,
        paddingAll: "20px",
        paddingTop: "12px",
        spacing: "sm" as const,
        contents: [postbackButton("⏹️ 作業を終了する", "welfare_action=end_work")],
      },
    },
  };
}

/** end_work 後：作業項目選択 */
export function buildWelfareWorkItemSelectFlexMessage(): LineReplyMessage {
  const text = "本日の作業項目を選んでください。";
  return {
    type: "flex",
    altText: `${text}（ボタンから選択）`,
    contents: {
      type: "bubble",
      size: "mega" as const,
      body: {
        type: "box",
        layout: "vertical" as const,
        paddingAll: "20px",
        spacing: "md" as const,
        contents: [
          {
            type: "text",
            text,
            wrap: true,
            weight: "bold" as const,
            size: "md" as const,
            color: BODY_COLOR,
          },
        ],
      },
      footer: {
        type: "box",
        layout: "vertical" as const,
        paddingAll: "20px",
        paddingTop: "12px",
        spacing: "sm" as const,
        contents: [
          postbackButton("A作業", "welfare_action=work_item&item=A"),
          postbackButton("B作業", "welfare_action=work_item&item=B"),
        ],
      },
    },
  };
}
