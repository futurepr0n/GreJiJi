CREATE TABLE IF NOT EXISTS trust_assessments (
  transaction_id TEXT PRIMARY KEY,
  risk_score INTEGER NOT NULL CHECK (risk_score >= 0 AND risk_score <= 100),
  risk_band TEXT NOT NULL CHECK (risk_band IN ('low', 'medium', 'high')),
  confidence_band TEXT NOT NULL CHECK (confidence_band IN ('low', 'medium', 'high')),
  criticality TEXT NOT NULL CHECK (criticality IN ('low', 'medium', 'high')),
  geospatial_signals_json TEXT NOT NULL,
  escrow_stress_json TEXT NOT NULL,
  intervention_json TEXT NOT NULL,
  reason_codes_json TEXT NOT NULL,
  evidence_summary_json TEXT NOT NULL,
  orchestration_version TEXT NOT NULL,
  last_evaluated_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (transaction_id) REFERENCES transactions(id)
);

CREATE TABLE IF NOT EXISTS trust_interventions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  transaction_id TEXT NOT NULL,
  risk_score INTEGER NOT NULL CHECK (risk_score >= 0 AND risk_score <= 100),
  risk_band TEXT NOT NULL CHECK (risk_band IN ('low', 'medium', 'high')),
  recommended_controls_json TEXT NOT NULL,
  decision_json TEXT NOT NULL,
  reason_codes_json TEXT NOT NULL,
  evidence_summary_json TEXT NOT NULL,
  evaluated_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (transaction_id) REFERENCES transactions(id)
);

CREATE INDEX IF NOT EXISTS idx_trust_interventions_transaction_created
  ON trust_interventions (transaction_id, created_at DESC, id DESC);
