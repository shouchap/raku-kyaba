-- 定休日（曜日インデックス 0=日〜6=土）、キャストの勤務形態、レギュラー向けリマインド二重送信防止

ALTER TABLE stores
  ADD COLUMN IF NOT EXISTS regular_holidays integer[] NOT NULL DEFAULT '{}'::integer[];

COMMENT ON COLUMN stores.regular_holidays IS '定休日。曜日インデックス 0=日曜〜6=土曜の配列';

ALTER TABLE casts
  ADD COLUMN IF NOT EXISTS employment_type text;

ALTER TABLE casts
  DROP CONSTRAINT IF EXISTS casts_employment_type_chk;

ALTER TABLE casts
  ADD CONSTRAINT casts_employment_type_chk
  CHECK (employment_type IS NULL OR employment_type IN ('admin', 'regular', 'part_time'));

COMMENT ON COLUMN casts.employment_type IS '勤務形態: admin=管理者（リマインド対象外）, regular=レギュラー, part_time=バイト';

ALTER TABLE casts
  ADD COLUMN IF NOT EXISTS last_reminder_sent_date date NULL;

COMMENT ON COLUMN casts.last_reminder_sent_date IS '出勤リマインド（シフトなしレギュラー枠）を最後に送った JST 暦日';

CREATE INDEX IF NOT EXISTS idx_casts_store_employment ON casts(store_id, employment_type);

-- シフト行がないレギュラー向けリマインドの送信枠確保（/api/remind）
CREATE OR REPLACE FUNCTION public.claim_reminder_cast_send(
  p_cast_id uuid,
  p_today date
)
RETURNS TABLE(claimed boolean, prior_last_reminder_sent_date date)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_prior date;
  v_n int;
BEGIN
  SELECT c.last_reminder_sent_date INTO v_prior
  FROM casts c
  WHERE c.id = p_cast_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, NULL::date;
    RETURN;
  END IF;

  UPDATE casts c
  SET last_reminder_sent_date = p_today
  WHERE c.id = p_cast_id
    AND (
      c.last_reminder_sent_date IS NULL
      OR c.last_reminder_sent_date <> p_today
    );

  GET DIAGNOSTICS v_n = ROW_COUNT;

  IF v_n > 0 THEN
    RETURN QUERY SELECT true, v_prior;
  ELSE
    RETURN QUERY SELECT false, v_prior;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.restore_reminder_cast_last_reminder_sent_date(
  p_cast_id uuid,
  p_prior date
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE casts
  SET last_reminder_sent_date = p_prior
  WHERE id = p_cast_id;
END;
$$;

COMMENT ON FUNCTION public.claim_reminder_cast_send IS 'シフトなしレギュラー向けリマインドの二重送信防止';

REVOKE ALL ON FUNCTION public.claim_reminder_cast_send(uuid, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.restore_reminder_cast_last_reminder_sent_date(uuid, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_reminder_cast_send(uuid, date) TO service_role;
GRANT EXECUTE ON FUNCTION public.restore_reminder_cast_last_reminder_sent_date(uuid, date) TO service_role;
