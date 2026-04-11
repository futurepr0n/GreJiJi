BEGIN TRANSACTION;

ALTER TABLE trust_network_links RENAME TO trust_network_links_legacy_v9;

CREATE TABLE trust_network_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cluster_id TEXT NOT NULL,
  source_entity_key TEXT NOT NULL,
  target_entity_key TEXT NOT NULL,
  link_type TEXT NOT NULL CHECK (
    link_type IN (
      'account',
      'device',
      'payment_instrument',
      'interaction_pattern',
      'fulfillment_endpoint',
      'communication_fingerprint',
      'listing_interaction'
    )
  ),
  confidence_score INTEGER NOT NULL CHECK (confidence_score >= 0 AND confidence_score <= 100),
  propagated_risk_score INTEGER NOT NULL CHECK (propagated_risk_score >= 0 AND propagated_risk_score <= 100),
  decay_expires_at TEXT,
  evidence_json TEXT NOT NULL,
  policy_version_id INTEGER,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (policy_version_id) REFERENCES trust_ops_policy_versions(id)
);

INSERT INTO trust_network_links (
  id,
  cluster_id,
  source_entity_key,
  target_entity_key,
  link_type,
  confidence_score,
  propagated_risk_score,
  decay_expires_at,
  evidence_json,
  policy_version_id,
  created_by,
  created_at,
  updated_at
)
SELECT
  id,
  cluster_id,
  source_entity_key,
  target_entity_key,
  link_type,
  confidence_score,
  propagated_risk_score,
  decay_expires_at,
  evidence_json,
  policy_version_id,
  created_by,
  created_at,
  updated_at
FROM trust_network_links_legacy_v9;

DROP TABLE trust_network_links_legacy_v9;

CREATE INDEX IF NOT EXISTS idx_trust_network_links_cluster_updated
  ON trust_network_links (cluster_id, updated_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_trust_network_links_source_updated
  ON trust_network_links (source_entity_key, updated_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_trust_network_links_target_updated
  ON trust_network_links (target_entity_key, updated_at DESC, id DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_trust_network_links_unique_pair
  ON trust_network_links (source_entity_key, target_entity_key, link_type);

COMMIT;
