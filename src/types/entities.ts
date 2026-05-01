/**
 * アプリ共通の店舗・キャスト型（UI・API で共有）
 */

/** 店舗業態（stores.business_type）。Webhook / Cron で早期分岐に利用。bar = BAR、welfare_b = 福祉施設（B型等） */
export type StoreBusinessType = "cabaret" | "welfare_b" | "bar";

export type CastEmploymentType = "admin" | "regular" | "part_time" | "employee";

export type Cast = {
  id: string;
  name: string;
  store_id: string;
  line_user_id?: string;
  is_active?: boolean;
  is_admin?: boolean;
  employment_type?: CastEmploymentType;
  is_guide_target?: boolean;
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
  /** 案内数ヒアリング通知を受ける担当キャストID */
  guide_hearing_reporter_id?: string | null;
  /** 案内数ヒアリングの入力対象スタッフ名配列 */
  guide_staff_names?: string[];
};

/** LINE 案内数ヒアリングで記録された日次実績（`daily_guide_results`） */
export type DailyGuideResult = {
  id: string;
  store_id: string;
  staff_name: string;
  /** YYYY-MM-DD（営業日） */
  target_date: string;
  sek_guide_count: number;
  sek_people_count: number;
  gold_guide_count: number;
  gold_people_count: number;
  /** セク + GOLD の合計組数 */
  guide_count: number;
  /** セク + GOLD の合計人数 */
  people_count: number | null;
  responded_at: string;
};
