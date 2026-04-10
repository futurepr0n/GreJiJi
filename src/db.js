import fs from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";

const VALID_STATUSES = new Set(["accepted", "disputed", "completed"]);
const VALID_ROLES = new Set(["buyer", "seller", "admin"]);
const VALID_ADJUDICATION_DECISIONS = new Set([
  "release_to_seller",
  "refund_to_buyer",
  "cancel_transaction"
]);
const VALID_EVENT_TYPES = new Set([
  "payment_captured",
  "buyer_confirmed",
  "dispute_opened",
  "dispute_resolved",
  "dispute_adjudicated",
  "settlement_completed",
  "settlement_refunded",
  "settlement_cancelled"
]);
const VALID_OUTBOX_STATUSES = new Set(["pending", "processing", "sent", "failed"]);
const VALID_NOTIFICATION_STATUSES = new Set(["unread", "read", "acknowledged"]);

function ensureParentDirectory(filePath) {
  const directory = path.dirname(filePath);
  fs.mkdirSync(directory, { recursive: true });
}

function assertValidStatus(status) {
  if (!VALID_STATUSES.has(status)) {
    throw new Error(`Unexpected transaction status: ${status}`);
  }
}

function assertValidRole(role) {
  if (!VALID_ROLES.has(role)) {
    throw new Error(`Unexpected user role: ${role}`);
  }
}

function assertValidAdjudicationDecision(decision) {
  if (decision === null || decision === undefined) {
    return;
  }

  if (!VALID_ADJUDICATION_DECISIONS.has(decision)) {
    throw new Error(`Unexpected adjudication decision: ${decision}`);
  }
}

function toIsoString(value) {
  if (typeof value === "string") {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.valueOf())) {
      throw new Error("Invalid ISO datetime string");
    }
    return parsed.toISOString();
  }

  if (value instanceof Date) {
    if (Number.isNaN(value.valueOf())) {
      throw new Error("Invalid date value");
    }
    return value.toISOString();
  }

  throw new Error("Datetime value must be a Date or ISO string");
}

function addHours(isoTimestamp, hours) {
  const source = new Date(isoTimestamp);
  source.setHours(source.getHours() + hours);
  return source.toISOString();
}

function normalizeCurrencyCode(currency) {
  if (typeof currency !== "string") {
    throw new StoreError("validation", "settlement currency must be a 3-letter ISO code");
  }
  const normalized = currency.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(normalized)) {
    throw new StoreError("validation", "settlement currency must be a 3-letter ISO code");
  }
  return normalized;
}

export class StoreError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "StoreError";
    this.code = code;
  }
}

function mapTransaction(row) {
  if (!row) {
    return null;
  }

  assertValidStatus(row.status);
  assertValidAdjudicationDecision(row.adjudication_decision);

  return {
    id: row.id,
    buyerId: row.buyer_id,
    sellerId: row.seller_id,
    amountCents: row.amount_cents,
    feeFixedCents: row.fee_fixed_cents,
    feeRateBps: row.fee_rate_bps,
    itemPrice: row.amount_cents,
    serviceFee: row.service_fee_cents,
    totalBuyerCharge: row.total_buyer_charge_cents,
    sellerNet: row.seller_net_cents,
    currency: row.currency_code,
    status: row.status,
    acceptedAt: row.accepted_at,
    autoReleaseDueAt: row.auto_release_due_at,
    buyerConfirmedAt: row.buyer_confirmed_at,
    autoReleasedAt: row.auto_released_at,
    payoutReleasedAt: row.payout_released_at,
    payoutReleaseReason: row.payout_release_reason,
    disputeOpenedAt: row.dispute_opened_at,
    disputeResolvedAt: row.dispute_resolved_at,
    adjudicationDecision: row.adjudication_decision,
    adjudicationDecidedAt: row.adjudication_decided_at,
    adjudicationDecidedBy: row.adjudication_decided_by,
    adjudicationNotes: row.adjudication_notes,
    refundIssuedAt: row.refund_issued_at,
    cancelledAt: row.cancelled_at,
    settlementOutcome: row.settlement_outcome,
    settledBuyerCharge: row.settled_buyer_charge_cents,
    settledSellerPayout: row.settled_seller_payout_cents,
    settledPlatformFee: row.settled_platform_fee_cents,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapUser(row) {
  if (!row) {
    return null;
  }

  assertValidRole(row.role);

  return {
    id: row.id,
    email: row.email,
    role: row.role,
    lastLoginAt: row.last_login_at,
    passwordUpdatedAt: row.password_updated_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapListing(row) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    sellerId: row.seller_id,
    title: row.title,
    description: row.description,
    priceCents: row.price_cents,
    localArea: row.local_area,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function parseJsonOrEmpty(value) {
  if (!value) {
    return {};
  }

  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

function mapTransactionEvent(row) {
  if (!row) {
    return null;
  }

  if (!VALID_EVENT_TYPES.has(row.event_type)) {
    throw new Error(`Unexpected transaction event type: ${row.event_type}`);
  }

  return {
    id: row.id,
    transactionId: row.transaction_id,
    eventType: row.event_type,
    actorId: row.actor_id,
    occurredAt: row.occurred_at,
    payload: parseJsonOrEmpty(row.payload_json),
    createdAt: row.created_at
  };
}

function mapOutboxRecord(row) {
  if (!row) {
    return null;
  }

  if (!VALID_OUTBOX_STATUSES.has(row.status)) {
    throw new Error(`Unexpected outbox status: ${row.status}`);
  }

  return {
    id: row.id,
    transactionId: row.transaction_id,
    sourceEventId: row.source_event_id,
    topic: row.topic,
    recipientUserId: row.recipient_user_id,
    status: row.status,
    payload: parseJsonOrEmpty(row.payload_json),
    createdAt: row.created_at,
    availableAt: row.available_at,
    nextRetryAt: row.next_retry_at,
    attemptCount: row.attempt_count,
    lastAttemptAt: row.last_attempt_at,
    processingStartedAt: row.processing_started_at,
    processedAt: row.processed_at,
    sentAt: row.sent_at,
    failedAt: row.failed_at,
    failureReason: row.failure_reason
  };
}

function mapUserNotification(row) {
  if (!row) {
    return null;
  }

  if (!VALID_NOTIFICATION_STATUSES.has(row.status)) {
    throw new Error(`Unexpected notification status: ${row.status}`);
  }

  return {
    id: row.id,
    recipientUserId: row.recipient_user_id,
    transactionId: row.transaction_id,
    sourceEventId: row.source_event_id,
    sourceOutboxId: row.source_outbox_id,
    topic: row.topic,
    payload: parseJsonOrEmpty(row.payload_json),
    status: row.status,
    createdAt: row.created_at,
    readAt: row.read_at,
    acknowledgedAt: row.acknowledged_at,
    updatedAt: row.updated_at
  };
}

function mapDisputeEvidence(row) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    transactionId: row.transaction_id,
    uploaderUserId: row.uploader_user_id,
    originalFileName: row.original_file_name,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    checksumSha256: row.checksum_sha256,
    storageKey: row.storage_key,
    createdAt: row.created_at
  };
}

function addMinutes(isoTimestamp, minutes) {
  const source = new Date(isoTimestamp);
  source.setMinutes(source.getMinutes() + minutes);
  return source.toISOString();
}

export function createTransactionStore({
  databasePath,
  migrationsDirectory,
  releaseTimeoutHours = 72,
  serviceFeeFixedCents = 0,
  serviceFeeRateBps = 0,
  settlementCurrency = "USD",
  dispatchNotification = () => {},
  now = () => new Date()
}) {
  ensureParentDirectory(databasePath);

  if (!Number.isInteger(serviceFeeFixedCents) || serviceFeeFixedCents < 0) {
    throw new StoreError("validation", "serviceFeeFixedCents must be a non-negative integer");
  }
  if (!Number.isInteger(serviceFeeRateBps) || serviceFeeRateBps < 0) {
    throw new StoreError("validation", "serviceFeeRateBps must be a non-negative integer");
  }
  const normalizedSettlementCurrency = normalizeCurrencyCode(settlementCurrency);

  const db = new Database(databasePath);
  db.pragma("journal_mode = WAL");

  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `);

  const migrationFiles = fs
    .readdirSync(migrationsDirectory)
    .filter((name) => name.endsWith(".sql"))
    .sort();

  const hasMigration = db.prepare("SELECT 1 FROM schema_migrations WHERE name = ?");
  const applyMigrationRecord = db.prepare(
    "INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)"
  );

  for (const migrationFile of migrationFiles) {
    const existing = hasMigration.get(migrationFile);
    if (existing) {
      continue;
    }

    const sql = fs.readFileSync(path.join(migrationsDirectory, migrationFile), "utf8");
    db.exec(sql);
    applyMigrationRecord.run(migrationFile, now().toISOString());
  }

  const insertTransaction = db.prepare(`
    INSERT INTO transactions (
      id,
      buyer_id,
      seller_id,
      amount_cents,
      fee_fixed_cents,
      fee_rate_bps,
      service_fee_cents,
      total_buyer_charge_cents,
      seller_net_cents,
      currency_code,
      status,
      accepted_at,
      auto_release_due_at,
      created_at,
      updated_at
    ) VALUES (
      @id,
      @buyer_id,
      @seller_id,
      @amount_cents,
      @fee_fixed_cents,
      @fee_rate_bps,
      @service_fee_cents,
      @total_buyer_charge_cents,
      @seller_net_cents,
      @currency_code,
      'accepted',
      @accepted_at,
      @auto_release_due_at,
      @created_at,
      @updated_at
    )
  `);

  const getTransactionByIdQuery = db.prepare("SELECT * FROM transactions WHERE id = ?");
  const insertTransactionEvent = db.prepare(`
    INSERT INTO transaction_events (
      transaction_id,
      event_type,
      actor_id,
      occurred_at,
      payload_json,
      created_at
    ) VALUES (
      @transaction_id,
      @event_type,
      @actor_id,
      @occurred_at,
      @payload_json,
      @created_at
    )
  `);
  const listTransactionEventsByTransactionId = db.prepare(`
    SELECT *
    FROM transaction_events
    WHERE transaction_id = ?
    ORDER BY occurred_at ASC, id ASC
  `);
  const insertDisputeEvidence = db.prepare(`
    INSERT INTO dispute_evidence (
      id,
      transaction_id,
      uploader_user_id,
      original_file_name,
      mime_type,
      size_bytes,
      checksum_sha256,
      storage_key,
      created_at
    ) VALUES (
      @id,
      @transaction_id,
      @uploader_user_id,
      @original_file_name,
      @mime_type,
      @size_bytes,
      @checksum_sha256,
      @storage_key,
      @created_at
    )
  `);
  const listDisputeEvidenceByTransactionId = db.prepare(`
    SELECT *
    FROM dispute_evidence
    WHERE transaction_id = ?
    ORDER BY created_at ASC, id ASC
  `);
  const getDisputeEvidenceById = db.prepare(`
    SELECT *
    FROM dispute_evidence
    WHERE id = ?
  `);
  const listDisputeQueueRows = db.prepare(`
    SELECT
      t.*,
      COALESCE(ev.evidence_count, 0) AS evidence_count,
      ev.latest_evidence_at
    FROM transactions t
    LEFT JOIN (
      SELECT
        transaction_id,
        COUNT(1) AS evidence_count,
        MAX(created_at) AS latest_evidence_at
      FROM dispute_evidence
      GROUP BY transaction_id
    ) ev ON ev.transaction_id = t.id
    WHERE t.dispute_opened_at IS NOT NULL
    ORDER BY t.updated_at DESC, t.id DESC
  `);

  const insertOutboxRecord = db.prepare(`
    INSERT INTO notification_outbox (
      transaction_id,
      source_event_id,
      topic,
      recipient_user_id,
      status,
      payload_json,
      created_at,
      available_at
    ) VALUES (
      @transaction_id,
      @source_event_id,
      @topic,
      @recipient_user_id,
      'pending',
      @payload_json,
      @created_at,
      @available_at
    )
  `);
  const listPendingOutboxRecords = db.prepare(`
    SELECT *
    FROM notification_outbox
    WHERE status = 'pending'
      AND transaction_id = @transaction_id
    ORDER BY id ASC
  `);
  const listDispatchableOutboxRecords = db.prepare(`
    SELECT *
    FROM notification_outbox
    WHERE status IN ('pending', 'failed')
      AND available_at <= @now_at
      AND (next_retry_at IS NULL OR next_retry_at <= @now_at)
    ORDER BY id ASC
    LIMIT @limit
  `);
  const getOutboxRecordById = db.prepare("SELECT * FROM notification_outbox WHERE id = ?");
  const markOutboxRecordProcessing = db.prepare(`
    UPDATE notification_outbox
    SET
      status = 'processing',
      processing_started_at = @processing_started_at,
      last_attempt_at = @last_attempt_at,
      attempt_count = COALESCE(attempt_count, 0) + 1,
      failure_reason = NULL,
      updated_at = @updated_at
    WHERE id = @id
      AND status IN ('pending', 'failed')
      AND (next_retry_at IS NULL OR next_retry_at <= @processing_started_at)
  `);
  const markOutboxRecordSent = db.prepare(`
    UPDATE notification_outbox
    SET
      status = 'sent',
      sent_at = @sent_at,
      processed_at = @processed_at,
      next_retry_at = NULL,
      failure_reason = NULL,
      failed_at = NULL,
      updated_at = @updated_at
    WHERE id = @id
      AND status = 'processing'
  `);
  const markOutboxRecordFailed = db.prepare(`
    UPDATE notification_outbox
    SET
      status = 'failed',
      failed_at = @failed_at,
      processed_at = @processed_at,
      next_retry_at = @next_retry_at,
      failure_reason = @failure_reason,
      updated_at = @updated_at
    WHERE id = @id
      AND status = 'processing'
  `);
  const insertUserNotification = db.prepare(`
    INSERT INTO user_notifications (
      recipient_user_id,
      transaction_id,
      source_event_id,
      source_outbox_id,
      topic,
      payload_json,
      status,
      created_at,
      updated_at
    ) VALUES (
      @recipient_user_id,
      @transaction_id,
      @source_event_id,
      @source_outbox_id,
      @topic,
      @payload_json,
      'unread',
      @created_at,
      @updated_at
    )
    ON CONFLICT(source_outbox_id) DO NOTHING
  `);
  const listNotificationsByUserId = db.prepare(`
    SELECT *
    FROM user_notifications
    WHERE recipient_user_id = @recipient_user_id
    ORDER BY created_at DESC, id DESC
    LIMIT @limit
  `);
  const getNotificationById = db.prepare(`
    SELECT *
    FROM user_notifications
    WHERE id = @id
  `);
  const markNotificationRead = db.prepare(`
    UPDATE user_notifications
    SET
      status = CASE WHEN status = 'acknowledged' THEN status ELSE 'read' END,
      read_at = COALESCE(read_at, @read_at),
      updated_at = @updated_at
    WHERE id = @id
      AND recipient_user_id = @recipient_user_id
  `);
  const markNotificationAcknowledged = db.prepare(`
    UPDATE user_notifications
    SET
      status = 'acknowledged',
      read_at = COALESCE(read_at, @read_at),
      acknowledged_at = COALESCE(acknowledged_at, @acknowledged_at),
      updated_at = @updated_at
    WHERE id = @id
      AND recipient_user_id = @recipient_user_id
  `);

  const markConfirmed = db.prepare(`
    UPDATE transactions
    SET
      status = 'completed',
      buyer_confirmed_at = @buyer_confirmed_at,
      payout_released_at = @payout_released_at,
      payout_release_reason = 'buyer_confirmation',
      settlement_outcome = 'completed',
      settled_buyer_charge_cents = total_buyer_charge_cents,
      settled_seller_payout_cents = seller_net_cents,
      settled_platform_fee_cents = service_fee_cents,
      updated_at = @updated_at
    WHERE id = @id
      AND status = 'accepted'
      AND payout_released_at IS NULL
      AND settlement_outcome IS NULL
      AND (dispute_opened_at IS NULL OR dispute_resolved_at IS NOT NULL)
  `);

  const openDisputeStatement = db.prepare(`
    UPDATE transactions
    SET
      status = 'disputed',
      dispute_opened_at = @dispute_opened_at,
      dispute_resolved_at = NULL,
      updated_at = @updated_at
    WHERE id = @id
      AND status = 'accepted'
      AND payout_released_at IS NULL
  `);

  const resolveDisputeStatement = db.prepare(`
    UPDATE transactions
    SET
      status = 'accepted',
      dispute_resolved_at = @dispute_resolved_at,
      updated_at = @updated_at
    WHERE id = @id
      AND status = 'disputed'
  `);

  const findEligibleAutoReleaseIds = db.prepare(`
    SELECT id
    FROM transactions
    WHERE status = 'accepted'
      AND payout_released_at IS NULL
      AND auto_release_due_at <= ?
      AND (dispute_opened_at IS NULL OR dispute_resolved_at IS NOT NULL)
    ORDER BY accepted_at ASC
  `);

  const markAutoReleased = db.prepare(`
    UPDATE transactions
    SET
      status = 'completed',
      auto_released_at = @auto_released_at,
      payout_released_at = @payout_released_at,
      payout_release_reason = 'auto_release',
      settlement_outcome = 'completed',
      settled_buyer_charge_cents = total_buyer_charge_cents,
      settled_seller_payout_cents = seller_net_cents,
      settled_platform_fee_cents = service_fee_cents,
      updated_at = @updated_at
    WHERE id = @id
      AND status = 'accepted'
      AND payout_released_at IS NULL
      AND settlement_outcome IS NULL
  `);

  const adjudicateToReleaseSellerStatement = db.prepare(`
    UPDATE transactions
    SET
      status = 'completed',
      dispute_resolved_at = @dispute_resolved_at,
      adjudication_decision = 'release_to_seller',
      adjudication_decided_at = @adjudication_decided_at,
      adjudication_decided_by = @adjudication_decided_by,
      adjudication_notes = @adjudication_notes,
      payout_released_at = @payout_released_at,
      payout_release_reason = 'dispute_adjudication_release_to_seller',
      refund_issued_at = NULL,
      cancelled_at = NULL,
      settlement_outcome = 'completed',
      settled_buyer_charge_cents = total_buyer_charge_cents,
      settled_seller_payout_cents = seller_net_cents,
      settled_platform_fee_cents = service_fee_cents,
      updated_at = @updated_at
    WHERE id = @id
      AND status = 'disputed'
      AND payout_released_at IS NULL
      AND adjudication_decision IS NULL
      AND settlement_outcome IS NULL
  `);

  const adjudicateToRefundBuyerStatement = db.prepare(`
    UPDATE transactions
    SET
      status = 'completed',
      dispute_resolved_at = @dispute_resolved_at,
      adjudication_decision = 'refund_to_buyer',
      adjudication_decided_at = @adjudication_decided_at,
      adjudication_decided_by = @adjudication_decided_by,
      adjudication_notes = @adjudication_notes,
      payout_released_at = NULL,
      payout_release_reason = NULL,
      refund_issued_at = @refund_issued_at,
      cancelled_at = NULL,
      settlement_outcome = 'refunded',
      settled_buyer_charge_cents = 0,
      settled_seller_payout_cents = 0,
      settled_platform_fee_cents = 0,
      updated_at = @updated_at
    WHERE id = @id
      AND status = 'disputed'
      AND payout_released_at IS NULL
      AND adjudication_decision IS NULL
      AND settlement_outcome IS NULL
  `);

  const adjudicateToCancelTransactionStatement = db.prepare(`
    UPDATE transactions
    SET
      status = 'completed',
      dispute_resolved_at = @dispute_resolved_at,
      adjudication_decision = 'cancel_transaction',
      adjudication_decided_at = @adjudication_decided_at,
      adjudication_decided_by = @adjudication_decided_by,
      adjudication_notes = @adjudication_notes,
      payout_released_at = NULL,
      payout_release_reason = NULL,
      refund_issued_at = NULL,
      cancelled_at = @cancelled_at,
      settlement_outcome = 'cancelled',
      settled_buyer_charge_cents = 0,
      settled_seller_payout_cents = 0,
      settled_platform_fee_cents = 0,
      updated_at = @updated_at
    WHERE id = @id
      AND status = 'disputed'
      AND payout_released_at IS NULL
      AND adjudication_decision IS NULL
      AND settlement_outcome IS NULL
  `);

  const insertUser = db.prepare(`
    INSERT INTO users (
      id,
      email,
      role,
      password_hash,
      password_salt,
      password_updated_at,
      last_login_at,
      created_at,
      updated_at
    ) VALUES (
      @id,
      @email,
      @role,
      @password_hash,
      @password_salt,
      @password_updated_at,
      NULL,
      @created_at,
      @updated_at
    )
  `);

  const getUserByEmail = db.prepare("SELECT * FROM users WHERE email = ?");
  const getUserById = db.prepare("SELECT * FROM users WHERE id = ?");

  const markUserLogin = db.prepare(`
    UPDATE users
    SET
      last_login_at = @last_login_at,
      updated_at = @updated_at
    WHERE id = @id
  `);

  const insertListing = db.prepare(`
    INSERT INTO listings (
      id,
      seller_id,
      title,
      description,
      price_cents,
      local_area,
      created_at,
      updated_at
    ) VALUES (
      @id,
      @seller_id,
      @title,
      @description,
      @price_cents,
      @local_area,
      @created_at,
      @updated_at
    )
  `);

  const getListingById = db.prepare("SELECT * FROM listings WHERE id = ?");
  const listListings = db.prepare("SELECT * FROM listings ORDER BY created_at DESC");

  const updateListingStatement = db.prepare(`
    UPDATE listings
    SET
      title = @title,
      description = @description,
      price_cents = @price_cents,
      local_area = @local_area,
      updated_at = @updated_at
    WHERE id = @id
  `);

  function appendTransactionEvent({
    transactionId,
    eventType,
    actorId,
    occurredAt,
    payload
  }) {
    if (!VALID_EVENT_TYPES.has(eventType)) {
      throw new StoreError("validation", `unexpected eventType: ${eventType}`);
    }

    if (!actorId || typeof actorId !== "string" || !actorId.trim()) {
      throw new StoreError("validation", "actorId is required for transaction events");
    }

    const timestamp = occurredAt ?? now().toISOString();
    const serializedPayload = JSON.stringify(payload ?? {});
    const result = insertTransactionEvent.run({
      transaction_id: transactionId,
      event_type: eventType,
      actor_id: actorId.trim(),
      occurred_at: timestamp,
      payload_json: serializedPayload,
      created_at: timestamp
    });

    return Number(result.lastInsertRowid);
  }

  function enqueueOutboxRecords({ transactionId, sourceEventId, occurredAt, records }) {
    if (!Array.isArray(records) || records.length === 0) {
      return;
    }

    for (const record of records) {
      insertOutboxRecord.run({
        transaction_id: transactionId,
        source_event_id: sourceEventId,
        topic: record.topic,
        recipient_user_id: record.recipientUserId ?? null,
        payload_json: JSON.stringify(record.payload ?? {}),
        created_at: occurredAt,
        available_at: occurredAt
      });
    }
  }

  const runAutoReleaseTransaction = db.transaction((timestampIso) => {
    const rows = findEligibleAutoReleaseIds.all(timestampIso);
    const releasedIds = [];

    for (const row of rows) {
      const result = markAutoReleased.run({
        id: row.id,
        auto_released_at: timestampIso,
        payout_released_at: timestampIso,
        updated_at: timestampIso
      });

      if (result.changes === 1) {
        const sourceEventId = appendTransactionEvent({
          transactionId: row.id,
          eventType: "settlement_completed",
          actorId: "system:auto_release",
          occurredAt: timestampIso,
          payload: { reason: "auto_release" }
        });
        enqueueOutboxRecords({
          transactionId: row.id,
          sourceEventId,
          occurredAt: timestampIso,
          records: [
            {
              topic: "dispute_update",
              recipientUserId: null,
              payload: {
                transactionId: row.id,
                eventType: "settlement_completed",
                reason: "auto_release"
              }
            }
          ]
        });
        releasedIds.push(row.id);
      }
    }

    return releasedIds;
  });

  return {
    close() {
      db.close();
    },

    createUser({ id, email, role, passwordHash, passwordSalt }) {
      if (!id || !email || !role || !passwordHash || !passwordSalt) {
        throw new StoreError("validation", "id, email, role, and password credentials are required");
      }

      if (!VALID_ROLES.has(role)) {
        throw new StoreError("validation", "role must be one of: buyer, seller, admin");
      }

      const normalizedEmail = email.trim().toLowerCase();
      if (!normalizedEmail) {
        throw new StoreError("validation", "email is required");
      }

      const timestamp = now().toISOString();

      try {
        insertUser.run({
          id,
          email: normalizedEmail,
          role,
          password_hash: passwordHash,
          password_salt: passwordSalt,
          password_updated_at: timestamp,
          created_at: timestamp,
          updated_at: timestamp
        });
      } catch (error) {
        if (error && typeof error.message === "string" && error.message.includes("UNIQUE")) {
          throw new StoreError("conflict", "email already exists");
        }
        throw error;
      }

      return mapUser(getUserById.get(id));
    },

    getUserById(id) {
      return mapUser(getUserById.get(id));
    },

    getUserAuthByEmail(email) {
      if (!email) {
        return null;
      }

      const normalizedEmail = email.trim().toLowerCase();
      const user = getUserByEmail.get(normalizedEmail);
      if (!user) {
        return null;
      }

      return {
        user: mapUser(user),
        passwordHash: user.password_hash,
        passwordSalt: user.password_salt
      };
    },

    recordUserLogin(id) {
      const existing = getUserById.get(id);
      if (!existing) {
        throw new StoreError("not_found", "user not found");
      }

      const timestamp = now().toISOString();
      markUserLogin.run({ id, last_login_at: timestamp, updated_at: timestamp });
      return mapUser(getUserById.get(id));
    },

    createListing({ id, sellerId, title, description, priceCents, localArea }) {
      if (!id || !sellerId) {
        throw new StoreError("validation", "id and sellerId are required");
      }

      if (!title || !title.trim()) {
        throw new StoreError("validation", "title is required");
      }

      if (!localArea || !localArea.trim()) {
        throw new StoreError("validation", "localArea is required");
      }

      if (!Number.isInteger(priceCents) || priceCents <= 0) {
        throw new StoreError("validation", "priceCents must be a positive integer");
      }

      const timestamp = now().toISOString();

      try {
        insertListing.run({
          id,
          seller_id: sellerId,
          title: title.trim(),
          description: description ?? null,
          price_cents: priceCents,
          local_area: localArea.trim(),
          created_at: timestamp,
          updated_at: timestamp
        });
      } catch (error) {
        if (error && typeof error.message === "string" && error.message.includes("UNIQUE")) {
          throw new StoreError("conflict", "listing id already exists");
        }
        throw error;
      }

      return mapListing(getListingById.get(id));
    },

    updateListing({ id, sellerId, title, description, priceCents, localArea }) {
      const existing = getListingById.get(id);
      if (!existing) {
        throw new StoreError("not_found", "listing not found");
      }

      if (existing.seller_id !== sellerId) {
        throw new StoreError("forbidden", "only the listing seller can update this listing");
      }

      if (!title || !title.trim()) {
        throw new StoreError("validation", "title is required");
      }

      if (!localArea || !localArea.trim()) {
        throw new StoreError("validation", "localArea is required");
      }

      if (!Number.isInteger(priceCents) || priceCents <= 0) {
        throw new StoreError("validation", "priceCents must be a positive integer");
      }

      const timestamp = now().toISOString();
      const result = updateListingStatement.run({
        id,
        title: title.trim(),
        description: description ?? null,
        price_cents: priceCents,
        local_area: localArea.trim(),
        updated_at: timestamp
      });

      if (result.changes !== 1) {
        throw new StoreError("conflict", "failed to update listing");
      }

      return mapListing(getListingById.get(id));
    },

    getListingById(id) {
      return mapListing(getListingById.get(id));
    },

    listListings() {
      return listListings.all().map(mapListing);
    },

    createAcceptedTransaction({ id, buyerId, sellerId, amountCents, acceptedAt, actorId }) {
      if (!id || !buyerId || !sellerId) {
        throw new StoreError(
          "validation",
          "id, buyerId, and sellerId are required to create a transaction"
        );
      }

      if (!Number.isInteger(amountCents) || amountCents <= 0) {
        throw new StoreError("validation", "amountCents must be a positive integer");
      }

      const serviceFeeCents =
        serviceFeeFixedCents + Math.round((amountCents * serviceFeeRateBps) / 10000);
      if (serviceFeeCents < 0) {
        throw new StoreError("validation", "service fee cannot be negative");
      }
      const totalBuyerChargeCents = amountCents + serviceFeeCents;
      const sellerNetCents = amountCents;

      const acceptedAtIso = acceptedAt ? toIsoString(acceptedAt) : now().toISOString();
      const autoReleaseDueAt = addHours(acceptedAtIso, releaseTimeoutHours);
      const timestamp = now().toISOString();

      const runCreateTransaction = db.transaction(() => {
        try {
          insertTransaction.run({
            id,
            buyer_id: buyerId,
            seller_id: sellerId,
            amount_cents: amountCents,
            fee_fixed_cents: serviceFeeFixedCents,
            fee_rate_bps: serviceFeeRateBps,
            service_fee_cents: serviceFeeCents,
            total_buyer_charge_cents: totalBuyerChargeCents,
            seller_net_cents: sellerNetCents,
            currency_code: normalizedSettlementCurrency,
            accepted_at: acceptedAtIso,
            auto_release_due_at: autoReleaseDueAt,
            created_at: timestamp,
            updated_at: timestamp
          });
        } catch (error) {
          if (error && typeof error.message === "string" && error.message.includes("UNIQUE")) {
            throw new StoreError("conflict", "transaction id already exists");
          }
          throw error;
        }

        const sourceEventId = appendTransactionEvent({
          transactionId: id,
          eventType: "payment_captured",
          actorId: actorId ?? sellerId,
          occurredAt: timestamp,
          payload: {
            amountCents,
            serviceFeeCents,
            totalBuyerChargeCents,
            sellerNetCents,
            currency: normalizedSettlementCurrency,
            buyerId,
            sellerId
          }
        });
        enqueueOutboxRecords({
          transactionId: id,
          sourceEventId,
          occurredAt: timestamp,
          records: [
            {
              topic: "payment_received",
              recipientUserId: sellerId,
              payload: {
                transactionId: id,
                amountCents,
                sellerNetCents,
                serviceFeeCents,
                buyerId
              }
            },
            {
              topic: "action_required",
              recipientUserId: buyerId,
              payload: {
                transactionId: id,
                action: "confirm_delivery_when_received"
              }
            }
          ]
        });
      });
      runCreateTransaction();

      return mapTransaction(getTransactionByIdQuery.get(id));
    },

    getTransactionById(id) {
      return mapTransaction(getTransactionByIdQuery.get(id));
    },

    getTransactionEventHistory({ id }) {
      const existing = getTransactionByIdQuery.get(id);
      if (!existing) {
        throw new StoreError("not_found", "transaction not found");
      }

      return listTransactionEventsByTransactionId.all(id).map(mapTransactionEvent);
    },

    createDisputeEvidence({
      id,
      transactionId,
      uploaderUserId,
      originalFileName,
      mimeType,
      sizeBytes,
      checksumSha256,
      storageKey
    }) {
      if (!id || !transactionId || !uploaderUserId) {
        throw new StoreError("validation", "id, transactionId, and uploaderUserId are required");
      }
      if (!originalFileName || !originalFileName.trim()) {
        throw new StoreError("validation", "originalFileName is required");
      }
      if (!mimeType || !mimeType.trim()) {
        throw new StoreError("validation", "mimeType is required");
      }
      if (!Number.isInteger(sizeBytes) || sizeBytes <= 0) {
        throw new StoreError("validation", "sizeBytes must be a positive integer");
      }
      if (!checksumSha256 || !checksumSha256.trim()) {
        throw new StoreError("validation", "checksumSha256 is required");
      }
      if (!storageKey || !storageKey.trim()) {
        throw new StoreError("validation", "storageKey is required");
      }

      const transaction = getTransactionByIdQuery.get(transactionId);
      if (!transaction) {
        throw new StoreError("not_found", "transaction not found");
      }
      if (transaction.status !== "disputed") {
        throw new StoreError("conflict", "dispute evidence can only be added to open disputes");
      }

      const timestamp = now().toISOString();

      try {
        insertDisputeEvidence.run({
          id,
          transaction_id: transactionId,
          uploader_user_id: uploaderUserId,
          original_file_name: originalFileName.trim(),
          mime_type: mimeType.trim(),
          size_bytes: sizeBytes,
          checksum_sha256: checksumSha256.trim(),
          storage_key: storageKey.trim(),
          created_at: timestamp
        });
      } catch (error) {
        if (error && typeof error.message === "string" && error.message.includes("UNIQUE")) {
          throw new StoreError("conflict", "evidence id or storage key already exists");
        }
        throw error;
      }

      return mapDisputeEvidence(getDisputeEvidenceById.get(id));
    },

    listDisputeEvidence({ transactionId }) {
      const transaction = getTransactionByIdQuery.get(transactionId);
      if (!transaction) {
        throw new StoreError("not_found", "transaction not found");
      }

      return listDisputeEvidenceByTransactionId.all(transactionId).map(mapDisputeEvidence);
    },

    getDisputeEvidenceById({ transactionId, evidenceId }) {
      const transaction = getTransactionByIdQuery.get(transactionId);
      if (!transaction) {
        throw new StoreError("not_found", "transaction not found");
      }

      const evidence = mapDisputeEvidence(getDisputeEvidenceById.get(evidenceId));
      if (!evidence || evidence.transactionId !== transactionId) {
        throw new StoreError("not_found", "dispute evidence not found");
      }
      return evidence;
    },

    listAdminDisputeQueue({ filter = "open", sortBy = "updatedAt", sortOrder = "desc", nowAt }) {
      const normalizedFilter = String(filter);
      const normalizedSortBy = String(sortBy);
      const normalizedSortOrder = String(sortOrder).toLowerCase() === "asc" ? "asc" : "desc";
      const validFilters = new Set(["open", "needs_evidence", "awaiting_decision", "resolved"]);
      const validSortBy = new Set([
        "updatedAt",
        "disputeOpenedAt",
        "disputeResolvedAt",
        "autoReleaseDueAt",
        "disputeAgeHours",
        "autoReleaseOverdueHours",
        "evidenceCount"
      ]);

      if (!validFilters.has(normalizedFilter)) {
        throw new StoreError(
          "validation",
          "filter must be one of: open, needs_evidence, awaiting_decision, resolved"
        );
      }
      if (!validSortBy.has(normalizedSortBy)) {
        throw new StoreError(
          "validation",
          "sortBy must be one of: updatedAt, disputeOpenedAt, disputeResolvedAt, autoReleaseDueAt, disputeAgeHours, autoReleaseOverdueHours, evidenceCount"
        );
      }

      const nowMs = nowAt ? new Date(toIsoString(nowAt)).valueOf() : now().valueOf();
      const rows = listDisputeQueueRows.all();

      const items = rows
        .map((row) => {
          const transaction = mapTransaction(row);
          const disputeOpenedMs = transaction.disputeOpenedAt
            ? new Date(transaction.disputeOpenedAt).valueOf()
            : null;
          const disputeResolvedMs = transaction.disputeResolvedAt
            ? new Date(transaction.disputeResolvedAt).valueOf()
            : null;
          const autoReleaseDueMs = transaction.autoReleaseDueAt
            ? new Date(transaction.autoReleaseDueAt).valueOf()
            : null;
          const disputeEndMs = disputeResolvedMs ?? nowMs;
          const disputeAgeHours =
            disputeOpenedMs === null ? null : Number(((disputeEndMs - disputeOpenedMs) / 3600000).toFixed(2));
          const autoReleaseOverdueHours =
            autoReleaseDueMs === null ? null : Number((Math.max(0, nowMs - autoReleaseDueMs) / 3600000).toFixed(2));
          const autoReleaseRemainingHours =
            autoReleaseDueMs === null ? null : Number((Math.max(0, autoReleaseDueMs - nowMs) / 3600000).toFixed(2));

          return {
            transaction,
            evidenceCount: Number(row.evidence_count ?? 0),
            latestEvidenceAt: row.latest_evidence_at ?? null,
            disputeAgeHours,
            autoReleaseOverdueHours,
            autoReleaseRemainingHours
          };
        })
        .filter((item) => {
          if (normalizedFilter === "open") {
            return item.transaction.status === "disputed";
          }
          if (normalizedFilter === "needs_evidence") {
            return item.transaction.status === "disputed" && item.evidenceCount === 0;
          }
          if (normalizedFilter === "awaiting_decision") {
            return item.transaction.status === "disputed" && item.evidenceCount > 0;
          }
          return item.transaction.disputeResolvedAt !== null;
        });

      const getSortValue = (item) => {
        if (normalizedSortBy === "evidenceCount") {
          return item.evidenceCount;
        }
        if (normalizedSortBy === "disputeAgeHours") {
          return item.disputeAgeHours ?? -1;
        }
        if (normalizedSortBy === "autoReleaseOverdueHours") {
          return item.autoReleaseOverdueHours ?? -1;
        }
        if (normalizedSortBy === "updatedAt") {
          return item.transaction.updatedAt ? new Date(item.transaction.updatedAt).valueOf() : 0;
        }
        if (normalizedSortBy === "disputeOpenedAt") {
          return item.transaction.disputeOpenedAt
            ? new Date(item.transaction.disputeOpenedAt).valueOf()
            : 0;
        }
        if (normalizedSortBy === "disputeResolvedAt") {
          return item.transaction.disputeResolvedAt
            ? new Date(item.transaction.disputeResolvedAt).valueOf()
            : 0;
        }
        if (normalizedSortBy === "autoReleaseDueAt") {
          return item.transaction.autoReleaseDueAt
            ? new Date(item.transaction.autoReleaseDueAt).valueOf()
            : 0;
        }
        return 0;
      };

      items.sort((left, right) => {
        const leftValue = getSortValue(left);
        const rightValue = getSortValue(right);
        if (leftValue === rightValue) {
          return left.transaction.id.localeCompare(right.transaction.id);
        }
        return normalizedSortOrder === "asc" ? leftValue - rightValue : rightValue - leftValue;
      });

      return items;
    },

    listPendingNotifications({ transactionId }) {
      return listPendingOutboxRecords.all({ transaction_id: transactionId }).map(mapOutboxRecord);
    },

    processNotificationOutbox({ nowAt, limit = 100 } = {}) {
      if (!Number.isInteger(limit) || limit <= 0 || limit > 500) {
        throw new StoreError("validation", "limit must be an integer between 1 and 500");
      }

      const timestamp = nowAt ? toIsoString(nowAt) : now().toISOString();
      const rows = listDispatchableOutboxRecords.all({ now_at: timestamp, limit });
      let sentCount = 0;
      let failedCount = 0;
      let deliveredNotificationCount = 0;

      const processSingleRecord = db.transaction((row) => {
        const markResult = markOutboxRecordProcessing.run({
          id: row.id,
          processing_started_at: timestamp,
          last_attempt_at: timestamp,
          updated_at: timestamp
        });

        if (markResult.changes !== 1) {
          return { skipped: true };
        }

        const processingRecord = mapOutboxRecord(getOutboxRecordById.get(row.id));
        try {
          dispatchNotification({ outboxRecord: processingRecord });

          if (processingRecord.recipientUserId) {
            const insertResult = insertUserNotification.run({
              recipient_user_id: processingRecord.recipientUserId,
              transaction_id: processingRecord.transactionId,
              source_event_id: processingRecord.sourceEventId,
              source_outbox_id: processingRecord.id,
              topic: processingRecord.topic,
              payload_json: JSON.stringify(processingRecord.payload ?? {}),
              created_at: timestamp,
              updated_at: timestamp
            });

            if (insertResult.changes === 1) {
              deliveredNotificationCount += 1;
            }
          }

          markOutboxRecordSent.run({
            id: row.id,
            sent_at: timestamp,
            processed_at: timestamp,
            updated_at: timestamp
          });
          sentCount += 1;
          return { skipped: false };
        } catch (error) {
          const normalized = error instanceof Error ? error.message : "notification dispatch failed";
          const attemptCount = Number(processingRecord.attemptCount ?? 1);
          const retryDelayMinutes = Math.min(60, Math.max(1, 2 ** (attemptCount - 1)));
          const nextRetryAt = addMinutes(timestamp, retryDelayMinutes);
          markOutboxRecordFailed.run({
            id: row.id,
            failed_at: timestamp,
            processed_at: timestamp,
            next_retry_at: nextRetryAt,
            failure_reason: normalized,
            updated_at: timestamp
          });
          failedCount += 1;
          return { skipped: false };
        }
      });

      for (const row of rows) {
        processSingleRecord(row);
      }

      return {
        processedCount: sentCount + failedCount,
        sentCount,
        failedCount,
        deliveredNotificationCount,
        remainingPendingCount: Number(
          db
            .prepare(
              "SELECT COUNT(1) AS count FROM notification_outbox WHERE status IN ('pending', 'failed')"
            )
            .get().count
        ),
        ranAt: timestamp
      };
    },

    listUserNotifications({ recipientUserId, limit = 100 }) {
      if (!recipientUserId) {
        throw new StoreError("validation", "recipientUserId is required");
      }
      if (!Number.isInteger(limit) || limit <= 0 || limit > 500) {
        throw new StoreError("validation", "limit must be an integer between 1 and 500");
      }
      return listNotificationsByUserId
        .all({ recipient_user_id: recipientUserId, limit })
        .map(mapUserNotification);
    },

    markNotificationAsRead({ id, recipientUserId }) {
      const existing = getNotificationById.get({ id });
      if (!existing) {
        throw new StoreError("not_found", "notification not found");
      }
      if (existing.recipient_user_id !== recipientUserId) {
        throw new StoreError("forbidden", "notification does not belong to authenticated user");
      }

      const timestamp = now().toISOString();
      const result = markNotificationRead.run({
        id,
        recipient_user_id: recipientUserId,
        read_at: timestamp,
        updated_at: timestamp
      });

      if (result.changes !== 1) {
        throw new StoreError("conflict", "failed to mark notification as read");
      }
      return mapUserNotification(getNotificationById.get({ id }));
    },

    markNotificationAsAcknowledged({ id, recipientUserId }) {
      const existing = getNotificationById.get({ id });
      if (!existing) {
        throw new StoreError("not_found", "notification not found");
      }
      if (existing.recipient_user_id !== recipientUserId) {
        throw new StoreError("forbidden", "notification does not belong to authenticated user");
      }

      const timestamp = now().toISOString();
      const result = markNotificationAcknowledged.run({
        id,
        recipient_user_id: recipientUserId,
        read_at: timestamp,
        acknowledged_at: timestamp,
        updated_at: timestamp
      });

      if (result.changes !== 1) {
        throw new StoreError("conflict", "failed to acknowledge notification");
      }
      return mapUserNotification(getNotificationById.get({ id }));
    },

    confirmDelivery({ id, buyerId }) {
      const existing = getTransactionByIdQuery.get(id);
      if (!existing) {
        throw new StoreError("not_found", "transaction not found");
      }

      if (!buyerId || buyerId !== existing.buyer_id) {
        throw new StoreError("forbidden", "buyerId must match transaction buyer");
      }

      if (existing.payout_released_at) {
        throw new StoreError("conflict", "payout already released for transaction");
      }

      if (existing.status !== "accepted") {
        throw new StoreError(
          "conflict",
          `transaction cannot be confirmed from status '${existing.status}'`
        );
      }

      if (existing.dispute_opened_at && !existing.dispute_resolved_at) {
        throw new StoreError("conflict", "transaction has an open dispute");
      }

      const timestamp = now().toISOString();
      const runConfirmDelivery = db.transaction(() => {
        const result = markConfirmed.run({
          id,
          buyer_confirmed_at: timestamp,
          payout_released_at: timestamp,
          updated_at: timestamp
        });

        if (result.changes !== 1) {
          throw new StoreError("conflict", "transaction confirmation preconditions failed");
        }

        const sourceEventId = appendTransactionEvent({
          transactionId: id,
          eventType: "buyer_confirmed",
          actorId: buyerId,
          occurredAt: timestamp,
          payload: {}
        });
        appendTransactionEvent({
          transactionId: id,
          eventType: "settlement_completed",
          actorId: buyerId,
          occurredAt: timestamp,
          payload: { reason: "buyer_confirmation" }
        });
        enqueueOutboxRecords({
          transactionId: id,
          sourceEventId,
          occurredAt: timestamp,
          records: [
            {
              topic: "dispute_update",
              recipientUserId: existing.seller_id,
              payload: {
                transactionId: id,
                eventType: "settlement_completed",
                reason: "buyer_confirmation"
              }
            }
          ]
        });
      });
      runConfirmDelivery();

      return mapTransaction(getTransactionByIdQuery.get(id));
    },

    openDispute({ id, actorId }) {
      const existing = getTransactionByIdQuery.get(id);
      if (!existing) {
        throw new StoreError("not_found", "transaction not found");
      }

      if (!actorId || (actorId !== existing.buyer_id && actorId !== existing.seller_id)) {
        throw new StoreError("forbidden", "only transaction participants can open a dispute");
      }

      if (existing.payout_released_at) {
        throw new StoreError("conflict", "cannot dispute a settled transaction");
      }

      if (existing.status === "disputed" && !existing.dispute_resolved_at) {
        return mapTransaction(existing);
      }

      if (existing.status !== "accepted") {
        throw new StoreError("conflict", `cannot dispute status '${existing.status}'`);
      }

      const timestamp = now().toISOString();
      const runOpenDispute = db.transaction(() => {
        const result = openDisputeStatement.run({
          id,
          dispute_opened_at: timestamp,
          updated_at: timestamp
        });

        if (result.changes !== 1) {
          throw new StoreError("conflict", "failed to open dispute");
        }

        const sourceEventId = appendTransactionEvent({
          transactionId: id,
          eventType: "dispute_opened",
          actorId,
          occurredAt: timestamp,
          payload: {}
        });
        const recipientUserId = actorId === existing.buyer_id ? existing.seller_id : existing.buyer_id;
        enqueueOutboxRecords({
          transactionId: id,
          sourceEventId,
          occurredAt: timestamp,
          records: [
            {
              topic: "action_required",
              recipientUserId: null,
              payload: {
                transactionId: id,
                action: "review_dispute"
              }
            },
            {
              topic: "dispute_update",
              recipientUserId,
              payload: {
                transactionId: id,
                eventType: "dispute_opened"
              }
            }
          ]
        });
      });
      runOpenDispute();

      return mapTransaction(getTransactionByIdQuery.get(id));
    },

    resolveDispute({ id }) {
      const existing = getTransactionByIdQuery.get(id);
      if (!existing) {
        throw new StoreError("not_found", "transaction not found");
      }

      if (existing.status !== "disputed") {
        throw new StoreError("conflict", "transaction does not have an open dispute");
      }

      const timestamp = now().toISOString();
      const runResolveDispute = db.transaction(() => {
        const result = resolveDisputeStatement.run({
          id,
          dispute_resolved_at: timestamp,
          updated_at: timestamp
        });

        if (result.changes !== 1) {
          throw new StoreError("conflict", "failed to resolve dispute");
        }

        const sourceEventId = appendTransactionEvent({
          transactionId: id,
          eventType: "dispute_resolved",
          actorId: "admin",
          occurredAt: timestamp,
          payload: {}
        });
        enqueueOutboxRecords({
          transactionId: id,
          sourceEventId,
          occurredAt: timestamp,
          records: [
            {
              topic: "dispute_update",
              recipientUserId: existing.buyer_id,
              payload: {
                transactionId: id,
                eventType: "dispute_resolved"
              }
            },
            {
              topic: "dispute_update",
              recipientUserId: existing.seller_id,
              payload: {
                transactionId: id,
                eventType: "dispute_resolved"
              }
            }
          ]
        });
      });
      runResolveDispute();

      return mapTransaction(getTransactionByIdQuery.get(id));
    },

    adjudicateDispute({ id, decision, decidedBy, notes }) {
      const existing = getTransactionByIdQuery.get(id);
      if (!existing) {
        throw new StoreError("not_found", "transaction not found");
      }

      if (!VALID_ADJUDICATION_DECISIONS.has(decision)) {
        throw new StoreError(
          "validation",
          "decision must be one of: release_to_seller, refund_to_buyer, cancel_transaction"
        );
      }

      if (!decidedBy || typeof decidedBy !== "string" || !decidedBy.trim()) {
        throw new StoreError("validation", "decidedBy is required");
      }

      if (existing.adjudication_decision) {
        throw new StoreError("conflict", "dispute already adjudicated");
      }

      if (existing.status !== "disputed") {
        throw new StoreError("conflict", "transaction does not have an open dispute");
      }

      if (existing.payout_released_at) {
        throw new StoreError("conflict", "cannot adjudicate a settled transaction");
      }

      const timestamp = now().toISOString();
      const updateParams = {
        id,
        dispute_resolved_at: timestamp,
        adjudication_decided_at: timestamp,
        adjudication_decided_by: decidedBy.trim(),
        adjudication_notes: notes ?? null,
        payout_released_at: timestamp,
        refund_issued_at: timestamp,
        cancelled_at: timestamp,
        updated_at: timestamp
      };

      const runAdjudicateDispute = db.transaction(() => {
        let result;
        if (decision === "release_to_seller") {
          result = adjudicateToReleaseSellerStatement.run(updateParams);
        } else if (decision === "refund_to_buyer") {
          result = adjudicateToRefundBuyerStatement.run(updateParams);
        } else {
          result = adjudicateToCancelTransactionStatement.run(updateParams);
        }

        if (result.changes !== 1) {
          throw new StoreError("conflict", "failed to adjudicate dispute");
        }

        const sourceEventId = appendTransactionEvent({
          transactionId: id,
          eventType: "dispute_adjudicated",
          actorId: decidedBy.trim(),
          occurredAt: timestamp,
          payload: {
            decision,
            notes: notes ?? null
          }
        });

        let settlementEventType = "settlement_completed";
        if (decision === "refund_to_buyer") {
          settlementEventType = "settlement_refunded";
        } else if (decision === "cancel_transaction") {
          settlementEventType = "settlement_cancelled";
        }
        appendTransactionEvent({
          transactionId: id,
          eventType: settlementEventType,
          actorId: decidedBy.trim(),
          occurredAt: timestamp,
          payload: { decision }
        });

        enqueueOutboxRecords({
          transactionId: id,
          sourceEventId,
          occurredAt: timestamp,
          records: [
            {
              topic: "dispute_update",
              recipientUserId: existing.buyer_id,
              payload: {
                transactionId: id,
                eventType: "dispute_adjudicated",
                decision
              }
            },
            {
              topic: "dispute_update",
              recipientUserId: existing.seller_id,
              payload: {
                transactionId: id,
                eventType: "dispute_adjudicated",
                decision
              }
            }
          ]
        });
      });
      runAdjudicateDispute();

      return mapTransaction(getTransactionByIdQuery.get(id));
    },

    runAutoRelease({ nowAt } = {}) {
      const cutoff = nowAt ? toIsoString(nowAt) : now().toISOString();
      const releasedIds = runAutoReleaseTransaction(cutoff);
      return {
        releasedCount: releasedIds.length,
        releasedTransactionIds: releasedIds,
        ranAt: cutoff
      };
    }
  };
}
