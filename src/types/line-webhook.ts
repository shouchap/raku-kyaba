/**
 * LINE Webhook イベント型定義
 * @see https://developers.line.biz/ja/reference/messaging-api/#webhook-event-objects
 */
export interface LineWebhookBody {
  destination?: string;
  events: LineWebhookEvent[];
}

export type LineWebhookEvent =
  | LineMessageEvent
  | LinePostbackEvent
  | LineFollowEvent
  | LineUnfollowEvent
  | LineJoinEvent
  | LineLeaveEvent
  | LineMemberJoinedEvent
  | LineMemberLeftEvent
  | LineBeaconEvent
  | LineAccountLinkEvent;

interface LineEventBase {
  type: string;
  timestamp: number;
  source: LineSource;
  webhookEventId: string;
  deliveryContext: { isRedelivery: boolean };
}

export interface LineMessageEvent extends LineEventBase {
  type: "message";
  message: LineMessage;
  replyToken: string;
}

export interface LinePostbackEvent extends LineEventBase {
  type: "postback";
  postback: {
    data: string;
    params?: { date?: string; time?: string; datetime?: string };
  };
  replyToken: string;
}

interface LineFollowEvent extends LineEventBase {
  type: "follow";
  replyToken: string;
}
interface LineUnfollowEvent extends LineEventBase {
  type: "unfollow";
}
interface LineJoinEvent extends LineEventBase {
  type: "join";
  replyToken: string;
}
interface LineLeaveEvent extends LineEventBase {
  type: "leave";
}
interface LineMemberJoinedEvent extends LineEventBase {
  type: "memberJoined";
  replyToken: string;
  joined: { members: LineSource[] };
}
interface LineMemberLeftEvent extends LineEventBase {
  type: "memberLeft";
  left: { members: LineSource[] };
}
interface LineBeaconEvent extends LineEventBase {
  type: "beacon";
  replyToken: string;
  beacon: { type: string; hwid: string; dm?: string };
}
interface LineAccountLinkEvent extends LineEventBase {
  type: "accountLink";
  replyToken: string;
  link: { result: string; nonce: string };
}

export interface LineSource {
  type: "user" | "group" | "room";
  userId?: string;
  groupId?: string;
  roomId?: string;
}

export type LineMessage =
  | { type: "text"; id: string; text: string }
  | { type: "image"; id: string }
  | { type: "video"; id: string }
  | { type: "audio"; id: string }
  | { type: "file"; id: string; fileName: string; fileSize: number }
  | { type: "location"; id: string; title?: string; address?: string; latitude: number; longitude: number }
  | { type: "sticker"; id: string; packageId: string; stickerId: string }
  | { type: "template"; id: string; template: unknown }
  | { type: "flex"; id: string; flex: unknown };

/** 出勤確認のPostback data値（Flex Messageボタンで設定する値と一致させる） */
export type AttendancePostbackData =
  | "attending"
  | "absent"
  | "late"
  | "public_holiday"
  | "half_holiday";

/** 来客予定ヒアリング（クイックリプライ） */
export type ReservationPostbackData = "reservation_yes" | "reservation_no";

/** 案内数ヒアリング（従業員向け） */
export type GuidePostbackData = `guide_count:${number}` | "guide_count:other";
