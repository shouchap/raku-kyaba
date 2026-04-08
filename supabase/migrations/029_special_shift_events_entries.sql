-- =============================================================================
-- 特別期間シフト募集（GW・お盆等）: 企画とキャスト提出
-- =============================================================================

CREATE TABLE public.special_shift_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  store_id UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT special_shift_events_date_range CHECK (end_date >= start_date)
);

COMMENT ON TABLE public.special_shift_events IS '特別期間シフト募集の企画（GW・お盆等）';
COMMENT ON COLUMN public.special_shift_events.title IS '例: 2026年GW出勤確認';

CREATE INDEX idx_special_shift_events_store_id ON public.special_shift_events(store_id);
CREATE INDEX idx_special_shift_events_dates ON public.special_shift_events(store_id, start_date, end_date);

CREATE TABLE public.special_shift_entries (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  event_id UUID NOT NULL REFERENCES public.special_shift_events(id) ON DELETE CASCADE,
  cast_id UUID NOT NULL REFERENCES public.casts(id) ON DELETE CASCADE,
  available_dates JSONB NOT NULL DEFAULT '[]'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (event_id, cast_id)
);

COMMENT ON TABLE public.special_shift_entries IS 'キャスト別の出勤可能日提出（日付文字列の配列）';
COMMENT ON COLUMN public.special_shift_entries.available_dates IS '例: ["2026-04-27","2026-05-01"]';

CREATE INDEX idx_special_shift_entries_event_id ON public.special_shift_entries(event_id);
CREATE INDEX idx_special_shift_entries_cast_id ON public.special_shift_entries(cast_id);

CREATE TRIGGER special_shift_events_updated_at
  BEFORE UPDATE ON public.special_shift_events
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE TRIGGER special_shift_entries_updated_at
  BEFORE UPDATE ON public.special_shift_entries
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- -----------------------------------------------------------------------------
-- RLS（021 の jwt_is_super_admin / jwt_can_access_store と整合）
-- -----------------------------------------------------------------------------
ALTER TABLE public.special_shift_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.special_shift_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "special_shift_events_all_authenticated" ON public.special_shift_events;
CREATE POLICY "special_shift_events_all_authenticated" ON public.special_shift_events
  FOR ALL TO authenticated
  USING (
    public.jwt_is_super_admin()
    OR public.jwt_can_access_store(store_id)
  )
  WITH CHECK (
    public.jwt_is_super_admin()
    OR public.jwt_can_access_store(store_id)
  );

DROP POLICY IF EXISTS "special_shift_entries_all_authenticated" ON public.special_shift_entries;
CREATE POLICY "special_shift_entries_all_authenticated" ON public.special_shift_entries
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.special_shift_events e
      WHERE e.id = special_shift_entries.event_id
        AND (
          public.jwt_is_super_admin()
          OR public.jwt_can_access_store(e.store_id)
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.special_shift_events e
      WHERE e.id = special_shift_entries.event_id
        AND (
          public.jwt_is_super_admin()
          OR public.jwt_can_access_store(e.store_id)
        )
    )
  );

-- キャスト用 Web 提出はサーバー API（service_role）経由のみ。anon はポリシーなし＝拒否。
