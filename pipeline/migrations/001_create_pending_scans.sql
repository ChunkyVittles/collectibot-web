CREATE TABLE IF NOT EXISTS pending_scans (
    id BIGSERIAL PRIMARY KEY,
    front_image_path TEXT NOT NULL,
    back_image_path TEXT NOT NULL,
    extracted_title TEXT,
    extracted_issue TEXT,
    extracted_year INTEGER,
    extracted_publisher TEXT,
    extracted_price TEXT,
    confidence_score INTEGER DEFAULT 0,
    reason_for_review TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_pending_scans_created ON pending_scans (created_at DESC);
