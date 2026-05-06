-- 店舗単位の勤怠監査ログ一覧（attendance_edit_histories に store_id 列が無いため JSON スナップショットで絞り込み）

CREATE OR REPLACE FUNCTION public.fetch_store_attendance_edit_histories(
  p_store_id uuid,
  p_limit int DEFAULT 50
)
RETURNS TABLE (
  id uuid,
  subject_attendance_log_id uuid,
  attendance_log_id uuid,
  edited_by_admin_id uuid,
  action_type varchar,
  old_data jsonb,
  new_data jsonb,
  created_at timestamptz
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    h.id,
    h.subject_attendance_log_id,
    h.attendance_log_id,
    h.edited_by_admin_id,
    h.action_type,
    h.old_data,
    h.new_data,
    h.created_at
  FROM public.attendance_edit_histories h
  WHERE COALESCE(h.new_data->>'store_id', h.old_data->>'store_id') = p_store_id::text
  ORDER BY h.created_at DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200);
$$;

COMMENT ON FUNCTION public.fetch_store_attendance_edit_histories(uuid, int) IS
  '店舗に紐づく attendance_edit_histories を created_at 降順で取得（old_data/new_data の store_id でフィルタ）。';

REVOKE ALL ON FUNCTION public.fetch_store_attendance_edit_histories(uuid, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fetch_store_attendance_edit_histories(uuid, int) TO service_role;
