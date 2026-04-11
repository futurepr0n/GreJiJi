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

function readEnv(envUpper, key) {
  return process.env[`${envUpper}_${key}`] ?? "";
}

const args = parseArgs(process.argv.slice(2));
const environment = String(args.env ?? "").trim().toLowerCase();
if (!["staging", "production"].includes(environment)) {
  console.error("Usage: node scripts/deploy/run-deploy.js --env <staging|production>");
  process.exit(2);
}

const envUpper = environment.toUpperCase();
const stateDir = path.resolve(process.cwd(), ".deploy-state");
const backupsDir = path.join(stateDir, "backups");
const manifestPath = path.join(stateDir, `${environment}.json`);
const now = new Date();
const timestamp = now.toISOString().replace(/[:.]/g, "-");

fs.mkdirSync(backupsDir, { recursive: true });

const baseUrl = readEnv(envUpper, "BASE_URL");
const databasePath = path.resolve(process.cwd(), readEnv(envUpper, "DATABASE_PATH"));
const webhookSecret = readEnv(envUpper, "STRIPE_WEBHOOK_SECRET");
const deployCommand = readEnv(envUpper, "DEPLOY_COMMAND");
const rollbackCommand = readEnv(envUpper, "ROLLBACK_COMMAND");
const skipPreSmoke = process.env.SKIP_PREDEPLOY_SMOKE === "1";

runCommand(`node scripts/deploy/validate-deploy-config.js --env ${environment}`);
runCommand(
  `node scripts/deploy/migration-preflight.js --database ${JSON.stringify(databasePath)} --migrations-dir ./migrations`
);

const smokeEnv = {
  ...process.env,
  BASE_URL: baseUrl,
  STRIPE_WEBHOOK_SECRET: webhookSecret
};

if (!skipPreSmoke) {
  runCommand("node scripts/deploy/synthetic-smoke.js", smokeEnv);
}

let backupPath = null;
if (fs.existsSync(databasePath)) {
  backupPath = path.join(backupsDir, `${environment}-${timestamp}.sqlite`);
  fs.copyFileSync(databasePath, backupPath);
}

const priorManifest = fs.existsSync(manifestPath)
  ? JSON.parse(fs.readFileSync(manifestPath, "utf8"))
  : null;

const nextManifest = {
  environment,
  updatedAt: now.toISOString(),
  baseUrl,
  databasePath,
  backupPath,
  deployCommand,
  rollbackCommand,
  previous: priorManifest
};
fs.writeFileSync(manifestPath, JSON.stringify(nextManifest, null, 2));

let deployFailed = false;
try {
  runCommand(deployCommand);
  runCommand("node scripts/deploy/synthetic-smoke.js", smokeEnv);
} catch (error) {
  deployFailed = true;
  console.error(
    JSON.stringify({
      event: "deploy.failed",
      environment,
      error: error instanceof Error ? error.message : String(error)
    })
  );

  if (backupPath && fs.existsSync(backupPath)) {
    fs.copyFileSync(backupPath, databasePath);
  }

  if (rollbackCommand) {
    runCommand(rollbackCommand);
  }

  runCommand("node scripts/deploy/synthetic-smoke.js", smokeEnv);
  throw error;
} finally {
  console.log(
    JSON.stringify({
      event: deployFailed ? "deploy.rolled_back" : "deploy.succeeded",
      environment,
      baseUrl,
      manifestPath,
      timestamp: new Date().toISOString()
    })
  );
}
