-- B型事業所向け：日次の作業開始・体調・終了・作業項目（LINE フロー専用）
-- キャバクラ向け attendance_schedules / attendance_logs とは独立

CREATE TABLE public.welfare_daily_logs (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  store_id uuid NOT NULL REFERENCES public.stores (id) ON DELETE CASCADE,
  cast_id uuid NOT NULL REFERENCES public.casts (id) ON DELETE CASCADE,
  work_date date NOT NULL,
  started_at timestamptz,
  ended_at timestamptz,
  health_status text CHECK (
    health_status IS NULL OR health_status IN ('good', 'soso', 'bad')
  ),
  health_reason text,
  work_item text,
  pending_line_flow text CHECK (
    pending_line_flow IS NULL
    OR pending_line_flow IN ('welfare_health_reason', 'welfare_work_item')
  ),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cast_id, work_date)
);

CREATE INDEX idx_welfare_daily_logs_store_date ON public.welfare_daily_logs (store_id, work_date);
CREATE INDEX idx_welfare_daily_logs_cast_date ON public.welfare_daily_logs (cast_id, work_date);

COMMENT ON TABLE public.welfare_daily_logs IS '就労継続支援B型：1人1日1行。LINE welfare フロー専用';

CREATE TRIGGER welfare_daily_logs_updated_at
  BEFORE UPDATE ON public.welfare_daily_logs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE public.welfare_daily_logs ENABLE ROW LEVEL SECURITY;
