/**
 * LINE Messaging API 返信処理
 *
 * 設計意図:
 * - Reply APIはreplyTokenの有効期限が短い（数十秒）ため、Webhook処理内で同期的に呼び出す
 * - Flex MessageはaltTextが必須（通知時・非対応クライアント用のフォールバック表示）
 */

const LINE_REPLY_URL = "https://api.line.me/v2/bot/message/reply";
const LINE_PUSH_URL = "https://api.line.me/v2/bot/message/push";
const LINE_MULTICAST_URL = "https://api.line.me/v2/bot/message/multicast";
const LINE_PROFILE_URL = "https://api.line.me/v2/bot/profile";

/**
 * LINE ユーザープロフィールを取得する
 * @returns displayName（取得失敗時は "ゲスト"）
 */
export async function getLineProfile(
  userId: string,
  channelAccessToken: string
): Promise<{ displayName: string }> {
  const res = await fetch(`${LINE_PROFILE_URL}/${userId}`, {
    headers: {
      Authorization: `Bearer ${channelAccessToken}`,
    },
  });

  if (!res.ok) {
    const text = await res.text();
    console.warn("[LINE] Failed to get profile:", res.status, text);
    return { displayName: "ゲスト" };
  }

  const data = (await res.json()) as { displayName?: string };
  return {
    displayName: data.displayName?.trim() || "ゲスト",
  };
}

/**
 * Reply Tokenを使ってユーザーにメッセージを返信する
 */
export async function sendReply(
  replyToken: string,
  channelAccessToken: string,
  messages: LineReplyMessage[]
): Promise<void> {
  const res = await fetch(LINE_REPLY_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${channelAccessToken}`,
    },
    body: JSON.stringify({
      replyToken,
      messages,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`LINE Reply API error: ${res.status} ${text}`);
  }
}

/**
 * ユーザーにPushメッセージを送信する
 * Replyと異なり、ユーザーが bot にメッセージを送らなくとも任意のタイミングで送信可能
 */
export async function sendPushMessage(
  userId: string,
  channelAccessToken: string,
  messages: LineReplyMessage[]
): Promise<void> {
  const res = await fetch(LINE_PUSH_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${channelAccessToken}`,
    },
    body: JSON.stringify({
      to: userId,
      messages,
    }),
  });

  const bodyText = await res.text();
  console.log("[LINE Push API] status:", res.status, "body:", bodyText || "(empty)");

  if (!res.ok) {
    throw new Error(`LINE Push API error: ${res.status} ${bodyText}`);
  }
}

/**
 * 複数ユーザーに一斉Pushメッセージを送信する（Multicast）
 * to が空配列の場合は送信せず何もしない
 */
export async function sendMulticastMessage(
  userIds: string[],
  channelAccessToken: string,
  messages: LineReplyMessage[]
): Promise<void> {
  const filtered = userIds.filter((id) => id && String(id).trim());
  if (filtered.length === 0) return;

  const res = await fetch(LINE_MULTICAST_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${channelAccessToken}`,
    },
    body: JSON.stringify({
      to: filtered,
      messages,
    }),
  });

  const bodyText = await res.text();
  console.log(
    "[LINE Multicast API] status:",
    res.status,
    "recipients:",
    filtered.length,
    "body:",
    bodyText || "(empty)"
  );

  if (!res.ok) {
    throw new Error(`LINE Multicast API error: ${res.status} ${bodyText}`);
  }
}

export type LineReplyMessage =
  | { type: "text"; text: string }
  | { type: "flex"; altText: string; contents: object }
  | {
      type: "template";
      altText: string;
      template: {
        type: "buttons";
        text: string;
        actions: Array<{
          type: "postback";
          label: string;
          data: string;
          displayText?: string;
        }>;
      };
    };

/**
 * 出勤確認用Flex Message（出勤・欠勤・遅刻ボタン付き）
 * Postbackのdata値は既存のhandleAttendanceResponseと一致させる
 */
export function createAttendanceConfirmationFlexMessage(): LineReplyMessage {
  return {
    type: "flex",
    altText: "本日の出勤確認をお願いします。下のボタンから選択してください。",
    contents: {
      type: "bubble",
      body: {
        type: "box",
        layout: "vertical",
        contents: [
          {
            type: "text",
            text: "本日の出勤確認",
            weight: "bold",
            size: "lg",
          },
          {
            type: "text",
            text: "下のボタンから選択してください。",
            margin: "md",
            color: "#666666",
          },
        ],
      },
      footer: {
        type: "box",
        layout: "horizontal",
        spacing: "sm",
        contents: [
          {
            type: "button",
            style: "primary",
            color: "#2E7D32",
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
            color: "#C62828",
            action: {
              type: "postback",
              label: "欠勤",
              data: "absent",
              displayText: "欠勤",
            },
          },
          {
            type: "button",
            style: "primary",
            color: "#F9A825",
            action: {
              type: "postback",
              label: "遅刻",
              data: "late",
              displayText: "遅刻",
            },
          },
        ],
      },
    },
  };
}
