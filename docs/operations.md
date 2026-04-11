---
title: GreJiJi Operations Guide
author: PaperclipAI Documentation Expert
date: 2026-04-09
status: current
---

# GreJiJi Operations Guide

This guide covers local execution, testing, storage layout, and verification steps for the current service build.

## Local setup

```bash
npm install
npm start
```

The service listens on `http://0.0.0.0:3000` by default.

Primary local surfaces:

- API root: `GET /`
- HTML docs: `GET /docs`
- Web console: `GET /app`
- Health probe: `GET /health`
- Readiness probe: `GET /ready`
- Observability snapshot: `GET /metrics`

## Production launch runbook

### Deploy

1. Configure environment variables for the target environment:
   - staging: `STAGING_BASE_URL`, `STAGING_DATABASE_PATH`, `STAGING_AUTH_TOKEN_SECRET`, `STAGING_STRIPE_WEBHOOK_SECRET`, `STAGING_DEPLOY_COMMAND`, `STAGING_ROLLBACK_COMMAND`
   - production: `PRODUCTION_BASE_URL`, `PRODUCTION_DATABASE_PATH`, `PRODUCTION_AUTH_TOKEN_SECRET`, `PRODUCTION_STRIPE_WEBHOOK_SECRET`, `PRODUCTION_DEPLOY_COMMAND`, `PRODUCTION_ROLLBACK_COMMAND`
2. Validate deploy configuration and secrets:

```bash
npm run deploy:validate:staging
npm run deploy:validate:production
```

3. Run migration preflight (dry-run safety check on DB snapshot, verifies idempotency):

```bash
npm run deploy:migration-preflight
```

4. Run staged deployment:

```bash
npm run deploy:staging
npm run deploy:production
```

Expected outcomes for each deploy command:

- writes `.deploy-state/<env>.json` manifest
- snapshots DB to `.deploy-state/backups/<env>-<timestamp>.sqlite` when DB exists
- runs synthetic checks before and after rollout
- emits JSON events: `deploy.config.valid`, `migration.preflight.passed`, `synthetic.*`, and `deploy.succeeded`
- on post-deploy smoke failure, executes configured rollback command, restores DB snapshot, reruns synthetic checks, and emits `deploy.rolled_back`

### Rollback

1. Trigger rollback explicitly when needed:

```bash
npm run deploy:rollback:staging
npm run deploy:rollback:production
```

2. Confirm rollback signal in output (`rollback.succeeded`).
3. Re-run probes and synthetic checks:

```bash
npm run deploy:smoke
curl -sS http://localhost:3000/health
curl -sS http://localhost:3000/ready
```

### Incident triage

1. Confirm probe state:
   - `/health` down: process/runtime failure.
   - `/ready` down: dependency readiness failure (DB/path/env).
2. Review deploy script output for failing gate:
   - `deploy.config.invalid`: missing or placeholder deploy variables/secrets
   - `migration.preflight.*`: migration safety check failed
   - `synthetic.check.failed`: endpoint regression (health/auth/listing/transaction/dispute/webhook)
   - `deploy.failed` with `deploy.rolled_back`: rollout command or post-deploy checks failed, auto-rollback executed
3. Check structured logs (`stdout`) for `request.error` events with `requestId`.
4. Check optional error sink:

```bash
tail -n 100 ./data/error-events.log
```

5. Reproduce with `x-request-id` and use the same id to correlate request and error lines.

6. Pull observability snapshot and evaluate live SLOs:

```bash
curl -sS http://localhost:3000/metrics | jq '.slo.coreFlow'
curl -sS http://localhost:3000/metrics | jq '.counters[] | select(.name=="api.requests.total" and .labels.flow=="transaction.create")'
curl -sS http://localhost:3000/metrics | jq '.counters[] | select(.name=="webhook.stripe.processed_total")'
```

7. Estimate blast radius by correlation id:

```bash
curl -sS -H "x-correlation-id: incident-1234" http://localhost:3000/health
# then search logs for the same correlationId and requestId
```

8. Verify queue pressure and notification delivery health:

```bash
curl -sS http://localhost:3000/metrics | jq '.counters[] | select(.name|test("^notification\\.dispatch"))'
curl -sS http://localhost:3000/metrics | jq '.queue.notificationOutbox'
```

### Dispute operations checks

1. Open queue (admin auth): `GET /admin/disputes?filter=open`.
2. For each urgent dispute, inspect detail: `GET /admin/disputes/:transactionId`.
3. Confirm evidence presence and latest timestamps before adjudication.
4. Verify adjudication side effects in event timeline: `GET /transactions/:id/events`.

### Trust/reputation checks

1. Validate closure acknowledgements on completed transactions:
   - buyer closure: `POST /transactions/:transactionId/confirm-delivery`
   - seller closure acknowledgment: `POST /transactions/:transactionId/acknowledge-completion`
2. Verify rating flow state for participant and admin views:
   - `GET /transactions/:transactionId/ratings`
   - confirm `ratingsState` and `pendingBy` align with expected one-sided or dual-sided completion
3. Validate reputation aggregate reads:
   - `GET /users/:userId/reputation`
4. For anomalies:
   - duplicate rating attempts should return `409`
   - disputed/non-completed transactions should reject ratings with `409`
   - non-participant rating read/write should return `403`

### Admin web console workflow (`GET /app`)

Use the in-browser admin console for launch-day operations when you need audited actions without raw API tooling.

1. Sign in as an admin account in the Authentication panel.
2. Dispute queue workflow:
   - open **Admin Dispute Queue**
   - load queue by filter (`open`, `needs_evidence`, `awaiting_decision`, `resolved`)
   - open a case to hydrate transaction summary, evidence list, and event timeline
   - use **Resolve dispute** or **Adjudicate dispute** after confirmation prompts
3. Listing moderation workflow:
   - open **Admin Listing Moderation**
   - load queue by status (`pending_review`, `temporarily_hidden`, `rejected`, `approved`)
   - open listing detail to review moderation timeline and abuse reports
   - apply `approve`, `reject`, `hide`, or `unhide` with reason/public reason/operator notes
4. High-risk transaction interventions:
   - open **Admin Risk Interventions**
   - load transaction risk detail (`riskScore`, `riskLevel`, signals, operator actions)
   - apply `hold` or `unhold` with required reason and operator notes
5. Validate each action by checking:
   - inline status line in the panel (success/failure)
   - Activity log entry
   - refreshed detail timeline/action history

### Launch-control rollout and rollback workflow

1. Inspect current launch-control state:
   - UI: **Launch Control** panel in `GET /app`
   - API: `GET /admin/launch-control/flags`
2. Toggle rollout controls safely for risky capabilities:
   - `POST /admin/launch-control/flags/transaction_initiation`
   - `POST /admin/launch-control/flags/payout_release`
   - `POST /admin/launch-control/flags/dispute_auto_transitions`
   - `POST /admin/launch-control/flags/moderation_auto_actions`
3. For canary rollout, use both:
   - `rolloutPercentage` (`0..100`) for percentage cohorts
   - `allowlistUserIds` / `regionAllowlist` for explicit cohorts
4. Verify complete auditability:
   - `GET /admin/launch-control/audit?key=<flag>`
   - include `reason`, `deploymentRunId`, and correlation metadata on all changes
5. Trigger automated rollback hook during incidents:
   - `POST /jobs/launch-control/auto-rollback`
   - when thresholds are breached (burn-rate, error-rate, webhook failures), configured flags are disabled and incident context is persisted
6. Review incident history:
   - `GET /admin/launch-control/incidents`

### Payment webhook and reconciliation checks

1. Ensure Stripe webhook secret is configured (`STRIPE_WEBHOOK_SECRET`).
2. Send a signed test webhook to `POST /webhooks/stripe`.
3. Inspect webhook audit rows: `GET /admin/payment-webhooks?status=failed`.
4. Replay failed events when needed: `POST /admin/payment-webhooks/:eventRowId/reprocess`.
5. Run reconciliation correction job: `POST /jobs/payment-reconciliation`.

### Fraud-control investigation and intervention flow

1. Pull high-risk signals for the target case:
   - `GET /admin/risk-signals?transactionId=:transactionId`
   - `GET /admin/risk-signals?userId=:userId`
2. Capture request lineage:
   - read `x-correlation-id` and `x-request-id` from suspicious responses
   - match those IDs in structured logs (`request.complete`/`request.error`)
3. Inspect transaction-level risk state and action history:
   - `GET /admin/transactions/:transactionId/risk`
   - `GET /admin/accounts/:userId/risk`
   - `GET /admin/accounts/:userId/risk/limits?checkpoint=transaction_initiation`
   - `GET /admin/accounts/:userId/risk/limits?checkpoint=payout_release`
4. If immediate containment is needed, hold progression:
   - `POST /admin/transactions/:transactionId/risk/hold`
5. Apply account controls when abuse scope is user-level:
   - `POST /admin/accounts/:userId/risk/flag`
   - `POST /admin/accounts/:userId/risk/require-verification`
   - `POST /admin/accounts/:userId/risk/override-tier`
6. Identity verification review loop:
   - user submits: `POST /accounts/me/verification-submissions`
   - queue review: `GET /admin/verification-submissions?status=pending`
   - approve/reject: `POST /admin/accounts/:userId/verification/approve` or `.../reject`
7. After review and remediation, resume flow:
   - `POST /admin/transactions/:transactionId/risk/unhold`
   - `POST /admin/accounts/:userId/risk/unflag`
   - `POST /admin/accounts/:userId/risk/clear-verification`
   - `POST /admin/accounts/:userId/risk/clear-tier-override`
8. Confirm settlement progression still behaves correctly:
   - participant retries `POST /transactions/:transactionId/confirm-delivery`
   - verify terminal state via `GET /transactions/:transactionId`

### Trust-operations v6 queue workflow

1. Run continuous policy sweep (admin):
   - `POST /jobs/trust-operations/recompute` (supports `policyVersionId` + cohort targeting)
2. Review trust-ops queue and case audit:
   - `GET /admin/trust-operations/cases?status=in_review`
   - `GET /admin/trust-operations/cases/:caseId`
   - `GET /admin/accounts/:userId/integrity`
3. Manage policy versions and run safe replay before activation:
   - create/list: `POST|GET /admin/trust-operations/policies`
   - activate: `POST /admin/trust-operations/policies/:policyVersionId/activate`
   - replay/backtest (includes payout-action deltas): `POST /admin/trust-operations/backtest`
   - dry-run simulator: `POST /admin/trust-operations/simulate-policy`
4. Run investigator workflow:
   - assign: `POST /admin/trust-operations/cases/:caseId/assign`
   - claim: `POST /admin/trust-operations/cases/:caseId/claim`
   - notes: `POST /admin/trust-operations/cases/:caseId/notes`
5. Resolve queue items with reason-coded actions:
   - approve recommendation: `POST /admin/trust-operations/cases/:caseId/approve`
   - override recommendation: `POST /admin/trust-operations/cases/:caseId/override`
   - clear and resolve case: `POST /admin/trust-operations/cases/:caseId/clear`
   - intervention preview (v10): `GET /admin/trust-operations/cases/:caseId/intervention-preview`
   - evidence export (v10): `POST /admin/trust-operations/cases/:caseId/evidence-bundle/export`
   - bulk actions with audit fan-out: `POST /admin/trust-operations/cases/bulk-action`
6. Capture tuning feedback and validate telemetry:
   - feedback ingestion: `POST /admin/trust-operations/feedback`
   - dashboard: `GET /admin/trust-operations/dashboard`
   - payout-risk metrics: `GET /admin/trust-operations/payout-risk/metrics`
   - network investigation: `GET /admin/trust-operations/network/investigation`
   - network signal ingestion: `POST /admin/trust-operations/network/signals`
   - cluster action preview/apply: `POST /admin/trust-operations/cases/:caseId/cluster-preview` and `.../cluster-apply`
   - recovery queue: `GET /admin/trust-operations/recovery/queue`
   - recovery processor: `POST /jobs/trust-operations/recovery/process`
   - recommendations: `GET /admin/trust-operations/policy-recommendations`
   - `GET /metrics | jq '.trustOperations'`
   - `GET /metrics | jq '.queue.trustOperations'`

### Trust-operations v7 arbitration and guardrail workflow

1. Validate fulfillment-proof integrity during dispute evidence intake:
   - `POST /transactions/:transactionId/disputes/evidence`
   - inspect `evidence.integrity` in response (`metadataConsistencyScore`, duplicate/replay flags, anomaly score)
2. Use dispute detail tooling for side-by-side evidence and arbitration review:
   - `GET /admin/disputes/:transactionId`
   - review `evidenceComparison`, `arbitrationTimeline`, and `finalDecisionActions`
3. Run escrow arbitration release job:
   - `POST /jobs/auto-release`
   - confirm split between `releasedTransactionIds`, `delayedTransactionIds`, and `manualReviewTransactionIds`
4. Require reason-coded adjudication decisions:
   - `POST /transactions/:transactionId/disputes/adjudicate`
   - include `reasonCode`, and verify `decisionTransparency` payload (next actions + appeal window)
5. Monitor policy-experiment guardrails:
   - `POST /jobs/trust-operations/recompute`
   - inspect `guardrails` in response for kill-switch/rollback state
   - verify dashboard telemetry at `GET /admin/trust-operations/dashboard` includes `metrics.policyGuardrails`

### Trust-operations v8 identity-gating and account-recovery workflow

1. Inspect identity-assurance posture before intervention:
   - `GET /admin/accounts/:userId/identity-assurance`
2. Create and resolve case-linked step-up challenges:
   - create challenge: `POST /admin/trust-operations/cases/:caseId/challenges`
   - resolve challenge outcome: `POST /admin/trust-operations/challenges/:challengeId/resolve`
   - review immutable challenge timeline: `GET /admin/trust-operations/cases/:caseId/challenges`
3. Execute staged account-compromise recovery with approvals:
   - start lockdown: `POST /admin/accounts/:userId/recovery/start`
   - advance stage (operator approval checkpoint): `POST /admin/accounts/:userId/recovery/approve-stage`
   - inspect active/history state: `GET /admin/accounts/:userId/recovery`
4. Validate v8 telemetry:
   - `GET /admin/trust-operations/dashboard`
   - confirm `metrics.identityGating` and `metrics.accountRecovery`

### Trust-operations v9 collusion graph and preemptive dispute workflow

1. Ingest cross-account collusion signals:
   - `POST /admin/trust-operations/network/signals`
   - supported link types include `device`, `payment_instrument`, `fulfillment_endpoint`, `communication_fingerprint`, and `listing_interaction`
2. Recompute policy with v9 controls enabled:
   - `POST /jobs/trust-operations/recompute`
   - verify case `payoutDecision.preemptiveDisputeControls` includes shipment confirmation and payout progression controls
3. Investigate graph-backed cluster context:
   - `GET /admin/trust-operations/network/investigation?transactionId=:id`
   - review `graph`, `linkedCaseExpansion`, and `interventionRationaleCards`
4. Apply coordinated cluster mitigation:
   - preview: `POST /admin/trust-operations/cases/:caseId/cluster-preview`
   - apply: `POST /admin/trust-operations/cases/:caseId/cluster-apply`
   - confirm account risk controls were throttled and audit actions persisted
5. Track v9 telemetry:
   - `GET /admin/trust-operations/dashboard`
   - confirm `metrics.preemptiveDisputeControls` rates and delay metrics

### Trust-operations v10 proactive interdiction and remediation workflow

1. Enable v10 controls in policy and activate:
   - create/update policy with `v10Enabled=true` and v10 thresholds
   - `POST /admin/trust-operations/policies/:policyVersionId/activate`
2. Run recompute to generate case-level interdiction decisions:
   - `POST /jobs/trust-operations/recompute`
   - verify `payoutDecision.listingAuthenticityForensics`, `scamRingInterdiction`, and `remediationPlan`
3. Validate machine/human intervention boundaries before manual override:
   - `GET /admin/trust-operations/cases/:caseId/intervention-preview`
4. Export case evidence bundle for audit/review handoff:
   - `POST /admin/trust-operations/cases/:caseId/evidence-bundle/export`
   - confirm payload includes `decisionBoundary`, forensics signals, and remediation timeline
5. Execute false-positive unwind and rollback validation:
   - `POST /admin/trust-operations/cases/:caseId/clear` with `reasonCode=false_positive_after_review`
   - verify remediation actions move to `rolled_back` and unwind actions are appended immutably
6. Track v10 telemetry:
   - `GET /admin/trust-operations/dashboard`
   - confirm `metrics.interdictionV10` (rollback rate, action counts, authenticity signal score)

### Listing moderation workflow and launch safety SLA

Moderation states:

- `approved`: visible in public listing feeds.
- `pending_review`: hidden from public feeds until operator decision.
- `rejected`: blocked from public feeds; seller receives actionable feedback.
- `temporarily_hidden`: removed from public feeds pending investigation.

Operator flow:

1. Pull queue: `GET /admin/listings/moderation?status=pending_review`.
2. Open listing detail with evidence and history: `GET /admin/listings/:listingId/moderation`.
3. Take an action:
   - approve: `POST /admin/listings/:listingId/moderation/approve`
   - reject: `POST /admin/listings/:listingId/moderation/reject`
   - hide: `POST /admin/listings/:listingId/moderation/hide`
   - unhide after remediation: `POST /admin/listings/:listingId/moderation/unhide`
4. Confirm moderation audit events were persisted in detail response (`events[]`).

Abuse report intake:

- users submit `POST /listings/:listingId/abuse-reports`.
- when open reports for a listing reach `LISTING_ABUSE_AUTO_HIDE_THRESHOLD` (default `3`), the listing auto-transitions to `temporarily_hidden`.

SLA targets:

- high-risk/prohibited-content queue items: first response within 15 minutes.
- standard pending-review queue items: first response within 4 hours.
- abuse-threshold auto-hidden listings: adjudication within 60 minutes.

Escalation and false-positive recovery:

1. If moderation queue backlog exceeds SLA, escalate to on-call admin and prioritize `temporarily_hidden` and `rejected` reversals.
2. For false positives, use `POST /admin/listings/:listingId/moderation/unhide` with operator notes.
3. For policy-rule tuning, adjust:
   - `LISTING_POLICY_BLOCKED_KEYWORDS`
   - `LISTING_POLICY_PRICE_HIGH_MULTIPLIER`
   - `LISTING_POLICY_PRICE_LOW_MULTIPLIER`
   - `LISTING_POLICY_PRICE_BASELINE_MIN_SAMPLES`
4. Recheck public visibility by querying `GET /listings` after the unhide action.

## Performance and scaling knobs

Use these controls when latency rises during browse/transaction/webhook bursts:

- listing read cache:
  - `LISTINGS_CACHE_TTL_MS` (default `1500`)
  - `LISTINGS_CACHE_MAX_ENTRIES` (default `64`)
- transaction summary cache:
  - `TRANSACTION_CACHE_TTL_MS` (default `750`)
  - `TRANSACTION_CACHE_MAX_ENTRIES` (default `512`)
- notification queue backpressure:
  - `NOTIFICATION_DISPATCH_DEFAULT_LIMIT` (default `100`)
  - `NOTIFICATION_DISPATCH_HARD_LIMIT` (default `250`)
  - `NOTIFICATION_DISPATCH_DEFAULT_MAX_PROCESSING_MS` (default `300`)
- reconciliation sweep size:
  - `PAYMENT_RECONCILIATION_DEFAULT_LIMIT` (default `100`)
  - `PAYMENT_RECONCILIATION_HARD_LIMIT` (default `300`)

Recommended degradation actions:

1. If `queue.notificationOutbox.pendingOrFailed` grows while core p95 rises, reduce dispatch batch/time budget first, then run dispatch more frequently.
2. If browse p95 rises under read-heavy traffic, increase listing cache TTL gradually (for example `1500 -> 3000`) and monitor stale-data tolerance.
3. If transaction summary p95 rises without correctness issues, increase transaction cache TTL modestly (`750 -> 1500`) and confirm write invalidation paths stay deterministic.

## Reproducible mixed-load scenario

Run the benchmark harness that exercises browse + transaction reads + webhook + dispute queue:

```bash
npm run test:load
```

The script prints JSON with per-scenario `p95Ms`, `p99Ms`, error rate, core-flow SLO, queue depth, and cache hit/miss counters.

## Verification checklist

> [!NOTE]
> The current automated verification source of truth is `node --test`.

### Release gate (local and CI parity)

Run all gate stages locally before merge:

```bash
npm run test:unit
npm run test:integration
npm run test:e2e
```

Expected runtime baseline:

- unit: under 5 seconds
- integration: under 10 seconds
- e2e: around 5 to 6 minutes
- full gate: around 6 minutes

CI gate workflow:

- `.github/workflows/release-gate.yml`
- requires passing `Unit Tests`, `Integration Tests`, and `E2E Transactional Suite`
- uploads stage logs as artifacts:
  - `unit-test-artifacts` -> `artifacts/unit/test.log`
  - `integration-test-artifacts` -> `artifacts/integration/test.log`
  - `e2e-test-artifacts` -> `artifacts/e2e/test.log`

Deployment pipeline workflow:

- `.github/workflows/deploy-pipeline.yml`
- runs release gate, then `staging` deploy gates, then `production` deploy gates
- uploads `.deploy-state` as workflow artifacts for both environments

### Release gate failure triage

1. Open the failing GitHub Actions run and download the matching stage artifact.
2. Identify the first failing test/subtest in `test.log`.
3. Use the failure class below to narrow root cause quickly:
   - auth or listing failures: inspect auth middleware and listing role checks in `src/server.js`
   - settlement/transaction branch failures: inspect state transition writes in `src/db.js`
   - webhook/reconciliation failures: inspect Stripe signature, dedupe, and replay handlers in `src/server.js` plus provider adapter behavior in `src/payment-provider.js`
4. Re-run only the failing stage locally, then run full `npm test` before pushing.

1. Start the app with a clean SQLite path.
2. Open `GET /docs` and confirm the HTML reference loads.
3. Open `GET /app` and confirm the browser console loads its shell and assets.
4. Run `npm test`.
5. Exercise at least one auth, listing, transaction, and inbox flow if doing manual QA.

## Persistence model

Primary tables created by migrations:

- `users`
- `listings`
- `transactions`
- `transaction_events`
- `notification_outbox`
- `user_notifications`
- `dispute_evidence`
- `payment_operations`
- `provider_webhook_events`
- `risk_signals`
- `risk_operator_actions`
- `dispute_evidence_integrity`
- `fulfillment_proofs`
- `trust_policy_guardrail_events`
- `schema_migrations`

Runtime file storage:

- dispute evidence files are written beneath `EVIDENCE_STORAGE_PATH`
- local generated files under `data/` are runtime artifacts and should not be committed

## Useful local inspection commands

```bash
sqlite3 ./data/grejiji.sqlite "SELECT id, transaction_id, event_type, actor_id, occurred_at FROM transaction_events ORDER BY occurred_at, id;"
sqlite3 ./data/grejiji.sqlite "SELECT id, transaction_id, topic, recipient_user_id, status, attempt_count, next_retry_at, sent_at, failed_at FROM notification_outbox ORDER BY id;"
sqlite3 ./data/grejiji.sqlite "SELECT id, recipient_user_id, transaction_id, topic, status, created_at, read_at, acknowledged_at FROM user_notifications ORDER BY id;"
sqlite3 ./data/grejiji.sqlite "SELECT id, provider, event_id, event_type, transaction_id, status, delivery_count, processing_attempts, processing_error, processed_at FROM provider_webhook_events ORDER BY id;"
sqlite3 ./data/grejiji.sqlite "SELECT id, transaction_id, user_id, signal_type, severity, correlation_id, request_id, created_at FROM risk_signals ORDER BY id DESC;"
sqlite3 ./data/grejiji.sqlite "SELECT id, subject_type, subject_id, action_type, actor_id, reason, correlation_id, request_id, created_at FROM risk_operator_actions ORDER BY id DESC;"
curl -sS http://localhost:3000/metrics | jq '.flowLatency'
```

## Observability tuning knobs

- `CORE_FLOW_SLO_AVAILABILITY_TARGET` default `0.995`
- `CORE_FLOW_SLO_P95_MS_TARGET` default `1200`
- `CORE_FLOW_SLO_BURN_RATE_ALERT_THRESHOLD` default `2`

## Release-sensitive behavior

- Payout release is one-time only.
- Service-fee accounting is captured immutably at transaction creation.
- Auto-release only acts on `accepted` transactions past the configured deadline.
- Open disputes prevent auto-release.
- Adjudication writes both dispute and settlement events.
- Final settlement snapshots (`settledBuyerCharge`, `settledSellerPayout`, `settledPlatformFee`) are immutable once set.
- Notification dispatch retries use incremental backoff and leave retry metadata in `notification_outbox`.

## Test coverage currently included

- health endpoint
- docs route and web-app shell/assets
- auth success and rejection paths
- protected-route enforcement
- seller-only listing authorization
- dispute authorization
- admin-only adjudication and auto-release
- event timeline and outbox writes
- service-fee accounting and immutable settlement snapshots
- dispute evidence upload/list/download
- admin dispute queue and detail APIs
- notification dispatch, inbox delivery, read, acknowledge, and retry behavior
- Stripe webhook signature validation failure handling
- duplicate and out-of-order webhook delivery idempotency
- reconciliation correction of payment-status drift
- failed webhook inspection and replay workflow
