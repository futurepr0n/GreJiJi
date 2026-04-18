import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const scriptPath = path.resolve(process.cwd(), "scripts/jenkins/preflight-deploy-secrets.sh");

function runPreflight({ envFileBody, env = {} }) {
  const sandboxDir = mkdtempSync(path.join(tmpdir(), "grejiji-jenkins-preflight-"));
  const envFilePath = path.join(sandboxDir, ".env");
  writeFileSync(envFilePath, envFileBody, "utf8");

  try {
    return spawnSync("bash", [scriptPath], {
      env: {
        ...process.env,
        ENV_FILE: envFilePath,
        ...env
      },
      encoding: "utf8"
    });
  } finally {
    rmSync(sandboxDir, { recursive: true, force: true });
  }
}

test("preflight fails when AUTH_TOKEN_SECRET is missing", () => {
  const result = runPreflight({
    envFileBody: "PAYMENT_PROVIDER=none\nAUTH_TOKEN_SECRET=\n"
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Missing required deploy secrets: AUTH_TOKEN_SECRET/i);
  assert.doesNotMatch(result.stderr, /test-secret|local-dev-secret-change-me/i);
});

test("preflight succeeds when AUTH_TOKEN_SECRET is present", () => {
  const result = runPreflight({
    envFileBody: "PAYMENT_PROVIDER=none\nAUTH_TOKEN_SECRET=test-secret\n"
  });

  assert.equal(result.status, 0);
  assert.match(result.stdout, /Required deploy secrets present: AUTH_TOKEN_SECRET/i);
});

test("preflight fails when AUTH_TOKEN_SECRET uses local development placeholder", () => {
  const result = runPreflight({
    envFileBody: "PAYMENT_PROVIDER=none\nAUTH_TOKEN_SECRET=local-dev-secret-change-me\n"
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Missing required deploy secrets: AUTH_TOKEN_SECRET/i);
  assert.match(result.stderr, /set non-placeholder Jenkins password parameters/i);
});
