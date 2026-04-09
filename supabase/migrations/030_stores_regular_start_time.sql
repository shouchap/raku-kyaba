-- レギュラー勤務のデフォルト出勤時刻（週間シフト一括入力用）

ALTER TABLE public.stores
  ADD COLUMN IF NOT EXISTS regular_start_time time NULL;

COMMENT ON COLUMN public.stores.regular_start_time IS 'レギュラー勤務のデフォルト出勤時刻。週間シフト画面の一括入力で使用。';
