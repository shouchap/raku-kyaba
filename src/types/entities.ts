/**
 * アプリ共通の店舗・キャスト型（UI・API で共有）
 */

/** 店舗業態（stores.business_type）。Webhook / Cron で早期分岐に利用。bar = BAR（サイト表記 ELINE） */
export type StoreBusinessType = "cabaret" | "welfare_b" | "bar";

export type CastEmploymentType = "admin" | "regular" | "part_time";

export type Cast = {
  id: string;
  name: string;
  store_id: string;
  line_user_id?: string;
  is_active?: boolean;
  is_admin?: boolean;
  employment_type?: CastEmploymentType;
  created_at?: string;
};

export type Store = {
  id: string;
  name: string;
  /** DB 既定は cabaret。未読込時はキャバクラ扱いに倒すなら呼び出し側で ?? 'cabaret' */
  business_type?: StoreBusinessType;
  regular_holidays?: number[];
  /** レギュラー向けリマインド本文（DB `stores.regular_remind_message`） */
  regular_remind_message?: string;
  /** レギュラー勤務のデフォルト出勤時刻（週間シフト一括用） */
  regular_start_time?: string | null;
};
