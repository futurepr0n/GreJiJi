import path from "node:path";
import { fileURLToPath } from "node:url";

import { createTransactionStore } from "../src/db.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.join(__dirname, "..");
const migrationsDirectory = path.join(projectRoot, "migrations");
const databasePath = process.env.DATABASE_PATH ?? path.join(projectRoot, "data", "grejiji.sqlite");
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
console.log(`Migrations verified at ${databasePath}`);
