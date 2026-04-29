ALTER TABLE stores
  ADD COLUMN IF NOT EXISTS guide_hearing_reporter_id UUID REFERENCES casts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_stores_guide_hearing_reporter_id
  ON stores(guide_hearing_reporter_id);

COMMENT ON COLUMN stores.guide_hearing_reporter_id IS '案内数ヒアリングのLINE受取担当キャストID';
