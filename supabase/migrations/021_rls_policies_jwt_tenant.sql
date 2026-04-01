-- =============================================================================
-- Row Level Security: JWT ベースのテナント分離 + service_role はバイパス（従来どおり）
--
-- 設計:
-- - anon: ポリシーなし → テーブルへのアクセス不可（PostgREST 経由の匿名アクセスを遮断）
-- - authenticated: 店長(store_admin)は JWT の store_id と一致する行のみ。
--   スーパー管理者は JWT の user_metadata または app_metadata に role=super_admin が
--   ある場合に全店舗を操作可能。
-- - service_role: RLS をバイパス（Webhook / Cron / API のサービスロール経路）
--
-- 【既存スーパー管理者の移行】
-- Supabase Dashboard → Authentication → Users → 対象ユーザー →
-- App metadata に {"role": "super_admin"} を追加（または User metadata）。
-- 環境変数 SUPER_ADMIN_EMAILS のみで判定している従来の「アプリ側スーパー管理者」は
-- JWT に載らないため、本ポリシーでは DB へ anon 経由では通りません。
-- 管理画面のブラウザはログイン済み JWT が必要です。
-- =============================================================================

-- 既存ポリシー（001 / 003）を削除
DROP POLICY IF EXISTS "stores_tenant_isolation" ON public.stores;
DROP POLICY IF EXISTS "casts_tenant_isolation" ON public.casts;
DROP POLICY IF EXISTS "attendance_schedules_tenant_isolation" ON public.attendance_schedules;
DROP POLICY IF EXISTS "attendance_logs_tenant_isolation" ON public.attendance_logs;
DROP POLICY IF EXISTS "Allow all for authenticated" ON public.system_settings;

-- ヘルパー: スーパー管理者（JWT）
CREATE OR REPLACE FUNCTION public.jwt_is_super_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT coalesce((auth.jwt()->'user_metadata'->>'role') = 'super_admin', false)
    OR coalesce((auth.jwt()->'app_metadata'->>'role') = 'super_admin', false);
$$;

-- ヘルパー: 対象店舗へのアクセス可否（店長 or スーパー管理者）
CREATE OR REPLACE FUNCTION public.jwt_can_access_store(target_store uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT
    public.jwt_is_super_admin()
    OR (
      (
        coalesce((auth.jwt()->'user_metadata'->>'role'), '') = 'store_admin'
        OR coalesce((auth.jwt()->'app_metadata'->>'role'), '') = 'store_admin'
      )
      AND coalesce(
        nullif(trim(auth.jwt()->'user_metadata'->>'store_id'), '')::uuid,
        nullif(trim(auth.jwt()->'app_metadata'->>'store_id'), '')::uuid
      ) = target_store
    );
$$;

GRANT EXECUTE ON FUNCTION public.jwt_is_super_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.jwt_can_access_store(uuid) TO authenticated;

-- -----------------------------------------------------------------------------
-- RLS 有効化（冪等）
-- -----------------------------------------------------------------------------
ALTER TABLE public.stores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.casts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.system_settings ENABLE ROW LEVEL SECURITY;

-- -----------------------------------------------------------------------------
-- stores: ブラウザは SELECT のみ多い。INSERT はスーパー管理者のみ（店舗作成 API と整合）
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "stores_select_authenticated" ON public.stores;
CREATE POLICY "stores_select_authenticated" ON public.stores
  FOR SELECT TO authenticated
  USING (public.jwt_can_access_store(id));

DROP POLICY IF EXISTS "stores_insert_authenticated" ON public.stores;
CREATE POLICY "stores_insert_authenticated" ON public.stores
  FOR INSERT TO authenticated
  WITH CHECK (public.jwt_is_super_admin());

DROP POLICY IF EXISTS "stores_update_authenticated" ON public.stores;
CREATE POLICY "stores_update_authenticated" ON public.stores
  FOR UPDATE TO authenticated
  USING (public.jwt_can_access_store(id))
  WITH CHECK (public.jwt_can_access_store(id));

DROP POLICY IF EXISTS "stores_delete_authenticated" ON public.stores;
CREATE POLICY "stores_delete_authenticated" ON public.stores
  FOR DELETE TO authenticated
  USING (public.jwt_is_super_admin());

-- -----------------------------------------------------------------------------
-- casts / attendance_schedules: 管理画面ブラウザ（店長・スーパー管理者）
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "casts_all_authenticated" ON public.casts;
CREATE POLICY "casts_all_authenticated" ON public.casts
  FOR ALL TO authenticated
  USING (public.jwt_can_access_store(store_id))
  WITH CHECK (public.jwt_can_access_store(store_id));

DROP POLICY IF EXISTS "attendance_schedules_all_authenticated" ON public.attendance_schedules;
CREATE POLICY "attendance_schedules_all_authenticated" ON public.attendance_schedules
  FOR ALL TO authenticated
  USING (public.jwt_can_access_store(store_id))
  WITH CHECK (public.jwt_can_access_store(store_id));

-- -----------------------------------------------------------------------------
-- attendance_logs / system_settings: クライアントからはアクセスさせない
-- （LINE Webhook・Cron・サーバー API の service_role のみ）
-- ポリシーを作らないため authenticated / anon は拒否。service_role は RLS バイパス。
-- -----------------------------------------------------------------------------

COMMENT ON FUNCTION public.jwt_is_super_admin() IS 'JWT の role=super_admin で全店舗アクセス用';
COMMENT ON FUNCTION public.jwt_can_access_store(uuid) IS '店長は JWT の store_id と一致するテナントのみ';

-- スーパー管理者（環境変数 SUPER_ADMIN_* でアプリ側のみ判定していたユーザー）が
-- 管理画面ブラウザで全店舗を扱うには、上記 JWT に role を載せる必要がある。
-- Supabase SQL Editor（postgres ロール）の例（メールは実値に置換）:
--
-- UPDATE auth.users
-- SET raw_app_meta_data = COALESCE(raw_app_meta_data, '{}'::jsonb) || '{"role":"super_admin"}'::jsonb
-- WHERE lower(email) = lower('your-admin@example.com');
