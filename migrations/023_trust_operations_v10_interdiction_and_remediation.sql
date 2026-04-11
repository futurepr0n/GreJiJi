BEGIN TRANSACTION;

CREATE TABLE IF NOT EXISTS trust_listing_authenticity_signals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id INTEGER,
  transaction_id TEXT NOT NULL,
  listing_id TEXT,
  seller_id TEXT NOT NULL,
  signal_type TEXT NOT NULL CHECK (
    signal_type IN ('image_reuse', 'duplicate_listing_cluster', 'price_outlier', 'seller_history_mismatch')
  ),
  reason_code TEXT NOT NULL,
  confidence_score INTEGER NOT NULL CHECK (confidence_score >= 0 AND confidence_score <= 100),
  signal_details_json TEXT NOT NULL,
  policy_version_id INTEGER,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (case_id) REFERENCES trust_operations_cases(id),
  FOREIGN KEY (transaction_id) REFERENCES transactions(id),
  FOREIGN KEY (listing_id) REFERENCES listings(id),
  FOREIGN KEY (seller_id) REFERENCES users(id),
  FOREIGN KEY (policy_version_id) REFERENCES trust_ops_policy_versions(id)
);

CREATE INDEX IF NOT EXISTS idx_trust_listing_auth_signals_case_created
  ON trust_listing_authenticity_signals (case_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_trust_listing_auth_signals_tx_created
  ON trust_listing_authenticity_signals (transaction_id, created_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS trust_case_remediation_actions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id INTEGER NOT NULL,
  transaction_id TEXT NOT NULL,
  action_type TEXT NOT NULL CHECK (
    action_type IN (
      'listing_quarantine',
      'offer_throttle',
      'account_capability_restriction',
      'payout_reserve_escalation',
      'remediation_unwind'
    )
  ),
  confidence_tier TEXT NOT NULL CHECK (confidence_tier IN ('low', 'medium', 'high', 'critical')),
  status TEXT NOT NULL CHECK (status IN ('proposed', 'applied', 'rolled_back')),
  reason_code TEXT NOT NULL,
  policy_version_id INTEGER,
  machine_decision_json TEXT NOT NULL,
  human_decision_json TEXT NOT NULL,
  rollback_of_action_id INTEGER,
  audit_chain_hash TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (case_id) REFERENCES trust_operations_cases(id),
  FOREIGN KEY (transaction_id) REFERENCES transactions(id),
  FOREIGN KEY (policy_version_id) REFERENCES trust_ops_policy_versions(id),
  FOREIGN KEY (rollback_of_action_id) REFERENCES trust_case_remediation_actions(id)
);

CREATE INDEX IF NOT EXISTS idx_trust_case_remediation_actions_case_created
  ON trust_case_remediation_actions (case_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_trust_case_remediation_actions_tx_created
  ON trust_case_remediation_actions (transaction_id, created_at DESC, id DESC);

COMMIT;
