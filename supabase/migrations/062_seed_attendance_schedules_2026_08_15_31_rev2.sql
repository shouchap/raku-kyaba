-- supabase/seeds/attendance_schedules_2026_08_15_31_rev2.sql から自動生成（npm run db:seed-to-migration）
-- push すると GitHub Actions が本番へ適用します。
-- 松島 黄金 向けシフト改訂（2026-08-15 〜 2026-08-31）
-- 改訂版シフト表を正とし、期間内の既存行は表に無いものを削除する。
--
-- 前提:
--   - store_id: stores.name = '松島 黄金'
--   - cast_id: 同一店舗の casts.name / casts.display_name 完全一致
--   - 退勤 24:00 は DB 上 24:00:00（アプリと同じ正規化）
--   - NOT NULL の Boolean 列はすべて false
--   - 「×」と空欄はシフトなしとして除外
--
-- 主な差分（前回 seed 059 比）:
--   - 8/23 ゆめ 13-22 を追加
--   - 8/25 るみ 12- を追加 / みか 15- → 12-
--   - 8/26 まる削除 / るみ 12- 追加 / 森田 10- → 12-


DO $$
DECLARE
  target_store_id uuid;
  missing_names text;
BEGIN
  SELECT id INTO target_store_id
  FROM public.stores
  WHERE name = '松島 黄金'
  LIMIT 1;

  IF target_store_id IS NULL THEN
    RAISE EXCEPTION '店舗「松島 黄金」が stores テーブルに見つかりません';
  END IF;

  WITH required_casts AS (
    SELECT unnest(ARRAY[
      'まる', 'るみ', 'ねむ', 'ななみ', 'のあ', 'ゆめ', '森田', 'みか', '玉川'
    ]) AS cast_name
  ),
  unresolved AS (
    SELECT rc.cast_name
    FROM required_casts rc
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.casts c
      WHERE c.store_id = target_store_id
        AND c.is_active = true
        AND (c.name = rc.cast_name OR c.display_name = rc.cast_name)
    )
  )
  SELECT string_agg(cast_name, ', ' ORDER BY cast_name)
  INTO missing_names
  FROM unresolved;

  IF missing_names IS NOT NULL THEN
    RAISE EXCEPTION '店舗「松島 黄金」の casts に見つからない名前: %', missing_names;
  END IF;
END $$;

WITH target_store AS (
  SELECT id AS store_id
  FROM public.stores
  WHERE name = '松島 黄金'
  LIMIT 1
),
shift_rows AS (
  SELECT *
  FROM (
    VALUES
      -- 8/15（土）
      ('2026-08-15'::date, 'まる',   '10:00:00'::time, '24:00:00'::time),
      ('2026-08-15'::date, 'ねむ',   '17:00:00'::time, '24:00:00'::time),
      ('2026-08-15'::date, 'のあ',   '17:00:00'::time, '24:00:00'::time),
      ('2026-08-15'::date, 'みか',   '10:00:00'::time, '24:00:00'::time),
      -- 8/16（日）
      ('2026-08-16'::date, 'まる',   '10:00:00'::time, '24:00:00'::time),
      ('2026-08-16'::date, 'のあ',   '16:00:00'::time, '24:00:00'::time),
      ('2026-08-16'::date, 'ゆめ',   '13:00:00'::time, '18:00:00'::time),
      ('2026-08-16'::date, '森田',   '10:00:00'::time, '24:00:00'::time),
      -- 8/17（月）まる×
      ('2026-08-17'::date, 'ねむ',   '12:00:00'::time, '24:00:00'::time),
      ('2026-08-17'::date, 'のあ',   '16:00:00'::time, '24:00:00'::time),
      ('2026-08-17'::date, '森田',   '12:00:00'::time, '24:00:00'::time),
      -- 8/18（火）まる×
      ('2026-08-18'::date, 'ねむ',   '12:00:00'::time, '24:00:00'::time),
      ('2026-08-18'::date, 'ななみ', '14:00:00'::time, '24:00:00'::time),
      ('2026-08-18'::date, '玉川',   '12:00:00'::time, '24:00:00'::time),
      -- 8/19（水）まる×
      ('2026-08-19'::date, 'ねむ',   '12:00:00'::time, '24:00:00'::time),
      ('2026-08-19'::date, 'のあ',   '16:00:00'::time, '24:00:00'::time),
      ('2026-08-19'::date, '森田',   '12:00:00'::time, '24:00:00'::time),
      -- 8/20（木）まる× ねむ×
      ('2026-08-20'::date, 'のあ',   '16:00:00'::time, '24:00:00'::time),
      ('2026-08-20'::date, 'ゆめ',   '15:00:00'::time, '24:00:00'::time),
      ('2026-08-20'::date, 'みか',   '15:00:00'::time, '24:00:00'::time),
      -- 8/21（金）まる× ねむ×
      ('2026-08-21'::date, 'るみ',   '10:00:00'::time, '17:00:00'::time),
      ('2026-08-21'::date, 'ななみ', '14:00:00'::time, '21:00:00'::time),
      ('2026-08-21'::date, '森田',   '10:00:00'::time, '24:00:00'::time),
      -- 8/22（土）まる×
      ('2026-08-22'::date, 'るみ',   '12:00:00'::time, '24:00:00'::time),
      ('2026-08-22'::date, 'ねむ',   '17:00:00'::time, '24:00:00'::time),
      ('2026-08-22'::date, 'のあ',   '16:00:00'::time, '24:00:00'::time),
      ('2026-08-22'::date, 'みか',   '12:00:00'::time, '24:00:00'::time),
      -- 8/23（日）まる×
      ('2026-08-23'::date, 'ねむ',   '12:00:00'::time, '24:00:00'::time),
      ('2026-08-23'::date, 'のあ',   '16:00:00'::time, '24:00:00'::time),
      ('2026-08-23'::date, 'ゆめ',   '13:00:00'::time, '22:00:00'::time),
      ('2026-08-23'::date, '森田',   '12:00:00'::time, '24:00:00'::time),
      -- 8/24（月）まる× ねむ×
      ('2026-08-24'::date, 'るみ',   '10:00:00'::time, '17:00:00'::time),
      ('2026-08-24'::date, 'のあ',   '16:00:00'::time, '24:00:00'::time),
      ('2026-08-24'::date, '森田',   '10:00:00'::time, '24:00:00'::time),
      -- 8/25（火）まる× ねむ×
      ('2026-08-25'::date, 'るみ',   '12:00:00'::time, '24:00:00'::time),
      ('2026-08-25'::date, 'ななみ', '15:00:00'::time, '24:00:00'::time),
      ('2026-08-25'::date, 'みか',   '12:00:00'::time, '24:00:00'::time),
      -- 8/26（水）ねむ×（まるなし）
      ('2026-08-26'::date, 'るみ',   '12:00:00'::time, '24:00:00'::time),
      ('2026-08-26'::date, '森田',   '12:00:00'::time, '24:00:00'::time),
      -- 8/27（木）ねむ×
      ('2026-08-27'::date, 'まる',   '16:00:00'::time, '24:00:00'::time),
      ('2026-08-27'::date, 'のあ',   '16:00:00'::time, '24:00:00'::time),
      ('2026-08-27'::date, 'みか',   '16:00:00'::time, '24:00:00'::time),
      -- 8/28（金）
      ('2026-08-28'::date, 'るみ',   '10:00:00'::time, '17:00:00'::time),
      ('2026-08-28'::date, 'ねむ',   '12:00:00'::time, '24:00:00'::time),
      ('2026-08-28'::date, 'のあ',   '17:00:00'::time, '24:00:00'::time),
      ('2026-08-28'::date, '森田',   '10:00:00'::time, '24:00:00'::time),
      -- 8/29（土）
      ('2026-08-29'::date, 'まる',   '10:00:00'::time, '24:00:00'::time),
      ('2026-08-29'::date, 'ねむ',   '12:00:00'::time, '24:00:00'::time),
      ('2026-08-29'::date, 'のあ',   '16:00:00'::time, '24:00:00'::time),
      ('2026-08-29'::date, 'みか',   '10:00:00'::time, '24:00:00'::time),
      -- 8/30（日）
      ('2026-08-30'::date, 'まる',   '10:00:00'::time, '24:00:00'::time),
      ('2026-08-30'::date, 'ねむ',   '12:00:00'::time, '24:00:00'::time),
      ('2026-08-30'::date, 'のあ',   '16:00:00'::time, '24:00:00'::time),
      ('2026-08-30'::date, '森田',   '10:00:00'::time, '24:00:00'::time),
      -- 8/31（月）ねむ×
      ('2026-08-31'::date, 'まる',   '17:00:00'::time, '24:00:00'::time),
      ('2026-08-31'::date, '森田',   '17:00:00'::time, '24:00:00'::time)
  ) AS v(scheduled_date, cast_name, scheduled_time, scheduled_end_time)
),
resolved AS (
  SELECT
    ts.store_id,
    c.id AS cast_id,
    sr.scheduled_date,
    sr.scheduled_time,
    sr.scheduled_end_time
  FROM shift_rows sr
  CROSS JOIN target_store ts
  INNER JOIN public.casts c
    ON c.store_id = ts.store_id
   AND c.is_active = true
   AND (
     c.name = sr.cast_name
     OR c.display_name = sr.cast_name
   )
),
upserted AS (
  INSERT INTO public.attendance_schedules (
    store_id,
    cast_id,
    scheduled_date,
    scheduled_time,
    scheduled_end_time,
    is_absent,
    is_late,
    is_action_completed,
    is_dohan,
    is_sabaki,
    has_reservation
  )
  SELECT
    r.store_id,
    r.cast_id,
    r.scheduled_date,
    r.scheduled_time,
    r.scheduled_end_time,
    false,
    false,
    false,
    false,
    false,
    false
  FROM resolved r
  ON CONFLICT (store_id, cast_id, scheduled_date)
  DO UPDATE SET
    scheduled_time = EXCLUDED.scheduled_time,
    scheduled_end_time = EXCLUDED.scheduled_end_time,
    is_absent = false,
    is_late = false,
    is_action_completed = false,
    is_dohan = false,
    is_sabaki = false,
    has_reservation = false,
    updated_at = NOW()
  RETURNING id
),
deleted AS (
  DELETE FROM public.attendance_schedules s
  USING target_store ts
  WHERE s.store_id = ts.store_id
    AND s.scheduled_date BETWEEN '2026-08-15' AND '2026-08-31'
    AND NOT EXISTS (
      SELECT 1
      FROM resolved r
      WHERE r.cast_id = s.cast_id
        AND r.scheduled_date = s.scheduled_date
    )
  RETURNING s.id
)
SELECT
  (SELECT count(*) FROM upserted) AS upserted_count,
  (SELECT count(*) FROM deleted) AS deleted_count;


-- 登録結果確認（56 行になる想定）
SELECT
  s.scheduled_date,
  COALESCE(c.display_name, c.name) AS cast_name,
  s.scheduled_time,
  s.scheduled_end_time
FROM public.attendance_schedules s
INNER JOIN public.casts c ON c.id = s.cast_id
WHERE s.store_id = (
  SELECT id FROM public.stores WHERE name = '松島 黄金' LIMIT 1
)
  AND s.scheduled_date BETWEEN '2026-08-15' AND '2026-08-31'
ORDER BY s.scheduled_date, cast_name;
