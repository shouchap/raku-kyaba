/**
 * Supabase 自動生成型のプレースホルダー
 * 実際の開発では `supabase gen types typescript` で生成を推奨
 */
export type Json = string | number | boolean | null | { [key: string]: Json } | Json[];

export type AttendanceStatus =
  | "attending"
  | "absent"
  | "late"
  | "public_holiday"
  | "half_holiday";

export interface Database {
  public: {
    Tables: {
      stores: {
        Row: {
          id: string;
          name: string;
          line_channel_id: string | null;
          line_channel_secret: string;
          line_channel_access_token: string | null;
          line_bot_user_id: string | null;
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
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<
          Database["public"]["Tables"]["stores"]["Row"],
          | "id"
          | "created_at"
          | "updated_at"
          | "remind_time"
          | "last_reminded_date"
          | "allow_shift_submission"
          | "pre_open_report_hour_jst"
          | "last_pre_open_report_date"
          | "enable_reservation_check"
          | "regular_holidays"
          | "regular_remind_message"
        > & {
          id?: string;
          created_at?: string;
          updated_at?: string;
          remind_time?: string;
          last_reminded_date?: string | null;
          allow_shift_submission?: boolean;
          pre_open_report_hour_jst?: number | null;
          last_pre_open_report_date?: string | null;
          enable_reservation_check?: boolean;
          regular_holidays?: number[];
          regular_remind_message?: string;
        };
        Update: Partial<Database["public"]["Tables"]["stores"]["Insert"]>;
      };
      casts: {
        Row: {
          id: string;
          store_id: string;
          name: string;
          line_user_id: string;
          is_active: boolean;
          is_admin: boolean;
          /** 勤務形態: admin / regular / part_time（NULL はバイト扱い） */
          employment_type: "admin" | "regular" | "part_time" | null;
          /** シフトなしレギュラー向けリマインドの最終送信日（JST） */
          last_reminder_sent_date: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<Database["public"]["Tables"]["casts"]["Row"], "id" | "created_at" | "updated_at"> & {
          id?: string;
          is_active?: boolean;
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
          public_holiday_reason: string | null;
          half_holiday_reason: string | null;
          has_reservation: boolean | null;
          reservation_details: string | null;
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
    };
  };
}
