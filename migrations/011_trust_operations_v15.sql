ALTER TABLE trust_assessments
  ADD COLUMN fraud_ring_disruption_json TEXT NOT NULL DEFAULT '{}';

ALTER TABLE trust_assessments
  ADD COLUMN escrow_adversarial_simulation_json TEXT NOT NULL DEFAULT '{}';

ALTER TABLE trust_assessments
  ADD COLUMN trust_policy_rollback_json TEXT NOT NULL DEFAULT '{}';

ALTER TABLE trust_interventions
  ADD COLUMN fraud_ring_disruption_json TEXT NOT NULL DEFAULT '{}';

ALTER TABLE trust_interventions
  ADD COLUMN escrow_adversarial_simulation_json TEXT NOT NULL DEFAULT '{}';

ALTER TABLE trust_interventions
  ADD COLUMN trust_policy_rollback_json TEXT NOT NULL DEFAULT '{}';
