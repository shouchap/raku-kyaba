-- 松島 黄金 向けシフト登録（2026-08-01 〜 2026-08-15）
-- Supabase SQL Editor にそのまま貼り付けて実行できます。
--
-- 前提:
--   - store_id: stores.name = '松島 黄金'
--   - cast_id: 同一店舗の casts.name / casts.display_name 完全一致
--   - 退勤 24:00 は DB 上 24:00:00（アプリと同じ正規化）
--   - NOT NULL の Boolean 列はすべて false
--   - 「×」なし。空欄はシフトなしとして除外
--
-- 注意:
--   - 8/1 の「玉川」を含みます。玉川が casts（松島 黄金）に未登録だと
--     冒頭チェックで停止し、1件も登録されません。
--
-- 実行前の確認（任意）:
--   SELECT id, name, business_type FROM public.stores WHERE name = '松島 黄金';
--   SELECT name, display_name FROM public.casts
--     WHERE store_id = (SELECT id FROM public.stores WHERE name = '松島 黄金' LIMIT 1)
--     ORDER BY name;

BEGIN;

-- 店舗・キャスト名の事前チェック（不足があればここで止まり INSERT されません）
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
      'まる', 'るみ', 'ねむ', 'みお', 'あい', 'ななみ', 'のあ', '森田', 'みか', '玉川'
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
      ('2026-08-01'::date, 'まる',   '10:00:00'::time, '24:00:00'::time),
      ('2026-08-01'::date, 'ななみ', '13:00:00'::time, '24:00:00'::time),
      ('2026-08-01'::date, '玉川',   '10:00:00'::time, '24:00:00'::time),
      ('2026-08-02'::date, 'まる',   '10:00:00'::time, '24:00:00'::time),
      ('2026-08-02'::date, 'るみ',   '12:00:00'::time, '24:00:00'::time),
      ('2026-08-02'::date, 'ねむ',   '17:00:00'::time, '24:00:00'::time),
      ('2026-08-02'::date, '森田',   '10:00:00'::time, '24:00:00'::time),
      ('2026-08-03'::date, 'まる',   '17:00:00'::time, '24:00:00'::time),
      ('2026-08-03'::date, 'ねむ',   '12:00:00'::time, '24:00:00'::time),
      ('2026-08-03'::date, 'みお',   '10:00:00'::time, '15:00:00'::time),
      ('2026-08-03'::date, '森田',   '10:00:00'::time, '24:00:00'::time),
      ('2026-08-04'::date, 'るみ',   '10:00:00'::time, '17:00:00'::time),
      ('2026-08-04'::date, 'ねむ',   '17:00:00'::time, '24:00:00'::time),
      ('2026-08-04'::date, 'ななみ', '14:00:00'::time, '24:00:00'::time),
      ('2026-08-04'::date, 'みか',   '10:00:00'::time, '24:00:00'::time),
      ('2026-08-05'::date, 'まる',   '10:00:00'::time, '24:00:00'::time),
      ('2026-08-05'::date, 'あい',   '17:00:00'::time, '24:00:00'::time),
      ('2026-08-05'::date, '森田',   '10:00:00'::time, '24:00:00'::time),
      ('2026-08-06'::date, 'あい',   '15:00:00'::time, '24:00:00'::time),
      ('2026-08-06'::date, 'みか',   '15:00:00'::time, '24:00:00'::time),
      ('2026-08-07'::date, 'るみ',   '10:00:00'::time, '17:00:00'::time),
      ('2026-08-07'::date, 'ねむ',   '12:00:00'::time, '24:00:00'::time),
      ('2026-08-07'::date, 'のあ',   '17:00:00'::time, '24:00:00'::time),
      ('2026-08-07'::date, '森田',   '10:00:00'::time, '24:00:00'::time),
      ('2026-08-08'::date, 'まる',   '10:00:00'::time, '24:00:00'::time),
      ('2026-08-08'::date, 'ねむ',   '12:00:00'::time, '24:00:00'::time),
      ('2026-08-08'::date, 'のあ',   '16:00:00'::time, '24:00:00'::time),
      ('2026-08-08'::date, 'みか',   '10:00:00'::time, '24:00:00'::time),
      ('2026-08-09'::date, 'まる',   '10:00:00'::time, '24:00:00'::time),
      ('2026-08-09'::date, 'みお',   '10:00:00'::time, '17:00:00'::time),
      ('2026-08-09'::date, 'のあ',   '17:00:00'::time, '24:00:00'::time),
      ('2026-08-09'::date, '森田',   '10:00:00'::time, '24:00:00'::time),
      ('2026-08-10'::date, 'まる',   '17:00:00'::time, '24:00:00'::time),
      ('2026-08-10'::date, 'ねむ',   '11:00:00'::time, '18:00:00'::time),
      ('2026-08-10'::date, 'みお',   '10:00:00'::time, '15:00:00'::time),
      ('2026-08-10'::date, '森田',   '10:00:00'::time, '24:00:00'::time),
      ('2026-08-11'::date, 'ねむ',   '12:00:00'::time, '24:00:00'::time),
      ('2026-08-11'::date, 'ななみ', '13:00:00'::time, '24:00:00'::time),
      ('2026-08-11'::date, 'のあ',   '16:00:00'::time, '24:00:00'::time),
      ('2026-08-11'::date, 'みか',   '12:00:00'::time, '24:00:00'::time),
      ('2026-08-12'::date, 'まる',   '10:00:00'::time, '24:00:00'::time),
      ('2026-08-12'::date, 'のあ',   '16:00:00'::time, '24:00:00'::time),
      ('2026-08-12'::date, '森田',   '10:00:00'::time, '24:00:00'::time),
      ('2026-08-13'::date, 'まる',   '10:00:00'::time, '17:00:00'::time),
      ('2026-08-13'::date, 'ねむ',   '12:00:00'::time, '24:00:00'::time),
      ('2026-08-13'::date, 'あい',   '17:00:00'::time, '24:00:00'::time),
      ('2026-08-13'::date, 'みか',   '10:00:00'::time, '24:00:00'::time),
      ('2026-08-14'::date, 'まる',   '10:00:00'::time, '24:00:00'::time),
      ('2026-08-14'::date, 'のあ',   '16:00:00'::time, '24:00:00'::time),
      ('2026-08-14'::date, '森田',   '10:00:00'::time, '24:00:00'::time),
      ('2026-08-15'::date, 'まる',   '10:00:00'::time, '24:00:00'::time),
      ('2026-08-15'::date, 'ねむ',   '17:00:00'::time, '24:00:00'::time),
      ('2026-08-15'::date, 'ななみ', '12:00:00'::time, '17:00:00'::time),
      ('2026-08-15'::date, 'のあ',   '17:00:00'::time, '24:00:00'::time),
      ('2026-08-15'::date, 'みか',   '10:00:00'::time, '24:00:00'::time)
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
)
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
  updated_at = NOW();

COMMIT;

-- 登録結果確認（55 行になる想定）
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
  AND s.scheduled_date BETWEEN '2026-08-01' AND '2026-08-15'
ORDER BY s.scheduled_date, cast_name;
