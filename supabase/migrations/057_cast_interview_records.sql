-- キャバクラ: 出勤レポート用の面談記録（管理画面から手入力）
CREATE TABLE public.cast_interview_records (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  store_id UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  cast_id UUID NOT NULL REFERENCES public.casts(id) ON DELETE CASCADE,
  interview_date DATE NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT cast_interview_records_content_nonempty_chk CHECK (char_length(trim(content)) > 0)
);

CREATE INDEX idx_cast_interview_records_store_date
  ON public.cast_interview_records (store_id, interview_date DESC);

CREATE INDEX idx_cast_interview_records_cast_date
  ON public.cast_interview_records (cast_id, interview_date DESC);

COMMENT ON TABLE public.cast_interview_records IS 'キャバクラ向け: キャスト面談記録（管理画面手入力）';
COMMENT ON COLUMN public.cast_interview_records.interview_date IS '面談日（JST 暦日）';
COMMENT ON COLUMN public.cast_interview_records.content IS '面談内容（自由記述）';

CREATE TRIGGER cast_interview_records_updated_at
  BEFORE UPDATE ON public.cast_interview_records
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE public.cast_interview_records ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "cast_interview_records_all_authenticated" ON public.cast_interview_records;
CREATE POLICY "cast_interview_records_all_authenticated" ON public.cast_interview_records
  FOR ALL TO authenticated
  USING (public.jwt_can_access_store(store_id))
  WITH CHECK (public.jwt_can_access_store(store_id));
