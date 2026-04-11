ALTER TABLE trust_assessments
  ADD COLUMN account_takeover_containment_json TEXT NOT NULL DEFAULT '{}';

ALTER TABLE trust_assessments
  ADD COLUMN settlement_risk_stress_controls_json TEXT NOT NULL DEFAULT '{}';

ALTER TABLE trust_assessments
  ADD COLUMN policy_canary_governance_json TEXT NOT NULL DEFAULT '{}';

ALTER TABLE trust_interventions
  ADD COLUMN account_takeover_containment_json TEXT NOT NULL DEFAULT '{}';

ALTER TABLE trust_interventions
  ADD COLUMN settlement_risk_stress_controls_json TEXT NOT NULL DEFAULT '{}';

ALTER TABLE trust_interventions
  ADD COLUMN policy_canary_governance_json TEXT NOT NULL DEFAULT '{}';
