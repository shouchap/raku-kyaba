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

/** stores.welfare_work_items 未設定時の既定（カンマ区切りと同じ並び） */
export const DEFAULT_WELFARE_WORK_ITEMS_CSV = "A作業,B作業";

function resolveWelfareBody(custom: string | null | undefined, fallback: string): string {
  const t = typeof custom === "string" ? custom.trim() : "";
  return t.length > 0 ? t : fallback;
}

/**
 * 管理画面のカンマ区切り文字列から作業項目ラベル配列を得る（未設定・空は既定）
 * LINE ボタン数の上限を考慮し最大10件
 */
export function parseWelfareWorkItemLabels(raw: string | null | undefined): string[] {
  const s = typeof raw === "string" ? raw.trim() : "";
  const source = s.length > 0 ? s : DEFAULT_WELFARE_WORK_ITEMS_CSV;
  const labels = [...new Set(source.split(",").map((x) => x.trim()).filter(Boolean))];
  return labels.slice(0, 10);
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
        contents: [postbackButton("作業を開始する", "welfare_action=start_work")],
      },
    },
  };
}

/** ② 昼12:00 体調（良好 / 不調 / 担当者に連絡） */
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
          postbackButton("良好", "welfare_action=health_good"),
          postbackButton("不調", "welfare_action=health_bad"),
          postbackButton("担当者に連絡", "welfare_action=health_contact"),
        ],
      },
    },
  };
}

/** ③ 夕方17:00 作業終了（終了ボタンのみ） */
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
        contents: [postbackButton("作業を終了する", "welfare_action=end_work")],
      },
    },
  };
}

/** 「作業を終了する」直後：通常終了か通院報告終了かを選ばせる */
export function buildWelfareEndWorkChoiceFlexMessage(): LineReplyMessage {
  const text = "本日の終了方法を選んでください。";
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
          postbackButton("通常の作業終了", "welfare_action=end_work_normal"),
          postbackButton("通院報告をして終了", "welfare_action=end_work_hospital"),
        ],
      },
    },
  };
}

/**
 * end_work 後：作業項目選択（stores.welfare_work_items のカンマ区切りから動的生成）
 */
export function buildWelfareWorkItemSelectFlexMessage(
  welfareWorkItemsFromDb: string | null | undefined
): LineReplyMessage {
  const labels = parseWelfareWorkItemLabels(welfareWorkItemsFromDb);
  const text = "本日の作業項目を選んでください。";
  const buttons = labels.map((item) =>
    postbackButton(
      item.length > 40 ? `${item.slice(0, 37)}...` : item,
      `welfare_action=work_item&item=${encodeURIComponent(item)}`
    )
  );
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
        contents: buttons,
      },
    },
  };
}
