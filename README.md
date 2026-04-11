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
- Live docs: `http://localhost:3000/docs`
- Web UI: `http://localhost:3000/app`

## Documentation

- Repo API reference: `docs/api-reference.md`
- Repo operations guide: `docs/operations.md`
- Live browsable docs: `GET /docs`
- Trust assessment APIs: `GET /transactions/:transactionId/trust` and `POST /transactions/:transactionId/trust/evaluate`

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
- `SERVICE_FEE_FIXED_CENTS` defaults to `0` (flat platform fee in cents)
- `SERVICE_FEE_PERCENT` defaults to `0` (percent fee, supports decimals like `2.5`)
- `SETTLEMENT_CURRENCY` defaults to `USD` (3-letter ISO code)

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
- atomic notification outbox writes for downstream processing
- notification dispatch job with retry/backoff metadata
- user inbox APIs for listing and acknowledging delivered notifications
- trust operations v16 with explainability, adaptive identity-friction traces, post-incident verification, fraud-ring disruption, account-takeover containment, settlement-risk stress controls, and autonomous policy canary governance

## Test suite

```bash
npm test
```

Frontend smoke checks (served shell/assets) are included in `npm test` under `test/smoke.test.js`.

Trust coverage in the same suite verifies:

- persisted `trust-ops-v16` assessment payloads on transaction creation
- `GET /transactions/:transactionId/trust` history reads for participants and admins
- canary promote/hold/revert decisions and rollback propagation into intervention history
- linked device/payment containment signals and settlement stress scenario outputs

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
sqlite3 ./data/grejiji.sqlite "SELECT id, recipient_user_id, transaction_id, topic, status, created_at, read_at, acknowledged_at FROM user_notifications ORDER BY id;"
sqlite3 ./data/grejiji.sqlite "SELECT id, transaction_id, uploader_user_id, mime_type, size_bytes, checksum_sha256, storage_key, created_at FROM dispute_evidence ORDER BY created_at, id;"
sqlite3 ./data/grejiji.sqlite "SELECT transaction_id, orchestration_version, risk_band, json_extract(account_takeover_containment_json, '$.containmentBand'), json_extract(settlement_risk_stress_controls_json, '$.maxScenarioSeverity'), json_extract(policy_canary_governance_json, '$.rolloutDecision') FROM trust_assessments ORDER BY updated_at DESC;"
```
