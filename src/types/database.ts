/**
 * Supabase 自動生成型のプレースホルダー
 * 実際の開発では `supabase gen types typescript` で生成を推奨
 */
export type Json = string | number | boolean | null | { [key: string]: Json } | Json[];

export type AttendanceStatus = "attending" | "absent" | "late";

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
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<
          Database["public"]["Tables"]["stores"]["Row"],
          "id" | "created_at" | "updated_at" | "remind_time" | "last_reminded_date" | "allow_shift_submission"
        > & {
          id?: string;
          created_at?: string;
          updated_at?: string;
          remind_time?: string;
          last_reminded_date?: string | null;
          allow_shift_submission?: boolean;
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
