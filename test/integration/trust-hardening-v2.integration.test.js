import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createServer } from "../../src/server.js";

async function withTestServer(envOverrides, fn) {
  const original = new Map();
  for (const [key, value] of Object.entries(envOverrides ?? {})) {
    original.set(key, process.env[key]);
    process.env[key] = String(value);
  }

  const tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "grejiji-trust-v2-int-"));
  const databasePath = path.join(tempDirectory, "test.sqlite");
  const evidenceStoragePath = path.join(tempDirectory, "evidence");
  const server = createServer({ databasePath, evidenceStoragePath });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  const baseUrl = `http://127.0.0.1:${port}`;

  async function request(method, endpoint, body, token, extraHeaders = {}) {
    const headers = {
      "Content-Type": "application/json",
      ...extraHeaders
    };
    if (token) {
      headers.authorization = `Bearer ${token}`;
    }

    const response = await fetch(`${baseUrl}${endpoint}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body)
    });

    let payload = {};
    try {
      payload = await response.json();
    } catch {
      payload = {};
    }

    return { response, payload };
  }

  try {
    await fn({ request });
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    await fs.rm(tempDirectory, { recursive: true, force: true });
    for (const [key, value] of original.entries()) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

async function registerUser(request, userId, role) {
  const result = await request("POST", "/auth/register", {
    userId,
    email: `${userId}@example.com`,
    password: `${role}-password`,
    role
  });
  assert.equal(result.response.status, 201);
  return result.payload;
}

async function submitAndApproveVerification(request, userToken, adminToken, userId) {
  const submitted = await request(
    "POST",
    "/accounts/me/verification-submissions",
    {
      evidence: {
        documentType: "government_id",
        countryCode: "CA"
      }
    },
    userToken
  );
  assert.equal(submitted.response.status, 200);
  assert.equal(submitted.payload.account.verificationStatus, "pending");

  const approved = await request(
    "POST",
    `/admin/accounts/${encodeURIComponent(userId)}/verification/approve`,
    { reason: "manual_review_passed", notes: "identity matched" },
    adminToken
  );
  assert.equal(approved.response.status, 200);
  assert.equal(approved.payload.account.verificationStatus, "verified");
}

test("trust hardening v2: verification workflow and risk-tier overrides gate high-value initiation", async () => {
  await withTestServer({}, async ({ request }) => {
    const buyer = await registerUser(request, "trust-buyer-1", "buyer");
    const seller = await registerUser(request, "trust-seller-1", "seller");
    const admin = await registerUser(request, "trust-admin-1", "admin");

    const blockedUnverified = await request(
      "POST",
      "/transactions",
      {
        transactionId: "txn-trust-v2-unverified-block",
        sellerId: "trust-seller-1",
        amountCents: 90000
      },
      buyer.token
    );
    assert.equal(blockedUnverified.response.status, 403);
    assert.match(blockedUnverified.payload.error, /risk policy/i);

    await submitAndApproveVerification(request, buyer.token, admin.token, "trust-buyer-1");
    await submitAndApproveVerification(request, seller.token, admin.token, "trust-seller-1");

    const queue = await request("GET", "/admin/verification-submissions?status=pending", undefined, admin.token);
    assert.equal(queue.response.status, 200);
    assert.equal(queue.payload.accounts.length, 0);

    const override = await request(
      "POST",
      "/admin/accounts/trust-seller-1/risk/override-tier",
      { tier: "high", reason: "chargeback cluster", notes: "temporary clamp" },
      admin.token
    );
    assert.equal(override.response.status, 200);
    assert.equal(override.payload.account.riskTier, "high");

    const blockedByTier = await request(
      "POST",
      "/transactions",
      {
        transactionId: "txn-trust-v2-high-tier-block",
        sellerId: "trust-seller-1",
        amountCents: 120000
      },
      buyer.token
    );
    assert.equal(blockedByTier.response.status, 403);

    const limits = await request(
      "GET",
      "/admin/accounts/trust-seller-1/risk/limits?checkpoint=transaction_initiation&limit=10",
      undefined,
      admin.token
    );
    assert.equal(limits.response.status, 200);
    assert.ok(limits.payload.decisions.some((entry) => entry.decision === "deny"));

    const verificationAudit = await request(
      "GET",
      "/admin/accounts/trust-seller-1/verification",
      undefined,
      admin.token
    );
    assert.equal(verificationAudit.response.status, 200);
    assert.ok(verificationAudit.payload.events.length >= 2);

    const cleared = await request(
      "POST",
      "/admin/accounts/trust-seller-1/risk/clear-tier-override",
      { reason: "post-incident normalization" },
      admin.token
    );
    assert.equal(cleared.response.status, 200);
  });
});

test("trust hardening v2: payout cooldown blocks release until tier override is downgraded", async () => {
  await withTestServer(
    {
      RISK_LIMIT_LOW_PAYOUT_COOLDOWN_HOURS: 0,
      RISK_LIMIT_MEDIUM_PAYOUT_COOLDOWN_HOURS: 0
    },
    async ({ request }) => {
    const buyer = await registerUser(request, "trust-buyer-2", "buyer");
    const seller = await registerUser(request, "trust-seller-2", "seller");
    const admin = await registerUser(request, "trust-admin-2", "admin");

    await submitAndApproveVerification(request, buyer.token, admin.token, "trust-buyer-2");
    await submitAndApproveVerification(request, seller.token, admin.token, "trust-seller-2");

    const override = await request(
      "POST",
      "/admin/accounts/trust-seller-2/risk/override-tier",
      { tier: "high", reason: "fraud review hold" },
      admin.token
    );
    assert.equal(override.response.status, 200);

    const created = await request(
      "POST",
      "/transactions",
      {
        transactionId: "txn-trust-v2-cooldown",
        sellerId: "trust-seller-2",
        amountCents: 50000
      },
      buyer.token
    );
    assert.equal(created.response.status, 201);

    const blockedPayout = await request(
      "POST",
      "/transactions/txn-trust-v2-cooldown/confirm-delivery",
      {},
      buyer.token
    );
    assert.equal(blockedPayout.response.status, 403);
    assert.match(blockedPayout.payload.error, /payout_release/i);

    const downgradeOverride = await request(
      "POST",
      "/admin/accounts/trust-seller-2/risk/override-tier",
      { tier: "low", reason: "manual review complete" },
      admin.token
    );
    assert.equal(downgradeOverride.response.status, 200);

    const confirmed = await request(
      "POST",
      "/transactions/txn-trust-v2-cooldown/confirm-delivery",
      {},
      buyer.token
    );
    assert.equal(confirmed.response.status, 200);
    assert.equal(confirmed.payload.transaction.status, "completed");
    }
  );
});
