-- 来客連絡（リッチメニュー）用の LINE 対話状態を casts に保持
ALTER TABLE public.casts
  ADD COLUMN IF NOT EXISTS line_pending_flow text,
  ADD COLUMN IF NOT EXISTS line_pending_draft jsonb;

COMMENT ON COLUMN public.casts.line_pending_flow IS
  '公式LINE対話の進行状態（例: visitor_arrival_name / visitor_arrival_count / visitor_arrival_time）';
COMMENT ON COLUMN public.casts.line_pending_draft IS
  '進行中対話の下書きJSON（来客の顧客名・人数・時間など）';
