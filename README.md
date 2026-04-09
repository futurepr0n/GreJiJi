# GreJiJi

Initial backend for GreJiJi marketplace trust-and-settlement workflows.

## Requirements

- Node.js 18+

## Environment variables

- `PORT` (optional): HTTP port to listen on. Default `3000`.
- `HOST` (optional): bind host. Default `0.0.0.0`.
- `NODE_ENV` (optional): runtime environment label returned by `/health`. Default `development`.
- `DATABASE_PATH` (optional): SQLite database file path. Default `./data/grejiji.sqlite`.
- `RELEASE_TIMEOUT_HOURS` (optional): buyer confirmation grace period before auto-release kicks in. Default `72`.

## Run locally

```bash
npm install
npm start
```

## Settlement workflow endpoints

- `POST /transactions`
  - Creates an `accepted` transaction and computes `autoReleaseDueAt` from `acceptedAt + RELEASE_TIMEOUT_HOURS`.
- `GET /transactions/:transactionId`
  - Returns persisted transaction state and release/dispute metadata.
- `POST /transactions/:transactionId/confirm-delivery`
  - Buyer confirms delivery and immediately settles transaction (`completed`) with payout release reason `buyer_confirmation`.
- `POST /transactions/:transactionId/disputes`
  - Opens a dispute and moves transaction to `disputed`.
- `POST /transactions/:transactionId/disputes/resolve`
  - Resolves dispute and returns transaction to `accepted` state.
- `POST /jobs/auto-release`
  - Settles eligible accepted transactions after timeout (`payout_release_reason=auto_release`).

## Operational notes

- Payout release is one-time only (`payoutReleasedAt` is immutable after settlement).
- Auto-release ignores transactions with open disputes.
- Once a dispute is resolved, the transaction can become eligible for auto-release again.
- SQLite schema migrations are applied automatically on server startup from `migrations/*.sql`.

## Run tests

```bash
npm test
```

Tests cover:

- health endpoint (`GET /health`)
- manual delivery confirmation release path
- timeout-based auto-release path
- dispute block + post-resolution auto-release
