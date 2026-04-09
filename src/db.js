import fs from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";

const VALID_STATUSES = new Set(["accepted", "disputed", "completed"]);

function ensureParentDirectory(filePath) {
  const directory = path.dirname(filePath);
  fs.mkdirSync(directory, { recursive: true });
}

function assertValidStatus(status) {
  if (!VALID_STATUSES.has(status)) {
    throw new Error(`Unexpected transaction status: ${status}`);
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

  return {
    id: row.id,
    buyerId: row.buyer_id,
    sellerId: row.seller_id,
    amountCents: row.amount_cents,
    status: row.status,
    acceptedAt: row.accepted_at,
    autoReleaseDueAt: row.auto_release_due_at,
    buyerConfirmedAt: row.buyer_confirmed_at,
    autoReleasedAt: row.auto_released_at,
    payoutReleasedAt: row.payout_released_at,
    payoutReleaseReason: row.payout_release_reason,
    disputeOpenedAt: row.dispute_opened_at,
    disputeResolvedAt: row.dispute_resolved_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function createTransactionStore({
  databasePath,
  migrationsDirectory,
  releaseTimeoutHours = 72,
  now = () => new Date()
}) {
  ensureParentDirectory(databasePath);

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
      'accepted',
      @accepted_at,
      @auto_release_due_at,
      @created_at,
      @updated_at
    )
  `);

  const getTransactionByIdQuery = db.prepare("SELECT * FROM transactions WHERE id = ?");

  const markConfirmed = db.prepare(`
    UPDATE transactions
    SET
      status = 'completed',
      buyer_confirmed_at = @buyer_confirmed_at,
      payout_released_at = @payout_released_at,
      payout_release_reason = 'buyer_confirmation',
      updated_at = @updated_at
    WHERE id = @id
      AND status = 'accepted'
      AND payout_released_at IS NULL
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
      updated_at = @updated_at
    WHERE id = @id
      AND status = 'accepted'
      AND payout_released_at IS NULL
  `);

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
        releasedIds.push(row.id);
      }
    }

    return releasedIds;
  });

  return {
    close() {
      db.close();
    },

    createAcceptedTransaction({ id, buyerId, sellerId, amountCents, acceptedAt }) {
      if (!id || !buyerId || !sellerId) {
        throw new StoreError(
          "validation",
          "id, buyerId, and sellerId are required to create a transaction"
        );
      }

      if (!Number.isInteger(amountCents) || amountCents <= 0) {
        throw new StoreError("validation", "amountCents must be a positive integer");
      }

      const acceptedAtIso = acceptedAt ? toIsoString(acceptedAt) : now().toISOString();
      const autoReleaseDueAt = addHours(acceptedAtIso, releaseTimeoutHours);
      const timestamp = now().toISOString();

      try {
        insertTransaction.run({
          id,
          buyer_id: buyerId,
          seller_id: sellerId,
          amount_cents: amountCents,
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

      return mapTransaction(getTransactionByIdQuery.get(id));
    },

    getTransactionById(id) {
      return mapTransaction(getTransactionByIdQuery.get(id));
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
      const result = markConfirmed.run({
        id,
        buyer_confirmed_at: timestamp,
        payout_released_at: timestamp,
        updated_at: timestamp
      });

      if (result.changes !== 1) {
        throw new StoreError("conflict", "transaction confirmation preconditions failed");
      }

      return mapTransaction(getTransactionByIdQuery.get(id));
    },

    openDispute({ id }) {
      const existing = getTransactionByIdQuery.get(id);
      if (!existing) {
        throw new StoreError("not_found", "transaction not found");
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
      const result = openDisputeStatement.run({
        id,
        dispute_opened_at: timestamp,
        updated_at: timestamp
      });

      if (result.changes !== 1) {
        throw new StoreError("conflict", "failed to open dispute");
      }

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
      const result = resolveDisputeStatement.run({
        id,
        dispute_resolved_at: timestamp,
        updated_at: timestamp
      });

      if (result.changes !== 1) {
        throw new StoreError("conflict", "failed to resolve dispute");
      }

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
