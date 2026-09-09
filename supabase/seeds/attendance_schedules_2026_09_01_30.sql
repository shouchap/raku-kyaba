-- 松島 黄金 向けシフト登録（2026-09-01 〜 2026-09-30）
-- 後半記入＋前半改訂。.5 は 30 分（例: 18.5 → 18:30）。
--
-- 前提:
--   - store_id: stores.name = '松島 黄金'
--   - cast_id: 同一店舗の casts.name / casts.display_name 完全一致
--   - 退勤 24:00 は DB 上 24:00:00（アプリと同じ正規化）
--   - NOT NULL の Boolean 列はすべて false
--   - 「×」と空欄はシフトなしとして除外
--   - 期間内の表に無い既存行は削除（表を正とする）
--
-- 前半改訂の主な差分（前回 09_01_28 seed 比）:
--   - 9/3 玉川削除
--   - 9/10 のあ 17- / ゆめ 11-17 / 玉川 11-
--   - 9/11 のあ 14-
--   - 9/12 すず 13-24
--   - 9/13 のあ 14-

BEGIN;

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
      'まる', 'るみ', 'ねむ', 'ななみ', 'のあ', 'ゆめ', 'すず', '森田', 'みか', '玉川'
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
      -- 9/1（火）
      ('2026-09-01'::date, 'ねむ',   '12:00:00'::time, '24:00:00'::time),
      ('2026-09-01'::date, 'すず',   '17:00:00'::time, '24:00:00'::time),
      ('2026-09-01'::date, 'みか',   '10:00:00'::time, '24:00:00'::time),
      -- 9/2（水）
      ('2026-09-02'::date, 'まる',   '10:00:00'::time, '24:00:00'::time),
      ('2026-09-02'::date, 'るみ',   '10:00:00'::time, '17:00:00'::time),
      ('2026-09-02'::date, 'すず',   '17:00:00'::time, '24:00:00'::time),
      ('2026-09-02'::date, '森田',   '10:00:00'::time, '24:00:00'::time),
      -- 9/3（木）玉川なし
      ('2026-09-03'::date, 'ねむ',   '12:00:00'::time, '24:00:00'::time),
      ('2026-09-03'::date, 'のあ',   '16:00:00'::time, '24:00:00'::time),
      ('2026-09-03'::date, 'みか',   '12:00:00'::time, '24:00:00'::time),
      -- 9/4（金）
      ('2026-09-04'::date, 'のあ',   '16:00:00'::time, '24:00:00'::time),
      ('2026-09-04'::date, 'すず',   '17:00:00'::time, '24:00:00'::time),
      ('2026-09-04'::date, '森田',   '16:00:00'::time, '24:00:00'::time),
      -- 9/5（土）
      ('2026-09-05'::date, 'まる',   '10:00:00'::time, '24:00:00'::time),
      ('2026-09-05'::date, 'ねむ',   '12:00:00'::time, '24:00:00'::time),
      ('2026-09-05'::date, 'のあ',   '16:00:00'::time, '24:00:00'::time),
      ('2026-09-05'::date, 'みか',   '10:00:00'::time, '24:00:00'::time),
      -- 9/6（日）
      ('2026-09-06'::date, 'まる',   '10:00:00'::time, '24:00:00'::time),
      ('2026-09-06'::date, 'ねむ',   '11:00:00'::time, '17:00:00'::time),
      ('2026-09-06'::date, 'のあ',   '16:00:00'::time, '24:00:00'::time),
      ('2026-09-06'::date, 'ゆめ',   '17:00:00'::time, '24:00:00'::time),
      ('2026-09-06'::date, '森田',   '10:00:00'::time, '24:00:00'::time),
      -- 9/7（月）
      ('2026-09-07'::date, 'まる',   '17:00:00'::time, '24:00:00'::time),
      ('2026-09-07'::date, 'すず',   '18:30:00'::time, '23:00:00'::time),
      ('2026-09-07'::date, '森田',   '17:00:00'::time, '24:00:00'::time),
      -- 9/8（火）
      ('2026-09-08'::date, 'のあ',   '16:00:00'::time, '24:00:00'::time),
      ('2026-09-08'::date, 'すず',   '18:30:00'::time, '24:00:00'::time),
      ('2026-09-08'::date, 'みか',   '16:00:00'::time, '24:00:00'::time),
      -- 9/9（水）
      ('2026-09-09'::date, 'まる',   '10:00:00'::time, '24:00:00'::time),
      ('2026-09-09'::date, 'のあ',   '16:00:00'::time, '24:00:00'::time),
      ('2026-09-09'::date, '森田',   '10:00:00'::time, '24:00:00'::time),
      -- 9/10（木）
      ('2026-09-10'::date, 'ななみ', '15:00:00'::time, '23:00:00'::time),
      ('2026-09-10'::date, 'のあ',   '17:00:00'::time, '24:00:00'::time),
      ('2026-09-10'::date, 'ゆめ',   '11:00:00'::time, '17:00:00'::time),
      ('2026-09-10'::date, '玉川',   '11:00:00'::time, '24:00:00'::time),
      -- 9/11（金）
      ('2026-09-11'::date, 'ななみ', '16:00:00'::time, '24:00:00'::time),
      ('2026-09-11'::date, 'のあ',   '14:00:00'::time, '24:00:00'::time),
      ('2026-09-11'::date, 'すず',   '18:30:00'::time, '24:00:00'::time),
      ('2026-09-11'::date, 'みか',   '16:00:00'::time, '24:00:00'::time),
      -- 9/12（土）
      ('2026-09-12'::date, 'まる',   '10:00:00'::time, '24:00:00'::time),
      ('2026-09-12'::date, 'ねむ',   '17:00:00'::time, '24:00:00'::time),
      ('2026-09-12'::date, 'すず',   '13:00:00'::time, '24:00:00'::time),
      ('2026-09-12'::date, 'みか',   '10:00:00'::time, '24:00:00'::time),
      -- 9/13（日）
      ('2026-09-13'::date, 'まる',   '10:00:00'::time, '24:00:00'::time),
      ('2026-09-13'::date, 'のあ',   '14:00:00'::time, '24:00:00'::time),
      ('2026-09-13'::date, 'すず',   '18:30:00'::time, '24:00:00'::time),
      ('2026-09-13'::date, '森田',   '10:00:00'::time, '24:00:00'::time),
      -- 9/14（月）
      ('2026-09-14'::date, 'まる',   '17:00:00'::time, '24:00:00'::time),
      ('2026-09-14'::date, 'るみ',   '10:00:00'::time, '17:00:00'::time),
      ('2026-09-14'::date, 'ねむ',   '12:00:00'::time, '24:00:00'::time),
      ('2026-09-14'::date, '森田',   '12:00:00'::time, '24:00:00'::time),
      -- 9/15（火）
      ('2026-09-15'::date, 'ねむ',   '12:00:00'::time, '24:00:00'::time),
      ('2026-09-15'::date, 'のあ',   '16:00:00'::time, '24:00:00'::time),
      ('2026-09-15'::date, 'みか',   '12:00:00'::time, '24:00:00'::time),
      -- 9/16（水）
      ('2026-09-16'::date, 'まる',   '10:00:00'::time, '17:00:00'::time),
      ('2026-09-16'::date, 'るみ',   '12:00:00'::time, '24:00:00'::time),
      ('2026-09-16'::date, 'すず',   '18:30:00'::time, '24:00:00'::time),
      ('2026-09-16'::date, '森田',   '10:00:00'::time, '24:00:00'::time),
      -- 9/17（木）
      ('2026-09-17'::date, 'のあ',   '16:00:00'::time, '24:00:00'::time),
      ('2026-09-17'::date, 'みか',   '16:00:00'::time, '24:00:00'::time),
      -- 9/18（金）
      ('2026-09-18'::date, 'のあ',   '16:00:00'::time, '24:00:00'::time),
      ('2026-09-18'::date, 'すず',   '18:00:00'::time, '24:00:00'::time),
      ('2026-09-18'::date, '森田',   '16:00:00'::time, '24:00:00'::time),
      -- 9/19（土）
      ('2026-09-19'::date, 'まる',   '10:00:00'::time, '24:00:00'::time),
      ('2026-09-19'::date, 'のあ',   '16:00:00'::time, '24:00:00'::time),
      ('2026-09-19'::date, 'すず',   '14:00:00'::time, '24:00:00'::time),
      ('2026-09-19'::date, 'みか',   '10:00:00'::time, '24:00:00'::time),
      -- 9/20（日）
      ('2026-09-20'::date, 'まる',   '10:00:00'::time, '24:00:00'::time),
      ('2026-09-20'::date, 'ねむ',   '12:00:00'::time, '24:00:00'::time),
      ('2026-09-20'::date, '森田',   '10:00:00'::time, '24:00:00'::time),
      -- 9/21（月・祝）
      ('2026-09-21'::date, 'まる',   '10:00:00'::time, '15:00:00'::time),
      ('2026-09-21'::date, 'ねむ',   '12:00:00'::time, '24:00:00'::time),
      ('2026-09-21'::date, 'のあ',   '16:00:00'::time, '24:00:00'::time),
      ('2026-09-21'::date, 'すず',   '15:00:00'::time, '24:00:00'::time),
      ('2026-09-21'::date, '森田',   '10:00:00'::time, '24:00:00'::time),
      -- 9/22（火・祝）
      ('2026-09-22'::date, 'まる',   '10:00:00'::time, '24:00:00'::time),
      ('2026-09-22'::date, 'るみ',   '10:00:00'::time, '24:00:00'::time),
      ('2026-09-22'::date, 'のあ',   '16:00:00'::time, '24:00:00'::time),
      ('2026-09-22'::date, 'みか',   '10:00:00'::time, '24:00:00'::time),
      -- 9/23（水・祝）
      ('2026-09-23'::date, 'まる',   '10:00:00'::time, '24:00:00'::time),
      ('2026-09-23'::date, 'るみ',   '10:00:00'::time, '24:00:00'::time),
      ('2026-09-23'::date, 'のあ',   '16:00:00'::time, '24:00:00'::time),
      ('2026-09-23'::date, '森田',   '10:00:00'::time, '24:00:00'::time),
      -- 9/24（木）
      ('2026-09-24'::date, 'るみ',   '10:00:00'::time, '17:00:00'::time),
      ('2026-09-24'::date, 'ねむ',   '12:00:00'::time, '24:00:00'::time),
      ('2026-09-24'::date, 'すず',   '17:00:00'::time, '24:00:00'::time),
      ('2026-09-24'::date, 'みか',   '10:00:00'::time, '24:00:00'::time),
      -- 9/25（金）
      ('2026-09-25'::date, 'るみ',   '10:00:00'::time, '24:00:00'::time),
      ('2026-09-25'::date, 'ねむ',   '12:00:00'::time, '24:00:00'::time),
      ('2026-09-25'::date, 'のあ',   '16:00:00'::time, '24:00:00'::time),
      ('2026-09-25'::date, '森田',   '10:00:00'::time, '24:00:00'::time),
      -- 9/26（土）
      ('2026-09-26'::date, 'まる',   '10:00:00'::time, '24:00:00'::time),
      ('2026-09-26'::date, 'のあ',   '16:00:00'::time, '24:00:00'::time),
      ('2026-09-26'::date, 'すず',   '18:30:00'::time, '24:00:00'::time),
      ('2026-09-26'::date, 'みか',   '10:00:00'::time, '24:00:00'::time),
      -- 9/27（日）
      ('2026-09-27'::date, 'まる',   '10:00:00'::time, '24:00:00'::time),
      ('2026-09-27'::date, 'ねむ',   '12:00:00'::time, '24:00:00'::time),
      ('2026-09-27'::date, 'のあ',   '16:00:00'::time, '24:00:00'::time),
      ('2026-09-27'::date, '森田',   '10:00:00'::time, '24:00:00'::time),
      -- 9/28（月）
      ('2026-09-28'::date, 'まる',   '17:00:00'::time, '24:00:00'::time),
      ('2026-09-28'::date, 'ねむ',   '12:00:00'::time, '24:00:00'::time),
      ('2026-09-28'::date, '森田',   '12:00:00'::time, '24:00:00'::time),
      -- 9/29（火）みか×
      ('2026-09-29'::date, 'るみ',   '10:00:00'::time, '17:00:00'::time),
      ('2026-09-29'::date, 'ねむ',   '12:00:00'::time, '24:00:00'::time),
      ('2026-09-29'::date, 'のあ',   '16:00:00'::time, '24:00:00'::time),
      ('2026-09-29'::date, '玉川',   '10:00:00'::time, '24:00:00'::time),
      -- 9/30（水）
      ('2026-09-30'::date, 'まる',   '10:00:00'::time, '24:00:00'::time),
      ('2026-09-30'::date, 'るみ',   '12:00:00'::time, '17:00:00'::time),
      ('2026-09-30'::date, 'のあ',   '17:00:00'::time, '24:00:00'::time),
      ('2026-09-30'::date, '森田',   '10:00:00'::time, '24:00:00'::time)
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
    AND s.scheduled_date BETWEEN '2026-09-01' AND '2026-09-30'
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

COMMIT;

-- 登録結果確認（110 行になる想定）
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
  AND s.scheduled_date BETWEEN '2026-09-01' AND '2026-09-30'
ORDER BY s.scheduled_date, cast_name;
