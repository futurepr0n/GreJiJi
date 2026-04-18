---
title: GreJiJi Operations Guide
author: PaperclipAI Documentation Expert
date: 2026-04-18
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

Storage roots used by the current build:

- SQLite DB: `DATABASE_PATH` (default `./data/grejiji.sqlite`)
- Dispute evidence: `EVIDENCE_STORAGE_PATH` (default `./data/dispute-evidence`)
- Listing photos: `LISTING_PHOTO_STORAGE_PATH` (default `./data/listing-photos`)

> [!NOTE]
> Listing photo uploads are stored on disk outside SQLite. Backups and restore drills need both the database file and the `listing-photos` directory to preserve listing media integrity.

## Demo auth and seed dataset runbook

Use this runbook for local walkthroughs of the auth modal and role-specific demo flows in `GET /app`.

### Seed controls

- `DEMO_SEED_ENABLED` defaults to `true` when `NODE_ENV` is not `test`
- `DEMO_SEED_PASSWORD` defaults to `DemoMarket123!`
- seeding only runs when `DATABASE_PATH` resolves to the default DB path (`./data/grejiji.sqlite`)
- bootstrap is idempotent for users + history; seeded listings are refreshed on each run to match the current demo catalog

### Seeded accounts

- `demo-admin@grejiji.demo` (role `admin`)
- `demo-buyer@grejiji.demo` (role `buyer`)
- `demo-seller-01@grejiji.demo` ... `demo-seller-10@grejiji.demo` (role `seller`)
- password: `DemoMarket123!` unless overridden via `DEMO_SEED_PASSWORD`

### Seeded retro listing catalog

The default seed catalog contains 10 active retro game listings (`demo-listing-01` through `demo-listing-10`) with two image URLs each (box art + gameplay snapshot):

- Chrono Trigger (SNES) CIB
- Donkey Kong Country (SNES)
- F-Zero (SNES)
- EarthBound (SNES) Cart
- Final Fantasy III (SNES)
- Pokemon Blue Version (Game Boy)
- Tetris (Game Boy)
- Kirby's Dream Land (Game Boy)
- Golden Axe (Genesis)
- Super Mario 64 (Nintendo 64)

### Local walkthrough

1. Start from a clean default local DB (optional but recommended for deterministic demos):

```bash
rm -f ./data/grejiji.sqlite
```

2. Start the service with demo seeding enabled:

```bash
DEMO_SEED_ENABLED=true npm start
```

3. Open the web console at `http://localhost:3000/app`.
4. Use the header button `Sign in / Register` to open the auth modal, or use one-click quick-login in the `Demo Access` panel.
5. Validate role-specific behavior:
   - seller: create listing and upload photo
   - buyer: browse seeded listings and confirm list thumbnails + listing-detail gallery images render inline
   - buyer: create transaction and confirm delivery
   - admin: inspect dispute queue, moderation, and risk controls

> [!TIP]
> Demo quick-login buttons only prefill the login form and open the modal. Submit the login form to authenticate and switch the UI into role-aware mode.

> [!NOTE]
> To refresh stale demo listing content in an existing default DB, restart the service with `DEMO_SEED_ENABLED=true`. Seed users and completed history remain stable while `demo-listing-*` entries are updated to the current retro catalog payload.

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

### Jenkins pipeline provisioning runbook

Use this when provisioning CI/CD in Jenkins instead of GitHub Actions-hosted deploy orchestration.

1. Export required Jenkins API + repo settings:

```bash
export JENKINS_BASE_URL="https://ci.example.com"
export JENKINS_USER="ci-user"
export JENKINS_TOKEN="<api-token>"
export JENKINS_REPO_URL="https://github.com/futurepr0n/GreJiJi"
```

2. Provision (or refresh) the pipeline job:

```bash
npm run jenkins:provision
```

3. Confirm script output includes one of:
   - `Created job: GreJiJi`
   - `Updated job: GreJiJi`
   - `Triggered build: GreJiJi`

4. Configure Jenkins deploy environment variables (Manage Jenkins -> System -> Global properties or per-job environment):
   - `APP_HOST_PORT` (required host port binding, for example `3333`)
   - `APP_CONTAINER_PORT` (defaults to `3000`)
   - `APP_SERVICE_NAME` (defaults to `api`)
   - `ALLOW_PORT_FALLBACK` (defaults to `1` in Jenkinsfile; when enabled, deploy script scans the next 50 host ports if `APP_HOST_PORT` is already occupied)
   - `ROLLBACK_SIMULATION_ENABLED` (defaults to `true` in Jenkinsfile; controls whether the rollback simulation stage runs)
   - `AUTH_TOKEN_SECRET` (required Jenkins runtime secret, must not be placeholder)
     - Jenkinsfile defines this as a masked `password` build parameter
     - runtime precedence is: build parameter `AUTH_TOKEN_SECRET` -> environment `AUTH_TOKEN_SECRET` -> empty string (validation failure)
     - recommended setup: provide the value in `Build with Parameters`, or inject from Jenkins credentials to env before running deploy
   - when `PAYMENT_PROVIDER=stripe`: `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` are required

5. Deploy-stage verification behavior (`scripts/jenkins/deploy-docker.sh`):
   - validates Jenkins context (`JENKINS_URL`, `JOB_NAME`, `BUILD_NUMBER`) and Docker Compose config
   - validates host/container port values and blocks invalid port mappings before deploy
   - verifies deployed container publishes the expected port binding
   - probes `http://127.0.0.1:$APP_HOST_PORT/health` until healthy
   - captures current container image as rollback tag and restores it automatically when deploy or health checks fail
   - rollback tag derivation strips any existing tag from `APP_IMAGE_REF` before appending `:rollback-<build>` (fix tracked in [GREAA-136](/GREAA/issues/GREAA-136))
   - concrete mapping example for tagged refs:
     - old invalid output: `grejiji-api:local:rollback-123`
     - current valid output: `grejiji-api:rollback-123`

Build trigger notes for `AUTH_TOKEN_SECRET`:

1. Open Jenkins job `GreJiJi` and select `Build with Parameters`.
2. Enter a non-placeholder secret value for `AUTH_TOKEN_SECRET`.
3. Start the build; Jenkins masks the parameter value in UI/log output.
4. If the parameter is left empty, deploy falls back to environment `AUTH_TOKEN_SECRET`; if both are empty, deploy gate fails.

6. Rollback simulation gate behavior (`Jenkinsfile` stage `Rollback Simulation Gate`):
   - stage runs when `DEPLOY_ENABLED=true` and `ROLLBACK_SIMULATION_ENABLED=true`
   - it intentionally forces a health-probe failure and expects deploy rollback to execute
   - rollback health verification uses `ROLLBACK_HEALTHCHECK_PATH` (default `/health`) so rollback checks are not affected by the forced simulation probe
   - expected success signal is a failed deploy command plus both rollback markers in logs:

```bash
set +e
HEALTHCHECK_PATH="/__force_rollback_probe__" ./scripts/jenkins/deploy-docker.sh > rollback-simulation.log 2>&1
status=$?
set -e

cat rollback-simulation.log
test "$status" -ne 0
grep -q "Attempting rollback to previous image" rollback-simulation.log
grep -q "Rollback succeeded and service is healthy." rollback-simulation.log
```

Effective defaults used by `scripts/jenkins/provision-job.sh`:

- `JENKINS_FOLDER` -> empty (root-level Jenkins job, no folder)
- `JENKINS_JOB` -> `GreJiJi`
- `JENKINS_BRANCH` -> `*/main`
- `JENKINS_SCRIPT_PATH` -> `Jenkinsfile`
- `JENKINS_GIT_CREDENTIALS_ID` -> empty

Migration notes from legacy folder jobs (`GreJiJi/deploy`):

- keep legacy folder structure:

```bash
JENKINS_FOLDER="GreJiJi" JENKINS_JOB="deploy" npm run jenkins:provision
```

- migrate to root-level default:

```bash
unset JENKINS_FOLDER
JENKINS_JOB="GreJiJi" npm run jenkins:provision
```

> [!TIP]
> The provisioning script is idempotent. Re-running it updates the job XML and retriggers a build, so it is safe to use after Jenkinsfile or branch/default changes.

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

Jenkins Docker rollback verification (on-host):

```bash
docker compose --env-file .env -f docker-compose.yml ps api
docker compose --env-file .env -f docker-compose.yml logs --tail=200 api
curl -sS -o /dev/null -w "%{http_code}\n" "http://127.0.0.1:${APP_HOST_PORT}/health"
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
   - `[deploy-docker] ERROR: ...`: Jenkins Docker gate failure (env validation, port binding mismatch, health probe timeout, or rollback failure)
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

9. If listing images appear broken, verify photo storage separately from DB health:

```bash
find "${LISTING_PHOTO_STORAGE_PATH:-./data/listing-photos}" -maxdepth 2 -type f | head
du -sh "${LISTING_PHOTO_STORAGE_PATH:-./data/listing-photos}"
```

Rollback-simulation specific triage and safe rerun:

```bash
# verify the simulation gate is enabled for this Jenkins build context
echo "ROLLBACK_SIMULATION_ENABLED=${ROLLBACK_SIMULATION_ENABLED:-true}"
echo "ALLOW_PORT_FALLBACK=${ALLOW_PORT_FALLBACK:-1}"

# run the same simulation locally/on Jenkins executor with explicit defaults
ALLOW_PORT_FALLBACK="${ALLOW_PORT_FALLBACK:-1}" \
ROLLBACK_SIMULATION_ENABLED="${ROLLBACK_SIMULATION_ENABLED:-true}" \
HEALTHCHECK_PATH="/__force_rollback_probe__" \
bash ./scripts/jenkins/deploy-docker.sh 2>&1 | tee /tmp/grejiji-rollback-simulation.log

# required rollback-proof markers
grep -F "Attempting rollback to previous image" /tmp/grejiji-rollback-simulation.log
grep -F "Rollback succeeded and service is healthy." /tmp/grejiji-rollback-simulation.log
```

- Optional override for rollback health path (defaults to `/health`):

```bash
ROLLBACK_HEALTHCHECK_PATH="/health" \
HEALTHCHECK_PATH="/__force_rollback_probe__" \
bash ./scripts/jenkins/deploy-docker.sh 2>&1 | tee /tmp/grejiji-rollback-simulation.log
```

- If the simulation must be bypassed temporarily to unblock an urgent deploy, set `ROLLBACK_SIMULATION_ENABLED=false` for that run and capture justification in the build notes.
- To rerun safely, prefer `ALLOW_PORT_FALLBACK=1`; if disabled, set a free `APP_HOST_PORT` explicitly before retrying.

Jenkins deploy-docker triage commands (run on the Jenkins executor/host in repo root):

```bash
set -o pipefail
bash -x ./scripts/jenkins/deploy-docker.sh 2>&1 | tee /tmp/grejiji-deploy-docker.log
docker compose --env-file .env -f docker-compose.yml ps
docker compose --env-file .env -f docker-compose.yml logs --tail=200 "${APP_SERVICE_NAME:-api}"
grep -F "[deploy-docker] ERROR:" /tmp/grejiji-deploy-docker.log
```

Exact failure signatures emitted by `scripts/jenkins/deploy-docker.sh`:

- `APP_HOST_PORT must be explicitly set.`
- `APP_HOST_PORT must be a valid port (1-65535).`
- `APP_CONTAINER_PORT must be a valid port (1-65535).`
- `JENKINS_URL is required for Jenkins deploy jobs.`
- `JOB_NAME is required for Jenkins deploy jobs.`
- `BUILD_NUMBER is required for Jenkins deploy jobs.`
- `Required credential '<KEY>' is missing or uses a placeholder value.`
- `STRIPE_SECRET_KEY is required when PAYMENT_PROVIDER=stripe.`
- `STRIPE_WEBHOOK_SECRET is required when PAYMENT_PROVIDER=stripe.`
- `Host port <PORT> is already in use. Set APP_HOST_PORT or enable ALLOW_PORT_FALLBACK=1.`
- `Container <CONTAINER_ID> does not publish <APP_CONTAINER_PORT>/tcp.`
- `Expected host port <APP_HOST_PORT>, got '<published-port>'.`
- `Rollback requested but no previous image reference is available.`
- `Rollback failed: service container is not running.`
- `Rollback completed but service failed health checks.`
- `Deployment failed and rollback was applied.`
- `Deployment failed: port verification failed; rollback was applied.`
- `Deployment failed: health verification failed; rollback was applied.`

10. Confirm listing API payloads still expose both image surfaces:

```bash
curl -sS http://localhost:3000/listings | jq '.listings[] | {id, photoUrls, uploadedPhotos}'
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
   - open listing detail to review moderation timeline, abuse reports, external `photoUrls`, and uploaded image links
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

### Listing photo verification workflow

Use this after deploys that touch listing creation, moderation, storage paths, or the seller console.

1. Create a seller listing with external image URLs:
   - `POST /listings` with `photoUrls`
2. Upload at least one binary image:
   - `POST /listings/:listingId/photos`
   - body must be JSON with `fileName`, `mimeType`, and `contentBase64`
3. Confirm the returned payload includes:
   - `listing.photoUrls`
   - `listing.uploadedPhotos[]`
   - `photo.downloadUrl`
4. Validate read-path behavior:
   - approved listing: anonymous `GET /listings/:listingId/photos/:photoId` should return bytes
   - non-approved listing: only the seller or an admin should be able to fetch the uploaded file
5. Check on-disk persistence:

```bash
find "${LISTING_PHOTO_STORAGE_PATH:-./data/listing-photos}/<listing-id>" -maxdepth 1 -type f
```

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
   - evidence export (v17 bundle): `POST /admin/trust-operations/cases/:caseId/evidence-bundle/export`
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
   - confirm payload includes `contextBundles.assessment|intervention|dispute` plus `integrityMetadata.bundleHashSha256` and `checkpointLinkage`
5. Execute false-positive unwind and rollback validation:
   - `POST /admin/trust-operations/cases/:caseId/clear` with `reasonCode=false_positive_after_review`
   - verify remediation actions move to `rolled_back` and unwind actions are appended immutably
6. Track v10 telemetry:
   - `GET /admin/trust-operations/dashboard`
   - confirm `metrics.interdictionV10` (rollback rate, action counts, authenticity signal score)

### Trust-operations v17 evidence-bundle export verification

Use this flow when an operator needs a handoff-grade export for incident review, legal escalation, or external forensic retention.

1. Export the case bundle:

```bash
curl -sS -X POST http://localhost:3000/admin/trust-operations/cases/<case-id>/evidence-bundle/export \
  -H "Authorization: Bearer <admin-token>" \
  -H "Content-Type: application/json" \
  -d '{
    "requireDisputeArtifacts": true,
    "expectedBundleHashSha256": "<known-bundle-hash>",
    "artifactHashAssertions": [
      {
        "artifactType": "dispute_evidence",
        "artifactId": "42",
        "expectedHashSha256": "<expected-artifact-hash>"
      }
    ]
  }'
```

2. Validate the three bundle checkpoints in the response:
   - `contextBundles.assessment`: collusion links, listing-authenticity signals, buyer-risk signals, and policy simulation outcomes
   - `contextBundles.intervention`: case rationale, machine/human decision boundary, remediation actions, and dispute-preemption actions
   - `contextBundles.dispute`: escrow attestation checkpoints, dispute evidence, fulfillment proofs, and risk-checkpoint decisions
3. Validate integrity metadata before sharing the export:
   - compare `integrityMetadata.bundleHashSha256` with the operator's expected hash when doing deterministic re-export checks
   - inspect `integrityMetadata.artifactHashes` and `checkpointLinkage` to confirm every exported artifact is represented at the intended checkpoint
   - confirm `assertionsChecked` matches the number of hash assertions sent in the request

> [!WARNING]
> `requireDisputeArtifacts=true` fails with `409` when both dispute evidence and fulfillment proofs are absent. Treat that as a workflow stop, not a soft warning.

> [!TIP]
> Use `expectedBundleHashSha256` for replay-safe handoffs and `artifactHashAssertions` for selective spot checks when only a subset of evidence artifacts is externally anchored.

4. Triage conflict responses:
   - `409 missing dispute artifacts`: gather/upload dispute evidence or fulfillment proof before retrying export
   - `409 integrity verification failed: bundle hash mismatch`: the exported checkpoint set drifted from the caller's expected snapshot; re-evaluate case mutations before handoff
   - `409 integrity verification failed: artifact not found|hash mismatch`: the asserted artifact set is stale or tampered; review case evidence inventory and retry only after reconciliation
5. Record the exported bundle alongside the case review:
   - retain `caseId`, `transactionId`, `exportVersion`, `exportedAt`, and `integrityMetadata.bundleHashSha256`
   - if the export is attached to an incident timeline, include which of `assessment`, `intervention`, or `dispute` was relied on for the operator decision

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
