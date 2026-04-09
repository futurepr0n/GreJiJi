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
      updated_at = @updated_at
    WHERE id = @id
      AND status = 'disputed'
      AND payout_released_at IS NULL
      AND adjudication_decision IS NULL
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
      updated_at = @updated_at
    WHERE id = @id
      AND status = 'disputed'
      AND payout_released_at IS NULL
      AND adjudication_decision IS NULL
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
      updated_at = @updated_at
    WHERE id = @id
      AND status = 'disputed'
      AND payout_released_at IS NULL
      AND adjudication_decision IS NULL
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
