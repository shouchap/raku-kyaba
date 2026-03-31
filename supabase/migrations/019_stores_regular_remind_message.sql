-- レギュラーキャスト向けリマインド本文（「○○さん、」に続く文）
ALTER TABLE stores
  ADD COLUMN IF NOT EXISTS regular_remind_message text NOT NULL DEFAULT '本日も出勤よろしくお願いいたします。';

COMMENT ON COLUMN stores.regular_remind_message IS 'employment_type=regular 向け。名前の後に続く本文。';
