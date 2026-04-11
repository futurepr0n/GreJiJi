import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

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

function runCommand(command, env = process.env) {
  const result = spawnSync(command, {
    stdio: "inherit",
    shell: true,
    env
  });

  if (result.status !== 0) {
    throw new Error(`Command failed (${result.status}): ${command}`);
  }
}

const args = parseArgs(process.argv.slice(2));
const environment = String(args.env ?? "").trim().toLowerCase();
if (!["staging", "production"].includes(environment)) {
  console.error("Usage: node scripts/deploy/run-rollback.js --env <staging|production>");
  process.exit(2);
}

const envUpper = environment.toUpperCase();
const manifestPath = path.resolve(process.cwd(), ".deploy-state", `${environment}.json`);
if (!fs.existsSync(manifestPath)) {
  console.error(`Rollback manifest not found: ${manifestPath}`);
  process.exit(1);
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const baseUrl = process.env[`${envUpper}_BASE_URL`] ?? manifest.baseUrl;
const databasePath = path.resolve(
  process.cwd(),
  process.env[`${envUpper}_DATABASE_PATH`] ?? manifest.databasePath
);
const backupPath = manifest.backupPath;
const rollbackCommand =
  process.env[`${envUpper}_ROLLBACK_COMMAND`] ?? manifest.rollbackCommand ?? "";
const webhookSecret =
  process.env[`${envUpper}_STRIPE_WEBHOOK_SECRET`] ?? process.env.STRIPE_WEBHOOK_SECRET ?? "";

if (!rollbackCommand) {
  console.error(`${envUpper}_ROLLBACK_COMMAND is required for rollback.`);
  process.exit(1);
}

if (backupPath && fs.existsSync(backupPath)) {
  fs.mkdirSync(path.dirname(databasePath), { recursive: true });
  fs.copyFileSync(backupPath, databasePath);
}

runCommand(rollbackCommand);
runCommand("node scripts/deploy/synthetic-smoke.js", {
  ...process.env,
  BASE_URL: baseUrl,
  STRIPE_WEBHOOK_SECRET: webhookSecret
});

console.log(
  JSON.stringify({
    event: "rollback.succeeded",
    environment,
    baseUrl,
    backupPath,
    manifestPath,
    timestamp: new Date().toISOString()
  })
);
