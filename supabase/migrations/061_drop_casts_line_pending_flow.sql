-- 来客連絡機能を保留したため、未使用になった対話状態カラムを削除
ALTER TABLE public.casts
  DROP COLUMN IF EXISTS line_pending_flow,
  DROP COLUMN IF EXISTS line_pending_draft;
