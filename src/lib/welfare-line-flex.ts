/**
 * B型事業所（welfare_b）向け Flex Message（キャバクラ系ロジックと独立）
 */
import type { LineReplyMessage, LineTextQuickReplyItem } from "@/lib/line-reply";

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

/** LINE クイックリプライのラベル上限（目安 20 文字） */
export function truncateWelfareQuickReplyLabel(text: string, maxLen = 20): string {
  const t = String(text ?? "").trim();
  if (t.length <= maxLen) return t;
  if (maxLen < 2) return "…";
  return `${t.slice(0, maxLen - 1)}…`;
}

/** クイックリプライ上限 13 件のうち「その他」用に 1 枠確保 */
const MAX_HOSPITAL_QUICK_REPLIES = 12;

/** DB / API から受け取った値を表示・照合用に正規化（trim・重複除去） */
export function normalizeDefaultHospitalNames(raw: unknown): string[] {
  if (!raw || !Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of raw) {
    const t = typeof x === "string" ? x.trim() : "";
    if (t && !seen.has(t)) {
      seen.add(t);
      out.push(t);
    }
  }
  return out;
}

/** Q1 病院名: かかりつけがあれば病院ごとにクイックリプライ＋その他 */
export function buildWelfareHospitalNameQuestionMessage(
  defaultHospitalNames: string[] | null | undefined
): LineReplyMessage {
  const text = "病院名を教えてください";
  const names = normalizeDefaultHospitalNames(defaultHospitalNames);
  if (names.length === 0) {
    return { type: "text", text };
  }
  const items: LineTextQuickReplyItem[] = names.slice(0, MAX_HOSPITAL_QUICK_REPLIES).map((name) => ({
    type: "action",
    action: {
      type: "postback",
      label: truncateWelfareQuickReplyLabel(name),
      data: `welfare_action=hospital_name_pick&name=${encodeURIComponent(name)}`,
      displayText: name.length > 300 ? `${name.slice(0, 300)}…` : name,
    },
  }));
  items.push({
    type: "action",
    action: {
      type: "postback",
      label: "その他（手入力）",
      data: "welfare_action=hospital_name_other",
      displayText: "その他（手入力）",
    },
  });
  return { type: "text", text, quickReply: { items } };
}

/** Q3 通院時間: クイックリプライ（「その他」は postback で別処理） */
export function buildWelfareHospitalDurationQuickReplyMessage(): LineReplyMessage {
  const items: LineTextQuickReplyItem[] = [
    {
      type: "action",
      action: {
        type: "postback",
        label: "1時間未満",
        data: "welfare_action=hospital_duration&slot=under1",
        displayText: "1時間未満",
      },
    },
    {
      type: "action",
      action: {
        type: "postback",
        label: "1〜2時間",
        data: "welfare_action=hospital_duration&slot=between1_2",
        displayText: "1〜2時間",
      },
    },
    {
      type: "action",
      action: {
        type: "postback",
        label: "2〜3時間",
        data: "welfare_action=hospital_duration&slot=between2_3",
        displayText: "2〜3時間",
      },
    },
    {
      type: "action",
      action: {
        type: "postback",
        label: "半日（3時間以上）",
        data: "welfare_action=hospital_duration&slot=halfday",
        displayText: "半日（3時間以上）",
      },
    },
    {
      type: "action",
      action: {
        type: "postback",
        label: "その他（手入力）",
        data: "welfare_action=hospital_duration&slot=other",
        displayText: "その他（手入力）",
      },
    },
  ];
  return {
    type: "text",
    text: "通院にかかった時間（目安）を選んでください",
    quickReply: { items },
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

/** ③ 夕方17:00 作業終了（通常終了 / 通院報告をその場で選択） */
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
        spacing: "md" as const,
        contents: [
          postbackButton("通常の作業終了", "welfare_action=end_work_normal"),
          postbackButton("通院報告をして終了", "welfare_action=end_work_hospital"),
        ],
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
