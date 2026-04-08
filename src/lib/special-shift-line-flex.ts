import { getAppOrigin } from "@/lib/app-origin";
import type { LineReplyMessage } from "@/lib/line-reply";

/** 仕様どおりの文面（altText・本文兼用） */
export const SPECIAL_SHIFT_LINE_BODY =
  "【GW特別シフト提出のお願い】\n以下のボタンから、出勤可能な日程を提出してください。";

/**
 * 特別期間シフト提出用 Flex（ボタンで Web フォームへ）
 */
export function buildSpecialShiftRequestFlex(
  eventId: string,
  castId: string,
  bodyText: string = SPECIAL_SHIFT_LINE_BODY
): LineReplyMessage {
  const origin = getAppOrigin();
  const uri = `${origin}/cast/special-shift/${encodeURIComponent(eventId)}?castId=${encodeURIComponent(castId)}`;

  return {
    type: "flex",
    altText: bodyText.replace(/\n/g, " "),
    contents: {
      type: "bubble",
      size: "mega",
      body: {
        type: "box",
        layout: "vertical",
        spacing: "md",
        contents: [
          {
            type: "text",
            text: bodyText,
            wrap: true,
            size: "sm",
          },
        ],
      },
      footer: {
        type: "box",
        layout: "vertical",
        spacing: "sm",
        contents: [
          {
            type: "button",
            style: "primary",
            height: "sm",
            action: {
              type: "uri",
              label: "日程を提出する",
              uri,
            },
          },
        ],
      },
    },
  };
}
