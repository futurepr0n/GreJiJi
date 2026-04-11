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

## Core capabilities

- user registration and login with signed bearer tokens
- seller-owned listing creation and updates
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

## Frontend workflow

The responsive web console at `GET /app` is API-backed and role-aware:

- Auth forms for register/login (`buyer`, `seller`, `admin`).
- Buyer flow: browse listings, create purchase transaction, confirm delivery, open dispute, upload evidence.
- Seller flow: create listings, inspect transactions, open dispute, upload evidence.
- Admin flow: load dispute queue/detail, resolve/adjudicate disputes, inspect evidence and events.
- Shared flow: view settlement breakdown fields (`itemPrice`, `serviceFee`, `totalBuyerCharge`, `sellerNet`, `currency`) and inbox notifications.

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
