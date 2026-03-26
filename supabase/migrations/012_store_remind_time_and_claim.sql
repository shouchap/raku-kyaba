-- 店舗ごとのリマインド送信時刻・送信済み日付（SaaS）
-- 二重送信防止: claim_reminder_schedule_send / restore_reminder_schedule_last_reminded_at

ALTER TABLE stores
  ADD COLUMN IF NOT EXISTS remind_time VARCHAR(5) NOT NULL DEFAULT '07:00',
  ADD COLUMN IF NOT EXISTS last_reminded_date DATE NULL;

COMMENT ON COLUMN stores.remind_time IS 'リマインド送信時刻（JST）HH:00 形式、1時間刻み';
COMMENT ON COLUMN stores.last_reminded_date IS '最後に日次リマインドバッチを完了した日（JSTの暦日 YYYY-MM-DD）';

ALTER TABLE stores
  DROP CONSTRAINT IF EXISTS stores_remind_time_hourly_chk;

ALTER TABLE stores
  ADD CONSTRAINT stores_remind_time_hourly_chk
  CHECK (remind_time ~ '^([01][0-9]|2[0-3]):00$');

-- 送信直前に呼び出し: まだ本日分を送っていなければ last_reminded_at を現在時刻に更新し claimed=true
CREATE OR REPLACE FUNCTION public.claim_reminder_schedule_send(
  p_schedule_id uuid,
  p_today date
)
RETURNS TABLE(claimed boolean, prior_last_reminded_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_prior timestamptz;
  v_n int;
BEGIN
  SELECT s.last_reminded_at INTO v_prior
  FROM attendance_schedules s
  WHERE s.id = p_schedule_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, NULL::timestamptz;
    RETURN;
  END IF;

  UPDATE attendance_schedules s
  SET last_reminded_at = now()
  WHERE s.id = p_schedule_id
    AND (
      s.last_reminded_at IS NULL
      OR (date(timezone('Asia/Tokyo', s.last_reminded_at)) <> p_today)
    );

  GET DIAGNOSTICS v_n = ROW_COUNT;

  IF v_n > 0 THEN
    RETURN QUERY SELECT true, v_prior;
  ELSE
    RETURN QUERY SELECT false, v_prior;
  END IF;
END;
$$;

COMMENT ON FUNCTION public.claim_reminder_schedule_send IS 'リマインド送信枠を原子的に確保。失敗時は restore_reminder_schedule_last_reminded_at で巻き戻し';

CREATE OR REPLACE FUNCTION public.restore_reminder_schedule_last_reminded_at(
  p_schedule_id uuid,
  p_prior_last_reminded_at timestamptz
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE attendance_schedules
  SET last_reminded_at = p_prior_last_reminded_at
  WHERE id = p_schedule_id;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_reminder_schedule_send(uuid, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.restore_reminder_schedule_last_reminded_at(uuid, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_reminder_schedule_send(uuid, date) TO service_role;
GRANT EXECUTE ON FUNCTION public.restore_reminder_schedule_last_reminded_at(uuid, timestamptz) TO service_role;
