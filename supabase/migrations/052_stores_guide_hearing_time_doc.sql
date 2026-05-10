-- 案内数入力の定期送信時刻: 実体は既存 guide_hearing_time（035）。
-- キャバクラ（cabaret）向けジョブで使用する旨をコメントで明示する。
COMMENT ON COLUMN public.stores.guide_hearing_time IS
  '案内数入力（クイックリプライ起点）の自動送信時刻（HH:00, JST）。キャバクラ店舗で /api/cron/send-guide-hearing が参照。';
