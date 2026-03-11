-- =============================================================================
-- キャバクラ向け出勤確認システム - 初期スキーマ
-- マルチテナント（SaaS）対応: 全テーブルに store_id を必須で保持
-- Supabase RLS (Row Level Security) によるテナント分離を前提とした設計
-- =============================================================================

-- UUID拡張を有効化（PostgreSQL標準）
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- -----------------------------------------------------------------------------
-- 出勤ステータス定義
-- 「未回答」は attendance_logs レコードが存在しない状態で表現する
-- -----------------------------------------------------------------------------
CREATE TYPE attendance_status AS ENUM (
  'attending',   -- 出勤
  'absent',     -- 欠勤
  'late'        -- 遅刻
);

-- -----------------------------------------------------------------------------
-- stores: 店舗（テナント）情報
-- 各店舗が独自のLINEチャネルを持つことを想定
-- -----------------------------------------------------------------------------
CREATE TABLE stores (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(100) NOT NULL,
  -- LINE Messaging API 認証情報
  line_channel_id VARCHAR(100),
  line_channel_secret VARCHAR(100) NOT NULL,
  line_channel_access_token TEXT,
  line_bot_user_id VARCHAR(50),  -- Webhookのdestination照合用（マルチチャネル時）
  -- 管理者通知用
  admin_line_user_id VARCHAR(50),
  -- 通知時刻設定（将来的な拡張用）
  attendance_check_time TIME DEFAULT '10:00',
  daily_report_time TIME DEFAULT '17:00',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE stores IS '店舗（テナント）マスタ。LINE API認証情報と管理者情報を保持';
COMMENT ON COLUMN stores.line_bot_user_id IS 'Webhookのdestinationと照合し、複数チャネル対応時にテナントを特定するために使用';

-- -----------------------------------------------------------------------------
-- casts: キャスト情報
-- 店舗に所属するキャスト。line_user_id は同一店舗内で一意
-- -----------------------------------------------------------------------------
CREATE TABLE casts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  line_user_id VARCHAR(50) NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (store_id, line_user_id)
);

CREATE INDEX idx_casts_store_id ON casts(store_id);
CREATE INDEX idx_casts_line_user_id ON casts(line_user_id);
CREATE INDEX idx_casts_store_line ON casts(store_id, line_user_id);

COMMENT ON TABLE casts IS 'キャスト情報。LINE User IDと店舗の紐付けを保持';
COMMENT ON COLUMN casts.line_user_id IS 'LINEプラットフォームのユーザー識別子。Webhookイベントの照合に使用';

-- -----------------------------------------------------------------------------
-- attendance_schedules: 出勤予定
-- 毎日10:00の出勤確認送信対象を管理
-- -----------------------------------------------------------------------------
CREATE TABLE attendance_schedules (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  cast_id UUID NOT NULL REFERENCES casts(id) ON DELETE CASCADE,
  scheduled_date DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (store_id, cast_id, scheduled_date)
);

CREATE INDEX idx_attendance_schedules_store_date ON attendance_schedules(store_id, scheduled_date);
CREATE INDEX idx_attendance_schedules_cast_date ON attendance_schedules(cast_id, scheduled_date);

COMMENT ON TABLE attendance_schedules IS '出勤予定。出勤確認メッセージ送信対象と17:00レポート対象を管理';

-- -----------------------------------------------------------------------------
-- attendance_logs: 出勤記録
-- キャストの回答（出勤/欠勤/遅刻）を記録
-- attended_date: 出勤対象日。スケジュール未登録の即時回答にも対応
-- -----------------------------------------------------------------------------
CREATE TABLE attendance_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  cast_id UUID NOT NULL REFERENCES casts(id) ON DELETE CASCADE,
  attendance_schedule_id UUID REFERENCES attendance_schedules(id) ON DELETE SET NULL,
  attended_date DATE NOT NULL,
  status attendance_status NOT NULL,
  responded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (store_id, cast_id, attended_date)
);

CREATE INDEX idx_attendance_logs_store_date ON attendance_logs(store_id, attended_date);
CREATE INDEX idx_attendance_logs_cast_date ON attendance_logs(cast_id, attended_date);
CREATE INDEX idx_attendance_logs_status ON attendance_logs(store_id, attended_date, status);

COMMENT ON TABLE attendance_logs IS '出勤回答記録。未回答はレコード不在で表現';

-- -----------------------------------------------------------------------------
-- updated_at 自動更新トリガー
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER stores_updated_at
  BEFORE UPDATE ON stores
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER casts_updated_at
  BEFORE UPDATE ON casts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER attendance_schedules_updated_at
  BEFORE UPDATE ON attendance_schedules
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER attendance_logs_updated_at
  BEFORE UPDATE ON attendance_logs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- -----------------------------------------------------------------------------
-- RLS (Row Level Security) ポリシー
-- store_id によるテナント分離を保証
-- ※ バックエンドAPIはサービスロールキー使用時、RLSをバイパス
-- ※ フロントエンド等でanonキー使用時は、SET app.current_store_id でテナントを指定すること
-- -----------------------------------------------------------------------------
ALTER TABLE stores ENABLE ROW LEVEL SECURITY;
ALTER TABLE casts ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance_logs ENABLE ROW LEVEL SECURITY;

-- テナント分離: app.current_store_id がセットされている場合のみ、該当storeの行にアクセス許可
CREATE POLICY "stores_tenant_isolation" ON stores FOR ALL
  USING (id::text = nullif(current_setting('app.current_store_id', true), ''));

CREATE POLICY "casts_tenant_isolation" ON casts FOR ALL
  USING (store_id::text = nullif(current_setting('app.current_store_id', true), ''));

CREATE POLICY "attendance_schedules_tenant_isolation" ON attendance_schedules FOR ALL
  USING (store_id::text = nullif(current_setting('app.current_store_id', true), ''));

CREATE POLICY "attendance_logs_tenant_isolation" ON attendance_logs FOR ALL
  USING (store_id::text = nullif(current_setting('app.current_store_id', true), ''));
