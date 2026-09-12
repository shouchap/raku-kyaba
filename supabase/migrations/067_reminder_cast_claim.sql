-- 018 相当が schema_migrations 上は適用済みでも本番に無い場合があるため冪等に再作成する。
-- アプリ呼び出し: claim_reminder_cast_send(p_cast_id, p_today)
--               restore_reminder_cast_last_reminder_sent_date(p_cast_id, p_prior)

ALTER TABLE public.casts
  ADD COLUMN IF NOT EXISTS last_reminder_sent_date date NULL;

COMMENT ON COLUMN public.casts.last_reminder_sent_date IS
  '出勤リマインド（シフトなしレギュラー枠）を最後に送った JST 暦日';

CREATE OR REPLACE FUNCTION public.claim_reminder_cast_send(
  p_cast_id uuid,
  p_today date
)
RETURNS TABLE(claimed boolean, prior_last_reminder_sent_date date)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
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
SET search_path TO 'public'
AS $$
BEGIN
  UPDATE casts
  SET last_reminder_sent_date = p_prior
  WHERE id = p_cast_id;
END;
$$;

COMMENT ON FUNCTION public.claim_reminder_cast_send(uuid, date) IS
  'シフトなしレギュラー向けリマインドの二重送信防止（067 で冪等再作成）';

REVOKE ALL ON FUNCTION public.claim_reminder_cast_send(uuid, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.restore_reminder_cast_last_reminder_sent_date(uuid, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_reminder_cast_send(uuid, date) TO service_role;
GRANT EXECUTE ON FUNCTION public.restore_reminder_cast_last_reminder_sent_date(uuid, date) TO service_role;
