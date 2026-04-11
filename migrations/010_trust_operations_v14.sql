ALTER TABLE trust_assessments
  ADD COLUMN explainability_json TEXT NOT NULL DEFAULT '{}';

ALTER TABLE trust_assessments
  ADD COLUMN identity_friction_json TEXT NOT NULL DEFAULT '{}';

ALTER TABLE trust_assessments
  ADD COLUMN post_incident_verification_json TEXT NOT NULL DEFAULT '{}';

ALTER TABLE trust_interventions
  ADD COLUMN identity_friction_json TEXT NOT NULL DEFAULT '{}';

ALTER TABLE trust_interventions
  ADD COLUMN post_incident_verification_json TEXT NOT NULL DEFAULT '{}';
