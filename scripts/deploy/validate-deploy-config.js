import fs from "node:fs";
import path from "node:path";

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

function parseEnvFile(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    return {};
  }

  const raw = fs.readFileSync(filePath, "utf8");
  const parsed = {};

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex <= 0) {
      continue;
    }
    const key = trimmed.slice(0, eqIndex).trim();
    const value = trimmed.slice(eqIndex + 1).trim();
    parsed[key] = value;
  }

  return parsed;
}

function readConfigValue({ envName, key, envFileValues }) {
  const prefixedKey = `${envName}_${key}`;
  return process.env[prefixedKey] ?? process.env[key] ?? envFileValues[key] ?? "";
}

function isPlaceholder(value) {
  if (typeof value !== "string") {
    return true;
  }
  const normalized = value.trim().toLowerCase();
  return (
    !normalized ||
    normalized === "change-me" ||
    normalized === "your-secret" ||
    normalized === "local-dev-secret-change-me"
  );
}

const args = parseArgs(process.argv.slice(2));
const environment = String(args.env ?? "").trim().toLowerCase();

if (!["staging", "production"].includes(environment)) {
  console.error("Usage: node scripts/deploy/validate-deploy-config.js --env <staging|production>");
  process.exit(2);
}

const envUpper = environment.toUpperCase();
const envFile = process.env[`${envUpper}_ENV_FILE`] ?? `.env.${environment}`;
const resolvedEnvFile = path.resolve(process.cwd(), envFile);
const envFileValues = parseEnvFile(resolvedEnvFile);

const requiredValues = [
  "BASE_URL",
  "DATABASE_PATH",
  "AUTH_TOKEN_SECRET",
  "STRIPE_WEBHOOK_SECRET",
  "DEPLOY_COMMAND",
  "ROLLBACK_COMMAND"
];

const missing = [];
for (const key of requiredValues) {
  const value = readConfigValue({ envName: envUpper, key, envFileValues });
  if (isPlaceholder(value)) {
    missing.push(`${envUpper}_${key}`);
  }
}

if (missing.length > 0) {
  console.error(JSON.stringify({
    event: "deploy.config.invalid",
    environment,
    envFile: fs.existsSync(resolvedEnvFile) ? resolvedEnvFile : null,
    missing
  }, null, 2));
  process.exit(1);
}

console.log(JSON.stringify({
  event: "deploy.config.valid",
  environment,
  envFile: fs.existsSync(resolvedEnvFile) ? resolvedEnvFile : null,
  checkedAt: new Date().toISOString()
}));
