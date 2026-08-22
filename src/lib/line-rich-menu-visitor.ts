/**
 * LINE リッチメニュー（来客ボタン）の作成・適用。
 *
 * Messaging API:
 * - POST /v2/bot/richmenu
 * - POST /v2/bot/richmenu/{id}/content  (画像)
 * - POST /v2/bot/user/all/richmenu/{id} (デフォルト紐付け)
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { VISITOR_ARRIVAL_POSTBACK } from "@/lib/line-visitor-arrival";

const LINE_API = "https://api.line.me/v2/bot";
const LINE_DATA_API = "https://api-data.line.me/v2/bot";

/** コンパクトサイズ（横長1段）。右寄せの小さめ「来客」ボタンのみ反応 */
const RICH_MENU_WIDTH = 2500;
const RICH_MENU_HEIGHT = 843;
/** 画像上のボタン領域（public/line-rich-menu-visitor.png と一致） */
const VISITOR_BUTTON_BOUNDS = {
  x: 1600,
  y: 161,
  width: 780,
  height: 520,
} as const;

export type CreateVisitorRichMenuResult = {
  richMenuId: string;
  linkedDefault: boolean;
};

async function lineJson<T>(
  url: string,
  token: string,
  init?: RequestInit
): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init?.headers ?? {}),
    },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`LINE API ${res.status}: ${text}`);
  }
  return text ? (JSON.parse(text) as T) : ({} as T);
}

/** public/line-rich-menu-visitor.png を読む（無ければエラー） */
export function loadVisitorRichMenuImage(): Buffer {
  const filePath = path.join(
    process.cwd(),
    "public",
    "line-rich-menu-visitor.png"
  );
  return readFileSync(filePath);
}

/**
 * 「来客」1ボタンのリッチメニューを作成し、チャネルのデフォルトに設定する。
 * 既存のデフォルトリッチメニューは上書きされる。
 */
export async function createAndLinkVisitorArrivalRichMenu(
  channelAccessToken: string
): Promise<CreateVisitorRichMenuResult> {
  const created = await lineJson<{ richMenuId: string }>(
    `${LINE_API}/richmenu`,
    channelAccessToken,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        size: { width: RICH_MENU_WIDTH, height: RICH_MENU_HEIGHT },
        selected: true,
        name: "visitor_arrival_v2",
        chatBarText: "メニュー",
        areas: [
          {
            bounds: { ...VISITOR_BUTTON_BOUNDS },
            action: {
              type: "postback",
              data: VISITOR_ARRIVAL_POSTBACK,
              displayText: "来客",
            },
          },
        ],
      }),
    }
  );

  const richMenuId = created.richMenuId;
  if (!richMenuId) {
    throw new Error("richMenuId が返りませんでした");
  }

  const image = loadVisitorRichMenuImage();
  const uploadRes = await fetch(
    `${LINE_DATA_API}/richmenu/${encodeURIComponent(richMenuId)}/content`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${channelAccessToken}`,
        "Content-Type": "image/png",
      },
      body: new Uint8Array(image),
    }
  );
  if (!uploadRes.ok) {
    const errText = await uploadRes.text();
    throw new Error(`リッチメニュー画像アップロード失敗: ${uploadRes.status} ${errText}`);
  }

  await lineJson(
    `${LINE_API}/user/all/richmenu/${encodeURIComponent(richMenuId)}`,
    channelAccessToken,
    { method: "POST" }
  );

  return { richMenuId, linkedDefault: true };
}
