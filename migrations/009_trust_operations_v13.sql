ALTER TABLE trust_assessments
  ADD COLUMN graph_signals_json TEXT NOT NULL DEFAULT '{}';

ALTER TABLE trust_assessments
  ADD COLUMN evidence_provenance_json TEXT NOT NULL DEFAULT '{}';

ALTER TABLE trust_assessments
  ADD COLUMN outcome_feedback_json TEXT NOT NULL DEFAULT '{}';

ALTER TABLE trust_interventions
  ADD COLUMN provenance_ref TEXT;

ALTER TABLE trust_interventions
  ADD COLUMN outcome_feedback_json TEXT NOT NULL DEFAULT '{}';

CREATE TABLE IF NOT EXISTS trust_signal_snapshots (
  id TEXT PRIMARY KEY,
  transaction_id TEXT NOT NULL,
  snapshot_hash TEXT NOT NULL,
  signals_json TEXT NOT NULL,
  lineage_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(transaction_id, snapshot_hash),
  FOREIGN KEY (transaction_id) REFERENCES transactions(id)
);

CREATE INDEX IF NOT EXISTS idx_trust_signal_snapshots_transaction_created
  ON trust_signal_snapshots (transaction_id, created_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS transaction_risk_entities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  transaction_id TEXT NOT NULL,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('user', 'listing', 'device', 'payment_fingerprint', 'dispute_entity')),
  entity_key TEXT NOT NULL,
  source TEXT NOT NULL,
  confidence REAL NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  UNIQUE(transaction_id, entity_type, entity_key),
  FOREIGN KEY (transaction_id) REFERENCES transactions(id)
);

CREATE INDEX IF NOT EXISTS idx_transaction_risk_entities_lookup
  ON transaction_risk_entities (entity_type, entity_key, transaction_id);

CREATE INDEX IF NOT EXISTS idx_transaction_risk_entities_transaction
  ON transaction_risk_entities (transaction_id, entity_type);
