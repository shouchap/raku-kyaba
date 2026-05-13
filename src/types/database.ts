/**
 * Supabase 自動生成型のプレースホルダー
 * 実際の開発では `supabase gen types typescript` で生成を推奨
 */
import type { StoreBusinessType } from "./entities";

export type Json = string | number | boolean | null | { [key: string]: Json } | Json[];

export type AttendanceStatus =
  | "attending"
  | "absent"
  | "late"
  | "public_holiday"
  | "half_holiday";

/** attendance_schedules の参照で使う簡易型 */
export type AttendanceScheduleRow = {
  id: string;
  store_id: string;
  cast_id: string;
  scheduled_date: string;
  scheduled_time: string | null;
  scheduled_end_time: string | null;
};

export interface Database {
  public: {
    Tables: {
      stores: {
        Row: {
          id: string;
          name: string;
          /** 業態: cabaret / welfare_b / bar（022・028） */
          business_type: StoreBusinessType;
          /** BAR: 来客フローで組ごとのお客様名を聞く（028） */
          ask_guest_name: boolean;
          /** BAR: 来客フローで来店時間を聞く（028） */
          ask_guest_time: boolean;
          /** 出勤確認フロー種別（default / bar_extended） */
          attendance_flow_type: string;
          line_channel_id: string | null;
          line_channel_secret: string;
          line_channel_access_token: string | null;
          line_bot_user_id: string | null;
          line_group_id: string | null;
          admin_line_user_id: string | null;
          /** JST リマインド送信時刻 HH:00 */
          remind_time: string;
          /** 最後に日次リマインドを完了した日（JST YYYY-MM-DD） */
          last_reminded_date: string | null;
          /** キャストからのシフト提出を受け付けるか */
          allow_shift_submission: boolean;
          /** 営業前サマリー送信の JST 時（0–23）。NULL 時は環境変数 */
          pre_open_report_hour_jst: number | null;
          /** 最後に営業前サマリーを送信した JST 暦日 */
          last_pre_open_report_date: string | null;
          /** 出勤回答後に予約（客予定）をヒアリングするか */
          enable_reservation_check: boolean;
          /** 定休日（0=日曜〜6=土曜の曜日インデックス） */
          regular_holidays: number[];
          /** レギュラー向けリマインド本文（「○○さん、」の後） */
          regular_remind_message: string;
          /** レギュラー勤務のデフォルト出勤時刻（週間シフト一括入力用）。NULL 可 */
          regular_start_time: string | null;
          /** B型: 朝の点呼 Flex 本文（NULL でデフォルト） */
          welfare_message_morning: string | null;
          welfare_message_midday: string | null;
          welfare_message_evening: string | null;
          /** B型: LINE follow 時のウェルカム（NULL で既定） */
          welfare_message_welcome: string | null;
          /** B型: 作業項目（カンマ区切り）。NULL で Flex は既定 */
          welfare_work_items: string | null;
          /** 案内数ヒアリング送信を有効にするか */
          guide_hearing_enabled: boolean;
          /** 案内ヒアリング自動送信時刻（DB time、053）。アプリでは JST 整時として解釈 */
          guidance_request_time: string | null;
          /** 案内数ヒアリング送信時刻（HH:00, JST・レガシー／053 と併用） */
          guide_hearing_time: string | null;
          /** 最終ヒアリング送信営業日（JST DATE） */
          last_guide_hearing_sent_date: string | null;
          /** 案内数ヒアリング通知を受ける担当キャストID */
          guide_hearing_reporter_id: string | null;
          /** 案内数入力対象スタッフ名（文字列） */
          guide_staff_names: string[];
          /** 案内数ヒアリング・案内数レポートを店舗で利用するか（043） */
          is_guide_enabled: boolean;
          /** 同伴・捌き管理機能を店舗で利用するか（044） */
          is_dohan_sabaki_enabled: boolean;
          /** 店舗ごとの画面表示用語（出勤/キャスト など） */
          custom_terms: Json;
          /** 管理画面メニューの表示名 / 表示・非表示設定（JSONB） */
          menu_settings: Json;
          /** 週間レポート自動送信（LINEテキスト）を有効にするか（049） */
          weekly_report_enabled: boolean;
          /** 送信曜日（JST）0=日〜6=土（049） */
          weekly_report_day: number;
          /** 送信時刻 JST HH:mm（049） */
          weekly_report_time: string;
          /** 最後に週間レポートを自動送信した JST 暦日（049・冪等性） */
          last_weekly_report_sent_date: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<
          Database["public"]["Tables"]["stores"]["Row"],
          | "id"
          | "created_at"
          | "updated_at"
          | "business_type"
          | "remind_time"
          | "last_reminded_date"
          | "allow_shift_submission"
          | "pre_open_report_hour_jst"
          | "last_pre_open_report_date"
          | "enable_reservation_check"
          | "regular_holidays"
          | "regular_remind_message"
          | "regular_start_time"
          | "welfare_message_morning"
          | "welfare_message_midday"
          | "welfare_message_evening"
          | "welfare_message_welcome"
          | "welfare_work_items"
          | "guide_hearing_enabled"
          | "guidance_request_time"
          | "guide_hearing_time"
          | "last_guide_hearing_sent_date"
          | "guide_hearing_reporter_id"
          | "guide_staff_names"
          | "is_guide_enabled"
          | "is_dohan_sabaki_enabled"
          | "custom_terms"
          | "menu_settings"
          | "weekly_report_enabled"
          | "weekly_report_day"
          | "weekly_report_time"
          | "last_weekly_report_sent_date"
          | "ask_guest_name"
          | "ask_guest_time"
          | "attendance_flow_type"
          | "line_group_id"
        > & {
          id?: string;
          created_at?: string;
          updated_at?: string;
          business_type?: StoreBusinessType;
          remind_time?: string;
          last_reminded_date?: string | null;
          allow_shift_submission?: boolean;
          pre_open_report_hour_jst?: number | null;
          last_pre_open_report_date?: string | null;
          enable_reservation_check?: boolean;
          regular_holidays?: number[];
          regular_remind_message?: string;
          regular_start_time?: string | null;
          welfare_message_morning?: string | null;
          welfare_message_midday?: string | null;
          welfare_message_evening?: string | null;
          welfare_message_welcome?: string | null;
          welfare_work_items?: string | null;
          guide_hearing_enabled?: boolean;
          guidance_request_time?: string | null;
          guide_hearing_time?: string | null;
          last_guide_hearing_sent_date?: string | null;
          guide_hearing_reporter_id?: string | null;
          guide_staff_names?: string[];
          is_guide_enabled?: boolean;
          is_dohan_sabaki_enabled?: boolean;
          custom_terms?: Json;
          menu_settings?: Json;
          weekly_report_enabled?: boolean;
          weekly_report_day?: number;
          weekly_report_time?: string;
          last_weekly_report_sent_date?: string | null;
          ask_guest_name?: boolean;
          ask_guest_time?: boolean;
          attendance_flow_type?: string;
          line_group_id?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["stores"]["Insert"]>;
      };
      staffs: {
        Row: {
          id: string;
          store_id: string;
          name: string;
          line_user_id: string | null;
          is_guide_target: boolean;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<
          Database["public"]["Tables"]["staffs"]["Row"],
          "id" | "created_at" | "updated_at"
        > & {
          id?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["staffs"]["Insert"]>;
      };
      daily_guide_results: {
        Row: {
          id: string;
          store_id: string;
          staff_name: string;
          target_date: string;
          sek_guide_count: number;
          sek_people_count: number;
          gold_guide_count: number;
          gold_people_count: number;
          guide_count: number;
          people_count: number | null;
          responded_at: string;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<
          Database["public"]["Tables"]["daily_guide_results"]["Row"],
          "id" | "created_at" | "updated_at"
        > & {
          id?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["daily_guide_results"]["Insert"]>;
      };
      casts: {
        Row: {
          id: string;
          store_id: string;
          name: string;
          line_user_id: string | null;
          /** 表示名（源氏名等）。NULL の場合は name を表示 */
          display_name: string | null;
          /** 役職: cast=キャスト / nakai=仲居 */
          role: "cast" | "nakai";
          is_active: boolean;
          is_admin: boolean;
          /** 勤務形態: admin / regular / part_time（NULL はバイト扱い） */
          employment_type: "admin" | "regular" | "part_time" | "employee" | null;
          /** 案内数ヒアリング対象（営業終了時LINE送信） */
          is_guide_target: boolean;
          /** シフトなしレギュラー向けリマインドの最終送信日（JST） */
          last_reminder_sent_date: string | null;
          /** 福祉: かかりつけ病院（通院報告のクイックリプライ・複数可） */
          default_hospital_names: string[];
          /** 退店日（キャバクラ・BAR・風俗）。NULL のとき未退店 */
          departed_at: string | null;
          departure_reason: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<
          Database["public"]["Tables"]["casts"]["Row"],
          | "id"
          | "created_at"
          | "updated_at"
          | "default_hospital_names"
          | "is_guide_target"
          | "display_name"
          | "role"
          | "departed_at"
          | "departure_reason"
        > & {
          id?: string;
          is_active?: boolean;
          is_guide_target?: boolean;
          /** 省略時は DB 既定で {} */
          default_hospital_names?: string[];
          display_name?: string | null;
          role?: "cast" | "nakai";
          departed_at?: string | null;
          departure_reason?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["casts"]["Insert"]>;
      };
      attendance_logs: {
        Row: {
          id: string;
          store_id: string;
          cast_id: string;
          attendance_schedule_id: string | null;
          attended_date: string;
          status: AttendanceStatus;
          /** 回答時点のシフトが捌き出勤だったスナップショット */
          is_sabaki: boolean;
          public_holiday_reason: string | null;
          half_holiday_reason: string | null;
          has_reservation: boolean | null;
          reservation_details: string | null;
          planned_groups: number | null;
          tentative_groups: number | null;
          action_type: string | null;
          action_detail: string | null;
          responded_at: string;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<
          Database["public"]["Tables"]["attendance_logs"]["Row"],
          "id" | "created_at" | "updated_at"
        > & {
          id?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["attendance_logs"]["Insert"]>;
      };
      attendance_edit_histories: {
        Row: {
          id: string;
          subject_attendance_log_id: string;
          attendance_log_id: string | null;
          edited_by_admin_id: string;
          action_type: "UPDATE" | "DELETE" | "INSERT";
          old_data: Json;
          new_data: Json | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          subject_attendance_log_id: string;
          attendance_log_id?: string | null;
          edited_by_admin_id: string;
          action_type: "UPDATE" | "DELETE" | "INSERT";
          old_data: Json;
          new_data?: Json | null;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["attendance_edit_histories"]["Insert"]>;
      };
      welfare_daily_logs: {
        Row: {
          id: string;
          store_id: string;
          cast_id: string;
          work_date: string;
          started_at: string | null;
          ended_at: string | null;
          health_status: "good" | "soso" | "bad" | "contact" | null;
          health_reason: string | null;
          work_item: string | null;
          work_details: string | null;
          quantity: number | null;
          health_notes: string | null;
          is_hospital_visit: boolean;
          hospital_name: string | null;
          symptoms: string | null;
          visit_duration: string | null;
          pending_line_flow:
            | "welfare_health_reason"
            | "welfare_work_item"
            | "welfare_end_choice"
            | "welfare_hospital_name"
            | "welfare_hospital_symptoms"
            | "welfare_hospital_duration"
            | "welfare_hospital_duration_start_input"
            | "welfare_hospital_duration_end_input"
            | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          store_id: string;
          cast_id: string;
          work_date: string;
          started_at?: string | null;
          ended_at?: string | null;
          health_status?: "good" | "soso" | "bad" | "contact" | null;
          health_reason?: string | null;
          work_item?: string | null;
          work_details?: string | null;
          quantity?: number | null;
          health_notes?: string | null;
          is_hospital_visit?: boolean;
          hospital_name?: string | null;
          symptoms?: string | null;
          visit_duration?: string | null;
          pending_line_flow?:
            | "welfare_health_reason"
            | "welfare_work_item"
            | "welfare_end_choice"
            | "welfare_hospital_name"
            | "welfare_hospital_symptoms"
            | "welfare_hospital_duration"
            | "welfare_hospital_duration_start_input"
            | "welfare_hospital_duration_end_input"
            | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["welfare_daily_logs"]["Insert"]>;
      };
      special_shift_events: {
        Row: {
          id: string;
          store_id: string;
          title: string;
          start_date: string;
          end_date: string;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<
          Database["public"]["Tables"]["special_shift_events"]["Row"],
          "id" | "created_at" | "updated_at"
        > & {
          id?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["special_shift_events"]["Insert"]>;
      };
      special_shift_entries: {
        Row: {
          id: string;
          event_id: string;
          cast_id: string;
          available_dates: Json;
          updated_at: string;
        };
        Insert: Omit<
          Database["public"]["Tables"]["special_shift_entries"]["Row"],
          "id" | "updated_at"
        > & {
          id?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["special_shift_entries"]["Insert"]>;
      };
    };
  };
}
