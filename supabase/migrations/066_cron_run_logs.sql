-- cron 実行結果の永続ログ（Vercel Hobby の短命ランタイムログ対策）
CREATE TABLE IF NOT EXISTS public.cron_run_logs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job           text NOT NULL,
  store_id      uuid REFERENCES public.stores(id) ON DELETE SET NULL,
  store_name    text,
  status        text NOT NULL,
  reason        text,
  detail        text,
  target_count  int  NOT NULL DEFAULT 0,
  success_count int  NOT NULL DEFAULT 0,
  failure_count int  NOT NULL DEFAULT 0,
  jst_date      date NOT NULL,
  jst_hour      int  NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cron_run_logs_created
  ON public.cron_run_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cron_run_logs_job_date
  ON public.cron_run_logs(job, jst_date);
CREATE INDEX IF NOT EXISTS idx_cron_run_logs_job_reason_date
  ON public.cron_run_logs(job, reason, jst_date);

COMMENT ON TABLE public.cron_run_logs IS 'Cloud Scheduler / cron API の店舗単位・送信単位の実行記録';

ALTER TABLE public.cron_run_logs ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.cron_run_logs FROM PUBLIC;
GRANT ALL ON public.cron_run_logs TO service_role;
