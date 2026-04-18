# GreJiJi

Backend API for GreJiJi marketplace trust-and-settlement workflows.

## Requirements

- Node.js 18+

## Quick start

```bash
npm install
npm start
```

Default local URLs:

- API root: `http://localhost:3000/`
- Health: `http://localhost:3000/health`
- Readiness: `http://localhost:3000/ready`
- Live docs: `http://localhost:3000/docs`
- Web UI: `http://localhost:3000/app`

## Documentation

- Repo API reference: `docs/api-reference.md`
- Repo operations guide: `docs/operations.md`
- Live browsable docs: `GET /docs`

## Configuration

- `PORT` defaults to `3000`
- `HOST` defaults to `0.0.0.0`
- `NODE_ENV` defaults to `development`
- `DATABASE_PATH` defaults to `./data/grejiji.sqlite`
- `RELEASE_TIMEOUT_HOURS` defaults to `72`
- `AUTH_TOKEN_SECRET` defaults to `local-dev-secret-change-me`
- `AUTH_TOKEN_TTL_SECONDS` defaults to `43200`
- `EVIDENCE_STORAGE_PATH` defaults to `./data/dispute-evidence`
- `EVIDENCE_MAX_BYTES` defaults to `5242880` (5 MB)
- `LISTING_PHOTO_STORAGE_PATH` defaults to `./data/listing-photos`
- `LISTING_PHOTO_MAX_BYTES` defaults to `8388608` (8 MB)
- `REQUEST_BODY_MAX_BYTES` defaults to `1048576` (1 MB JSON payload limit)
- `SERVICE_FEE_FIXED_CENTS` defaults to `0` (flat platform fee in cents)
- `SERVICE_FEE_PERCENT` defaults to `0` (percent fee, supports decimals like `2.5`)
- `SETTLEMENT_CURRENCY` defaults to `USD` (3-letter ISO code)
- `PAYMENT_PROVIDER` defaults to `local` (`local` or `stripe`)
- `PAYMENT_LOCAL_DEFAULT_METHOD` defaults to `pm_local_dev`
- `STRIPE_SECRET_KEY` required when `PAYMENT_PROVIDER=stripe`
- `STRIPE_WEBHOOK_SECRET` required for `POST /webhooks/stripe` signature verification
- `STRIPE_WEBHOOK_TOLERANCE_SECONDS` defaults to `300`
- `STRIPE_API_BASE_URL` defaults to `https://api.stripe.com/v1`
- `STRIPE_TIMEOUT_MS` defaults to `10000`
- `STRIPE_DEFAULT_PAYMENT_METHOD` defaults to `pm_card_visa`
- `RATE_LIMIT_ENABLED` defaults to `true`
- `RATE_LIMIT_WINDOW_MS` defaults to `60000`
- `RATE_LIMIT_AUTH_MAX` defaults to `20` per IP/window
- `RATE_LIMIT_LISTINGS_WRITE_MAX` defaults to `60` per IP/window
- `RATE_LIMIT_TRANSACTIONS_WRITE_MAX` defaults to `60` per IP/window
- `RATE_LIMIT_DISPUTE_WRITE_MAX` defaults to `40` per IP/window
- `RATE_LIMIT_ADMIN_JOBS_MAX` defaults to `30` per IP/window
- `REQUEST_LOG_ENABLED` defaults to `true` (JSON structured access logs)
- `ERROR_EVENT_LOG_FILE` optional JSONL sink for server error events
- `DEMO_SEED_ENABLED` defaults to `true` outside `NODE_ENV=test` and only applies when using default `DATABASE_PATH` (idempotent demo users/history bootstrap + listing refresh on reseed)
- `DEMO_SEED_PASSWORD` defaults to `DemoMarket123!` (shared password for seeded demo accounts)

## Core capabilities

- user registration and login with signed bearer tokens
- seller-owned listing creation and updates
- listing photo support via external `photoUrls` and seller-uploaded image attachments
- accepted transaction creation with computed auto-release deadlines
- deterministic service-fee accounting captured at transaction creation
- buyer confirmation flow for settlement release
- participant dispute opening
- admin dispute resolution and adjudication
- dispute evidence uploads with local file persistence
- participant/admin evidence metadata and download access
- admin dispute queue and dispute detail APIs
- auditable transaction event history
- immutable settlement snapshots for completed/refunded/cancelled outcomes
- provider-backed payment records with idempotent authorize/capture and refund operations
- authenticated Stripe webhook ingestion with signature verification, dedupe, and replay-safe processing
- payment reconciliation job to heal local payment status drift from provider webhook truth
- trust-operations v9 with collusion evidence graphing (device/payment/fulfillment/communication links), preemptive dispute controls (shipment confirmation + payout progression restrictions), cluster-level mitigation orchestration, and expanded trust telemetry
- atomic notification outbox writes for downstream processing
- notification dispatch job with retry/backoff metadata
- user inbox APIs for listing and acknowledging delivered notifications

## Test suite

```bash
npm test
```

Frontend smoke checks (served shell/assets) are included in `npm test` under `test/smoke.test.js`.

Release-gate stage commands (run locally or in CI):

```bash
npm run test:unit
npm run test:integration
npm run test:e2e
```

Expected runtime on a typical development machine:

- `test:unit`: < 5s
- `test:integration`: < 10s
- `test:e2e`: ~5-6 minutes (transactional lifecycle + webhook/reconciliation branches)
- Full release gate (`npm test`): ~6 minutes

CI enforcement:

- GitHub Actions workflow: `.github/workflows/release-gate.yml`
- Required stages: Unit, Integration, E2E Transactional Suite
- Failure diagnostics: each stage uploads `artifacts/<stage>/test.log`

Common release-gate triage:

- auth/listing failures:
  - inspect `artifacts/integration/test.log` for 4xx/5xx route responses
  - verify request/auth changes in `src/server.js`
- transaction/settlement failures:
  - inspect `artifacts/e2e/test.log` for failing scenario name
  - verify migration drift and event/state transitions in `src/db.js`
- webhook/reconciliation failures:
  - inspect e2e logs for signature/ordering/replay assertions
  - verify provider logic in `src/payment-provider.js` and webhook handlers in `src/server.js`

## Production startup and deployment

Production startup script (runs migration bootstrap before serving):

```bash
npm run start:prod
```

Run migration-only check:

```bash
npm run migrate
```

Container build/run:

```bash
cp .env.example .env
docker compose up --build
```

### Automated staging and production pipeline

Deployment workflow:

- `.github/workflows/deploy-pipeline.yml`
- Runs `npm test`, then promotes through `staging`, then `production`.
- Each environment runs:
  - config/secrets validation
  - migration preflight idempotency check on a DB snapshot
  - synthetic pre/post deploy smoke gates (health, auth, listing browse, transaction creation, dispute APIs, Stripe webhook ingestion)
  - rollback on failed rollout using the configured rollback command and latest DB backup

Deployment scripts:

- `npm run deploy:validate:staging`
- `npm run deploy:validate:production`
- `npm run deploy:migration-preflight`
- `npm run deploy:smoke`
- `npm run deploy:staging`
- `npm run deploy:production`
- `npm run deploy:rollback:staging`
- `npm run deploy:rollback:production`

Required environment variables for automated deploy:

- `STAGING_BASE_URL`, `STAGING_DATABASE_PATH`, `STAGING_AUTH_TOKEN_SECRET`, `STAGING_STRIPE_WEBHOOK_SECRET`, `STAGING_DEPLOY_COMMAND`, `STAGING_ROLLBACK_COMMAND`
- `PRODUCTION_BASE_URL`, `PRODUCTION_DATABASE_PATH`, `PRODUCTION_AUTH_TOKEN_SECRET`, `PRODUCTION_STRIPE_WEBHOOK_SECRET`, `PRODUCTION_DEPLOY_COMMAND`, `PRODUCTION_ROLLBACK_COMMAND`

### Jenkins pipeline provisioning (root-level default)

Provision or refresh the Jenkins pipeline job:

```bash
JENKINS_BASE_URL="https://ci.example.com" \
JENKINS_USER="ci-user" \
JENKINS_TOKEN="<api-token>" \
JENKINS_REPO_URL="https://github.com/futurepr0n/GreJiJi" \
npm run jenkins:provision
```

`scripts/jenkins/provision-job.sh` defaults:

- `JENKINS_FOLDER` defaults to empty (no folder, root-level job)
- `JENKINS_JOB` defaults to `GreJiJi`
- `JENKINS_BRANCH` defaults to `*/main`
- `JENKINS_SCRIPT_PATH` defaults to `Jenkinsfile`
- `JENKINS_GIT_CREDENTIALS_ID` defaults to empty (no credentials id in SCM block)

Migration note from legacy folder job layout (`GreJiJi/deploy`):

- keep legacy layout: set `JENKINS_FOLDER="GreJiJi"` and `JENKINS_JOB="deploy"`
- migrate to root-level default: unset `JENKINS_FOLDER` and keep `JENKINS_JOB="GreJiJi"`
- the provisioning script is idempotent: it creates missing folder/job resources, updates existing job config, then triggers a build

Jenkins deploy-stage hardening variables:

- `APP_HOST_PORT` required (example `3333`)
- `APP_CONTAINER_PORT` optional (default `3000`)
- `APP_SERVICE_NAME` optional (default `api`)
- `ALLOW_PORT_FALLBACK` optional in deploy script (`0`/`1`), Jenkinsfile default is `1`
- `ROLLBACK_SIMULATION_ENABLED` optional Jenkins gate toggle, default `true`
- `AUTH_TOKEN_SECRET` required Jenkins runtime secret and must not use placeholder values
  - Jenkinsfile defines this as a masked `password` build parameter (`Build with Parameters`)
  - runtime precedence is: build parameter `AUTH_TOKEN_SECRET` -> environment `AUTH_TOKEN_SECRET` -> empty string (validation failure)
  - recommended setup: enter the value per build in `Build with Parameters`, or inject it from Jenkins credentials into the build environment
- when `PAYMENT_PROVIDER=stripe`: `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` are required

`scripts/jenkins/deploy-docker.sh` now enforces:

- pre-deploy env validation (Jenkins runtime vars, ports, credentials)
- Docker Compose validation gate before deploy
- post-deploy checks for container port binding + `GET /health`
- automatic rollback to the previous image if deploy or health verification fails

Jenkinsfile rollback simulation gate (`Rollback Simulation Gate` stage):

- runs after deploy when `ROLLBACK_SIMULATION_ENABLED=true`
- executes deploy script with forced failing health path (`HEALTHCHECK_PATH=/__force_rollback_probe__`)
- rollback verification still probes a safe path (`ROLLBACK_HEALTHCHECK_PATH`, default `/health`) so rollback health checks are isolated from the simulated failure path
- requires both log markers for pass: `Attempting rollback to previous image` and `Rollback succeeded and service is healthy.`

## Frontend workflow

The responsive web console at `GET /app` is API-backed and role-aware:

- Auth opens from header navigation as a modal (register/login for `buyer`, `seller`, `admin`).
- Demo quick-login buttons are prefilled for seeded accounts:
  - `demo-seller-01@grejiji.demo`
  - `demo-buyer@grejiji.demo`
  - `demo-admin@grejiji.demo`
  - password: `DemoMarket123!` (or `DEMO_SEED_PASSWORD`)
- Buyer flow: browse listings with external and uploaded photos, create purchase transaction, confirm delivery, open dispute, upload evidence.
- Seller flow: create listings with dollar-form inputs, attach external `photoUrls`, upload image files to existing listings, inspect transactions, open dispute, upload evidence.
- Admin flow: load dispute queue/detail, resolve/adjudicate disputes, inspect evidence and events.
- Shared flow: view settlement breakdown fields (`itemPrice`, `serviceFee`, `totalBuyerCharge`, `sellerNet`, `currency`) and inbox notifications.
- Demo seed catalog now provisions 10 retro game listings (`demo-listing-01` through `demo-listing-10`) with two validated image URLs per listing (box art + gameplay snapshot).
- Listing browse renders image thumbnails inline, and listing detail renders a combined gallery from both external `photoUrls` and uploaded listing photos.
- Restarting with demo seeding enabled updates existing `demo-listing-*` records to the current catalog definition instead of keeping stale generic seed content.

No separate frontend build step is required. Server routes:

- `GET /app` serves HTML shell
- `GET /app/client.js` serves browser logic
- `GET /app/styles.css` serves responsive styling

## Notification dispatcher and inbox inspection

## Settlement breakdown payload shape

Transaction responses now include persisted fee accounting fields:

```json
{
  "transaction": {
    "amountCents": 12000,
    "itemPrice": 12000,
    "serviceFee": 700,
    "totalBuyerCharge": 12700,
    "sellerNet": 12000,
    "currency": "USD",
    "settlementOutcome": "completed",
    "settledBuyerCharge": 12700,
    "settledSellerPayout": 12000,
    "settledPlatformFee": 700
  }
}
```

Run one dispatch cycle (admin token required):

```bash
curl -sS -X POST http://localhost:3000/jobs/notification-dispatch \
  -H "Authorization: Bearer <admin-token>" \
  -H "Content-Type: application/json" \
  -d '{"limit":100}'
```

Read inbox notifications for the authenticated user:

```bash
curl -sS http://localhost:3000/notifications \
  -H "Authorization: Bearer <user-token>"
```

Useful local DB checks:

```bash
sqlite3 ./data/grejiji.sqlite "SELECT id, transaction_id, topic, status, attempt_count, last_attempt_at, next_retry_at, sent_at, failed_at FROM notification_outbox ORDER BY id;"
sqlite3 ./data/grejiji.sqlite "SELECT id, transaction_id, operation, provider, idempotency_key, status, external_reference, error_code FROM payment_operations ORDER BY id;"
sqlite3 ./data/grejiji.sqlite "SELECT id, provider, event_id, event_type, transaction_id, status, delivery_count, processing_attempts, processing_error, processed_at FROM provider_webhook_events ORDER BY id;"
sqlite3 ./data/grejiji.sqlite "SELECT id, recipient_user_id, transaction_id, topic, status, created_at, read_at, acknowledged_at FROM user_notifications ORDER BY id;"
sqlite3 ./data/grejiji.sqlite "SELECT id, transaction_id, uploader_user_id, mime_type, size_bytes, checksum_sha256, storage_key, created_at FROM dispute_evidence ORDER BY created_at, id;"
```

## Webhook and reconciliation operations

Ingest a signed Stripe webhook event:

```bash
payload='{"id":"evt_example","type":"payment_intent.succeeded","created":1900000000,"data":{"object":{"id":"pi_example","metadata":{"transaction_id":"txn-100"}}}}'
ts=$(date +%s)
sig=$(printf "%s.%s" "$ts" "$payload" | openssl dgst -sha256 -hmac "$STRIPE_WEBHOOK_SECRET" -hex | sed 's/^.* //')
curl -sS -X POST http://localhost:3000/webhooks/stripe \
  -H "Content-Type: application/json" \
  -H "Stripe-Signature: t=$ts,v1=$sig" \
  -d "$payload"
```

Inspect failed provider webhook events (admin token):

```bash
curl -sS "http://localhost:3000/admin/payment-webhooks?status=failed&provider=stripe" \
  -H "Authorization: Bearer <admin-token>"
```

Replay a failed webhook event safely by internal event row id:

```bash
curl -sS -X POST http://localhost:3000/admin/payment-webhooks/<event-row-id>/reprocess \
  -H "Authorization: Bearer <admin-token>" \
  -H "Content-Type: application/json" \
  -d '{}'
```

Run payment reconciliation correction job:

```bash
curl -sS -X POST http://localhost:3000/jobs/payment-reconciliation \
  -H "Authorization: Bearer <admin-token>" \
  -H "Content-Type: application/json" \
  -d '{"limit":100}'
```
