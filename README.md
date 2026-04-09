# GreJiJi

Backend API for GreJiJi marketplace trust-and-settlement workflows.

## Requirements

- Node.js 18+

## Environment variables

- `PORT` (optional): HTTP port to listen on. Default `3000`.
- `HOST` (optional): bind host. Default `0.0.0.0`.
- `NODE_ENV` (optional): runtime environment label returned by `/health`. Default `development`.
- `DATABASE_PATH` (optional): SQLite database file path. Default `./data/grejiji.sqlite`.
- `RELEASE_TIMEOUT_HOURS` (optional): buyer confirmation grace period before auto-release kicks in. Default `72`.
- `AUTH_TOKEN_SECRET` (optional): HMAC secret used to sign auth tokens. Default `local-dev-secret-change-me`.
- `AUTH_TOKEN_TTL_SECONDS` (optional): auth token lifetime in seconds. Default `43200` (12h).

## Run locally

```bash
npm install
npm start
```

## Authentication and roles

Auth endpoints:

- `POST /auth/register`
  - Request body: `email`, `password` (min 8 chars), `role` (`buyer|seller|admin`), optional `userId`
  - Creates user, hashes password with scrypt + random salt, and returns signed auth token.
- `POST /auth/login`
  - Request body: `email`, `password`
  - Verifies credentials and returns signed auth token.

Protected endpoints require `Authorization: Bearer <token>`.

Role rules:

- Seller-only: `POST /listings`, `PATCH /listings/:listingId`
- Dispute opening: participants only (`buyerId` or `sellerId` on transaction)
- Admin-only: `POST /transactions/:id/disputes/adjudicate`, `POST /transactions/:id/disputes/resolve`, `POST /jobs/auto-release`

## Marketplace and settlement endpoints

- `GET /listings`
  - Returns persisted listings.
- `POST /listings` (seller-only)
  - Creates listing for current seller.
- `PATCH /listings/:listingId` (seller-only)
  - Updates listing; only listing owner can update.
- `POST /transactions` (authenticated)
  - Creates accepted transaction and computes `autoReleaseDueAt` from `acceptedAt + RELEASE_TIMEOUT_HOURS`.
- `GET /transactions/:transactionId` (participants/admin)
  - Returns transaction state and settlement/dispute metadata.
- `POST /transactions/:transactionId/confirm-delivery` (authenticated buyer participant)
  - Buyer confirms delivery and settles transaction (`completed`) with payout reason `buyer_confirmation`.
- `POST /transactions/:transactionId/disputes` (participant-only)
  - Opens dispute and moves transaction to `disputed`.
- `POST /transactions/:transactionId/disputes/resolve` (admin-only)
  - Resolves dispute and returns transaction to `accepted`.
- `POST /transactions/:transactionId/disputes/adjudicate` (admin-only)
  - Finalizes disputed transaction with decision:
    - `release_to_seller`
    - `refund_to_buyer`
    - `cancel_transaction`
- `POST /jobs/auto-release` (admin-only)
  - Settles eligible accepted transactions after timeout.

## Operational notes

- Users and listings are persisted in SQLite (`users`, `listings` tables).
- Transaction payout release remains one-time only (`payoutReleasedAt` immutable once set).
- Auto-release ignores transactions with open disputes.
- Adjudication metadata is persisted and returned with transaction payloads.
- SQLite migrations are auto-applied from `migrations/*.sql` at startup.

## Run tests

```bash
npm test
```

Coverage includes:

- health endpoint
- register/login success + login rejection
- unauthorized access rejection on protected routes
- seller-only listing create/update enforcement
- participant-only dispute opening
- admin-only adjudication and auto-release enforcement
