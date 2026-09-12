# 本番 DB マイグレーション適用手順

本番への DDL/シード適用は **Supabase CLI（`npm run db:push`）** で行い、ダッシュボードへの直接貼り付けは原則避けます。

## 背景（案内数ヒアリングの二重送信防止）

`stores.last_guide_hearing_sent_date` は `035_guide_hearing_staffs_daily_results.sql` で追加されます。  
未適用のとき `/api/cron/send-guide-hearing` は送信せず `status: "skipped", reason: "missing_dedupe_column"` を返します（二重送信防止）。

## 適用コマンド

```bash
# 未ログインなら
npm run db:login

# プロジェクト未リンクなら（project-ref は package.json の db:link を参照）
npm run db:link

# 適用状況の確認
npm run db:status

# 未適用マイグレーションを本番へ適用
npm run db:push
```

特に未適用になりやすいもの:

- `035_guide_hearing_staffs_daily_results.sql`（`last_guide_hearing_sent_date` など）
- `064_seed_attendance_schedules_2026_09_01_30.sql`（シフトシード。業務データのため適用前に内容を確認）

## 確認用 SQL（適用後）

```sql
-- 035: 重複抑止列の存在確認
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'stores'
  AND column_name = 'last_guide_hearing_sent_date';

-- マイグレーション履歴（Supabase 管理）
SELECT version, name
FROM supabase_migrations.schema_migrations
ORDER BY version DESC
LIMIT 20;
```

列が存在すれば案内数 cron は通常どおり送信・日付更新を行います。
