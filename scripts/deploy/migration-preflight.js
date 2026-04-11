import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import Database from "better-sqlite3";

import { createTransactionStore } from "../../src/db.js";

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const value = argv[i];
    if (!value.startsWith("--")) {
      continue;
    }
    const key = value.slice(2);
    args[key] = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : true;
    if (args[key] !== true) {
      i += 1;
    }
  }
  return args;
}

function ensureParentDirectory(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function createSnapshot(sourcePath) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "grejiji-migration-check-"));
  const snapshotPath = path.join(tempDir, "migration-snapshot.sqlite");
  if (fs.existsSync(sourcePath)) {
    fs.copyFileSync(sourcePath, snapshotPath);
  }
  return { tempDir, snapshotPath };
}

function runMigrations({ databasePath, migrationsDirectory }) {
  const releaseTimeoutHours = Number(process.env.RELEASE_TIMEOUT_HOURS ?? 72);
  const serviceFeeFixedCents = Number(process.env.SERVICE_FEE_FIXED_CENTS ?? 0);
  const serviceFeeRateBps = Math.round(Number(process.env.SERVICE_FEE_PERCENT ?? 0) * 100);
  const settlementCurrency = String(process.env.SETTLEMENT_CURRENCY ?? "USD").toUpperCase();

  const store = createTransactionStore({
    databasePath,
    migrationsDirectory,
    releaseTimeoutHours,
    serviceFeeFixedCents,
    serviceFeeRateBps,
    settlementCurrency
  });
  store.close();
}

function listMigrationFiles(migrationsDirectory) {
  return fs
    .readdirSync(migrationsDirectory)
    .filter((name) => name.endsWith(".sql"))
    .sort();
}

function countAppliedMigrations(databasePath) {
  const db = new Database(databasePath);
  const row = db.prepare("SELECT COUNT(*) AS total FROM schema_migrations").get();
  db.close();
  return Number(row?.total ?? 0);
}

const args = parseArgs(process.argv.slice(2));
const databasePath = path.resolve(process.cwd(), String(args.database ?? process.env.DATABASE_PATH ?? "./data/grejiji.sqlite"));
const migrationsDirectory = path.resolve(process.cwd(), String(args["migrations-dir"] ?? "./migrations"));

if (!fs.existsSync(migrationsDirectory)) {
  console.error(`Migrations directory not found: ${migrationsDirectory}`);
  process.exit(2);
}

ensureParentDirectory(databasePath);

const { tempDir, snapshotPath } = createSnapshot(databasePath);
try {
  runMigrations({ databasePath: snapshotPath, migrationsDirectory });
  const firstPassCount = countAppliedMigrations(snapshotPath);
  runMigrations({ databasePath: snapshotPath, migrationsDirectory });
  const secondPassCount = countAppliedMigrations(snapshotPath);
  const migrationFiles = listMigrationFiles(migrationsDirectory);

  if (firstPassCount !== secondPassCount) {
    throw new Error(
      `Migration idempotency check failed: first=${firstPassCount}, second=${secondPassCount}`
    );
  }

  if (secondPassCount !== migrationFiles.length) {
    throw new Error(
      `Migration count mismatch: applied=${secondPassCount}, files=${migrationFiles.length}`
    );
  }

  console.log(
    JSON.stringify({
      event: "migration.preflight.passed",
      databasePath,
      snapshotPath,
      migrationsDirectory,
      appliedMigrations: secondPassCount,
      checkedAt: new Date().toISOString()
    })
  );
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}
