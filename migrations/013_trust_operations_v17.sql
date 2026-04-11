ALTER TABLE trust_assessments
  ADD COLUMN cross_market_collusion_interdiction_json TEXT NOT NULL DEFAULT '{}';

ALTER TABLE trust_assessments
  ADD COLUMN escrow_integrity_attestations_json TEXT NOT NULL DEFAULT '{}';

ALTER TABLE trust_assessments
  ADD COLUMN policy_blast_radius_simulation_json TEXT NOT NULL DEFAULT '{}';

ALTER TABLE trust_interventions
  ADD COLUMN cross_market_collusion_interdiction_json TEXT NOT NULL DEFAULT '{}';

ALTER TABLE trust_interventions
  ADD COLUMN escrow_integrity_attestations_json TEXT NOT NULL DEFAULT '{}';

ALTER TABLE trust_interventions
  ADD COLUMN policy_blast_radius_simulation_json TEXT NOT NULL DEFAULT '{}';
