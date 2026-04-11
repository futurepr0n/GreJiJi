BEGIN TRANSACTION;

CREATE TABLE IF NOT EXISTS trust_buyer_risk_signals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id INTEGER,
  transaction_id TEXT NOT NULL,
  buyer_id TEXT NOT NULL,
  signal_type TEXT NOT NULL CHECK (
    signal_type IN (
      'payment_behavior',
      'messaging_intent',
      'dispute_history',
      'trust_history',
      'escrow_anomaly_forecast'
    )
  ),
  reason_code TEXT NOT NULL,
  feature_weight REAL NOT NULL,
  feature_value REAL NOT NULL,
  contribution_score REAL NOT NULL,
  signal_details_json TEXT NOT NULL,
  policy_version_id INTEGER,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (case_id) REFERENCES trust_operations_cases(id),
  FOREIGN KEY (transaction_id) REFERENCES transactions(id),
  FOREIGN KEY (buyer_id) REFERENCES users(id),
  FOREIGN KEY (policy_version_id) REFERENCES trust_ops_policy_versions(id)
);

CREATE INDEX IF NOT EXISTS idx_trust_buyer_risk_signals_case_created
  ON trust_buyer_risk_signals (case_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_trust_buyer_risk_signals_tx_created
  ON trust_buyer_risk_signals (transaction_id, created_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS trust_dispute_preemption_actions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id INTEGER NOT NULL,
  transaction_id TEXT NOT NULL,
  action_type TEXT NOT NULL CHECK (
    action_type IN (
      'proactive_evidence_prompt',
      'milestone_confirmation_nudge',
      'conditional_hold_checkpoint',
      'conditional_release_checkpoint',
      'verification_step_up',
      'transaction_velocity_control',
      'temporary_settlement_delay',
      'preemption_unwind'
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
  FOREIGN KEY (rollback_of_action_id) REFERENCES trust_dispute_preemption_actions(id)
);

CREATE INDEX IF NOT EXISTS idx_trust_dispute_preemption_actions_case_created
  ON trust_dispute_preemption_actions (case_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_trust_dispute_preemption_actions_tx_created
  ON trust_dispute_preemption_actions (transaction_id, created_at DESC, id DESC);

COMMIT;
