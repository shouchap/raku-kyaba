-- 出勤回答後の予約（客予定）ヒアリングを店舗ごとに ON/OFF
ALTER TABLE stores
  ADD COLUMN IF NOT EXISTS enable_reservation_check BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN stores.enable_reservation_check IS '出勤ボタン後に予約（客予定）をヒアリングするか';

-- 既存テナント: BAR🧩 系のみ ON、それ以外はデフォルト false のまま
UPDATE stores
SET enable_reservation_check = true
WHERE (name LIKE '%BAR%' AND name LIKE '%🧩%')
   OR name = 'BAR🧩';
