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

## Verification checklist

> [!NOTE]
> The current automated verification source of truth is `node --test`.

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
- `schema_migrations`

Runtime file storage:

- dispute evidence files are written beneath `EVIDENCE_STORAGE_PATH`
- local generated files under `data/` are runtime artifacts and should not be committed

## Useful local inspection commands

```bash
sqlite3 ./data/grejiji.sqlite "SELECT id, transaction_id, event_type, actor_id, occurred_at FROM transaction_events ORDER BY occurred_at, id;"
sqlite3 ./data/grejiji.sqlite "SELECT id, transaction_id, topic, recipient_user_id, status, attempt_count, next_retry_at, sent_at, failed_at FROM notification_outbox ORDER BY id;"
sqlite3 ./data/grejiji.sqlite "SELECT id, recipient_user_id, transaction_id, topic, status, created_at, read_at, acknowledged_at FROM user_notifications ORDER BY id;"
```

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
