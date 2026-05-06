import type { LineReplyMessage } from "@/lib/line-reply";

/** シフト／レギュラーとも時刻が取れないときの最終表示（例外時もこれへフォールバック） */
export const REMIND_TIME_UNKNOWN_DISPLAY = "--:--";

/** DB／入力値から出勤予定の HH:mm を取り出す（取れなければ null、例外時も null） */
function extractHourMinuteForRemind(raw: string | null | undefined): string | null {
  try {
    if (raw == null || String(raw).trim() === "") return null;
    const match = String(raw).trim().match(/^(\d{1,2}):(\d{2})/);
    return match ? `${match[1]}:${match[2]}` : null;
  } catch {
    return null;
  }
}

/**
 * Cron（/api/remind）と単日登録の即時送信で共通の、出勤予定時刻の表示文字列。
 * `time` が空のときは `regularFallbackHm`（店舗のレギュラー出勤時間など HH:mm）を表示に使う。
 * パース失敗・不正入力・内部例外でもスローせず {@link REMIND_TIME_UNKNOWN_DISPLAY} で送信を継続する。
 */
export function formatRemindScheduledTime(
  time: string | null | undefined,
  isDohan?: boolean | null,
  regularFallbackHm?: string | null
): string {
  try {
    const primary = extractHourMinuteForRemind(time);
    let base = primary ?? null;
    if (!base) {
      try {
        const fb = regularFallbackHm?.trim() ?? "";
        if (fb !== "") {
          base = extractHourMinuteForRemind(fb.includes(":") ? fb : `${fb}:00`);
        }
      } catch {
        base = null;
      }
    }
    if (!base) return REMIND_TIME_UNKNOWN_DISPLAY;
    const suffix = isDohan === true ? "（同伴）" : "";
    return `${base}${suffix}`;
  } catch {
    return REMIND_TIME_UNKNOWN_DISPLAY;
  }
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
 * reminder_config.messageTemplate の {name} / {time} 置換。
 * テンプレ不正・置換失敗時もスローせず最小限の文面で返す。
 */
export function applyReminderMessageTemplate(
  template: string,
  name: string,
  timeStr: string
): string {
  try {
    const safeTpl =
      template && typeof template === "string"
        ? template
        : "{name}さん、本日は {time} 出勤予定です。出勤確認をお願いいたします。";
    const safeName =
      typeof name === "string" && name.trim() !== "" ? name.trim() : "キャスト";
    let safeTime: string;
    try {
      safeTime =
        typeof timeStr === "string" && timeStr.trim() !== ""
          ? timeStr.trim()
          : REMIND_TIME_UNKNOWN_DISPLAY;
    } catch {
      safeTime = REMIND_TIME_UNKNOWN_DISPLAY;
    }
    return String(safeTpl)
      .replace(/\{name\}/g, safeName)
      .replace(/\{time\}/g, safeTime);
  } catch {
    try {
      const n = typeof name === "string" && name.trim() !== "" ? name.trim() : "キャスト";
      return `${n}さん、本日は ${REMIND_TIME_UNKNOWN_DISPLAY} 出勤予定です。出勤確認をお願いいたします。`;
    } catch {
      return "出勤確認をお願いいたします。";
    }
  }
}

/** Flex ヘッダー用。空なら「店舗」 */
export function formatFlexHeaderStoreName(storeName: string | null | undefined): string {
  const s = String(storeName ?? "").trim();
  return s.length > 0 ? s : "店舗";
}

/** 半休・公休ボタンの有無（店舗の system_settings）。同伴ボタンは LINE Flex 上は常に表示 */
export type AttendanceRemindFlexOptions = {
  enablePublicHoliday?: boolean;
  enableHalfHoliday?: boolean;
};

/** ブランド・ボタン配色（夜の店舗向け：マゼンタ／アンバー／グレー） */
const COLOR_BRAND_MAGENTA = "#AD1457";
const COLOR_NAVY = "#1A237E";
const COLOR_ATTEND_PRIMARY = "#C2185B";
/** 「同伴」と「出勤」の色を分ける（パープル系） */
const COLOR_DOHAN_BTN = "#9C27B0";
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

/** 横並びでセルを均等割り（2列グリッド用） */
function flexGridBtn(
  label: string,
  data: string,
  displayText: string,
  color: string
): object {
  return {
    type: "button",
    style: "primary" as const,
    color,
    height: "sm" as const,
    flex: 1,
    action: {
      type: "postback" as const,
      label,
      data,
      displayText,
    },
  };
}

function flexGridMutedBtn(label: string, data: string, displayText: string): object {
  return flexGridBtn(label, data, displayText, COLOR_MUTED_GRAY_BTN);
}

/** 出勤確認フッター: 横2列 × 最大3行（半休・公休のみ店舗設定で非表示可）。同伴は常に表示 */
function buildFooterButtonRows(flexOptions?: AttendanceRemindFlexOptions): object[] {
  const showHalf = flexOptions?.enableHalfHoliday === true;
  const showPublic = flexOptions?.enablePublicHoliday === true;

  const filler = (): object => ({ type: "filler" });

  const row2col = (left: object, right: object): object => ({
    type: "box",
    layout: "horizontal" as const,
    spacing: "sm" as const,
    contents: [left, right],
  });

  const rows: object[] = [];

  // 1行目: 出勤 / 同伴（管理画面の stores.is_dohan_sabaki_enabled 等に関わらず常に表示）
  rows.push(
    row2col(
      flexGridBtn("出勤", "attending", "出勤", COLOR_ATTEND_PRIMARY),
      flexGridBtn("同伴", "dohan", "同伴", COLOR_DOHAN_BTN)
    )
  );

  // 2行目: 遅刻 / お休み（欠勤）
  rows.push(
    row2col(
      flexGridBtn("遅刻", "late", "遅刻", COLOR_LATE_ORANGE),
      flexGridMutedBtn("欠勤", "absent", "欠勤")
    )
  );

  // 3行目: 半休 / 公休（どちらも無ければ行ごと省略）
  if (showHalf || showPublic) {
    rows.push(
      row2col(
        showHalf ? flexGridMutedBtn("半休", "half_holiday", "半休") : filler(),
        showPublic ? flexGridMutedBtn("公休", "public_holiday", "公休") : filler()
      )
    );
  }

  return rows;
}

/** 捌き出勤専用フッター: Datetimepicker と「まだ未定」のみ（出勤／遅刻等は含めない） */
function buildSabakiOnlyFooterContents(): object[] {
  return [
    {
      type: "box",
      layout: "horizontal" as const,
      spacing: "sm" as const,
      contents: [
        {
          type: "button",
          style: "primary" as const,
          color: COLOR_SABAKI_TIME_BTN,
          height: "sm" as const,
          flex: 1,
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
          height: "sm" as const,
          flex: 1,
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
  const timeDisplay =
    String(input.scheduledTimeDisplay ?? "").trim() || REMIND_TIME_UNKNOWN_DISPLAY;
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
      margin: "md" as const,
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
      margin: "sm" as const,
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
    margin: "md" as const,
  });

  const altBase = `${input.castName}さん ${input.scheduledTimeDisplay} ${input.todayJst} 出勤確認`;
  const altText =
    altBase.length > 380 ? `${altBase.slice(0, 377)}…` : `${altBase}\n下のボタンから選択してください。`;

  const footerContents: object[] =
    input.showSabakiTimePicker === true
      ? buildSabakiOnlyFooterContents()
      : buildFooterButtonRows(input.flexOptions);

  return {
    type: "flex",
    altText,
    contents: {
      type: "bubble",
      size: "kilo" as const,
      header: {
        type: "box",
        layout: "vertical" as const,
        paddingAll: "12px",
        paddingBottom: "10px",
        backgroundColor: COLOR_HEADER_BG,
        contents: [
          {
            type: "text",
            text: headerMain,
            color: headerColor,
            size: "lg" as const,
            weight: "bold" as const,
            wrap: true,
          },
          {
            type: "text",
            text: "出勤確認",
            color: COLOR_MUTED_TEXT,
            size: "xs" as const,
            margin: "xs" as const,
          },
        ],
      },
      body: {
        type: "box",
        layout: "vertical" as const,
        paddingTop: "12px",
        paddingBottom: "14px",
        paddingStart: "10px",
        paddingEnd: "10px",
        spacing: "sm" as const,
        contents: bodyContents,
      },
      footer: {
        type: "box",
        layout: "vertical" as const,
        paddingAll: "10px",
        paddingTop: "8px",
        spacing: "sm" as const,
        contents: footerContents,
      },
    },
  };
}
