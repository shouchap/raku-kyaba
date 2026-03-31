/**
 * アプリ共通の店舗・キャスト型（UI・API で共有）
 */

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
  regular_holidays?: number[];
  /** レギュラー向けリマインド本文（DB `stores.regular_remind_message`） */
  regular_remind_message?: string;
};
