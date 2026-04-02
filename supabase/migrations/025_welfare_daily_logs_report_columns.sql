-- B型日報レポート用の追加カラム + 管理画面（JWT）からの参照・更新
ALTER TABLE public.welfare_daily_logs
  ADD COLUMN IF NOT EXISTS work_details TEXT,
  ADD COLUMN IF NOT EXISTS quantity INTEGER,
  ADD COLUMN IF NOT EXISTS health_notes TEXT;

COMMENT ON COLUMN public.welfare_daily_logs.work_details IS '作業内容（自由記述）';
COMMENT ON COLUMN public.welfare_daily_logs.quantity IS '個数（実績など）';
COMMENT ON COLUMN public.welfare_daily_logs.health_notes IS '体調詳細（health_reason と併用可）';

-- 021 時点では welfare_daily_logs にポリシーなし → authenticated は拒否。店長がレポート閲覧できるようテナント分離を付与
DROP POLICY IF EXISTS "welfare_daily_logs_tenant_authenticated" ON public.welfare_daily_logs;
CREATE POLICY "welfare_daily_logs_tenant_authenticated" ON public.welfare_daily_logs
  FOR ALL TO authenticated
  USING (public.jwt_can_access_store(store_id))
  WITH CHECK (public.jwt_can_access_store(store_id));
