import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const scriptPath = path.resolve(process.cwd(), "scripts/deploy/validate-deploy-config.js");

function runValidate({ env, envFileBody }) {
  const sandboxDir = mkdtempSync(path.join(tmpdir(), "grejiji-deploy-validate-"));
  const envFilePath = path.join(sandboxDir, ".env.staging");
  writeFileSync(envFilePath, envFileBody, "utf8");

  try {
    return spawnSync("node", [scriptPath, "--env", "staging"], {
      env: {
        ...process.env,
        STAGING_ENV_FILE: envFilePath,
        ...env
      },
      encoding: "utf8"
    });
  } finally {
    rmSync(sandboxDir, { recursive: true, force: true });
  }
}

test("deploy config validation fails when staging auth secret is placeholder", () => {
  const result = runValidate({
    env: {},
    envFileBody: [
      "BASE_URL=https://staging.example.com",
      "DATABASE_PATH=/var/lib/grejiji/staging.sqlite",
      "AUTH_TOKEN_SECRET=local-dev-secret-change-me",
      "STRIPE_WEBHOOK_SECRET=whsec_123",
      "DEPLOY_COMMAND=./deploy.sh",
      "ROLLBACK_COMMAND=./rollback.sh"
    ].join("\n")
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /deploy\.config\.invalid/i);
  assert.match(result.stderr, /STAGING_AUTH_TOKEN_SECRET/i);
});

test("deploy config validation succeeds when staging auth secret is non-placeholder", () => {
  const result = runValidate({
    env: {},
    envFileBody: [
      "BASE_URL=https://staging.example.com",
      "DATABASE_PATH=/var/lib/grejiji/staging.sqlite",
      "AUTH_TOKEN_SECRET=staging-auth-token-secret",
      "STRIPE_WEBHOOK_SECRET=whsec_123",
      "DEPLOY_COMMAND=./deploy.sh",
      "ROLLBACK_COMMAND=./rollback.sh"
    ].join("\n")
  });

  assert.equal(result.status, 0);
  assert.match(result.stdout, /deploy\.config\.valid/i);
});
