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

  const tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "grejiji-risk-int-"));
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

test("webhook intake throttles deterministically when over per-route limit", async () => {
  await withTestServer({}, async ({ request }) => {
    const makePayload = (index) => ({
      id: `evt_rate_limit_${index}`,
      type: "payment_intent.succeeded",
      data: {
        object: {
          id: `pi_test_${index}`,
          metadata: {
            transaction_id: `txn-rate-limit-${index}`
          }
        }
      }
    });

    let last = null;
    for (let index = 0; index < 130; index += 1) {
      last = await request("POST", "/webhooks/stripe", makePayload(index), null, {
        "stripe-signature": "t=1,v1=invalid"
      });
      if (last.response.status === 429) {
        break;
      }
    }
    assert.ok(last, "expected at least one webhook response");
    assert.equal(last.response.status, 429);
    assert.equal(last.payload.routeKey, "webhookIntake");
  });
});

test("admin hold/unhold and risk telemetry preserve transaction integrity", async () => {
  await withTestServer({}, async ({ request }) => {
    const seller = await request("POST", "/auth/register", {
      userId: "risk-seller-1",
      email: "risk-seller-1@example.com",
      password: "seller-password",
      role: "seller"
    });
    assert.equal(seller.response.status, 201);

    const buyer = await request("POST", "/auth/register", {
      userId: "risk-buyer-1",
      email: "risk-buyer-1@example.com",
      password: "buyer-password",
      role: "buyer"
    });
    assert.equal(buyer.response.status, 201);

    const admin = await request("POST", "/auth/register", {
      userId: "risk-admin-1",
      email: "risk-admin-1@example.com",
      password: "admin-password",
      role: "admin"
    });
    assert.equal(admin.response.status, 201);

    const badLogin = await request("POST", "/auth/login", {
      email: "risk-seller-1@example.com",
      password: "wrong-password"
    });
    assert.equal(badLogin.response.status, 403);

    const riskSignals = await request(
      "GET",
      "/admin/risk-signals?userId=risk-seller-1&signalType=auth_failures",
      undefined,
      admin.payload.token
    );
    assert.equal(riskSignals.response.status, 200);
    assert.ok(riskSignals.payload.signals.length >= 1);

    const created = await request(
      "POST",
      "/transactions",
      {
        transactionId: "txn-risk-1",
        sellerId: "risk-seller-1",
        amountCents: 12500
      },
      buyer.payload.token
    );
    assert.equal(created.response.status, 201);
    assert.equal(created.payload.transaction.status, "accepted");

    const held = await request(
      "POST",
      "/admin/transactions/txn-risk-1/risk/hold",
      { reason: "velocity anomaly under review", notes: "manual safeguard" },
      admin.payload.token
    );
    assert.equal(held.response.status, 200);
    assert.equal(held.payload.transaction.holdStatus, "held");

    const confirmWhileHeld = await request(
      "POST",
      "/transactions/txn-risk-1/confirm-delivery",
      {},
      buyer.payload.token
    );
    assert.equal(confirmWhileHeld.response.status, 409);
    assert.match(confirmWhileHeld.payload.error, /held/i);

    const riskDetail = await request(
      "GET",
      "/admin/transactions/txn-risk-1/risk",
      undefined,
      admin.payload.token
    );
    assert.equal(riskDetail.response.status, 200);
    assert.ok(riskDetail.payload.actions.some((action) => action.actionType === "hold"));

    const unheld = await request(
      "POST",
      "/admin/transactions/txn-risk-1/risk/unhold",
      { reason: "manual review cleared", notes: "allow progression" },
      admin.payload.token
    );
    assert.equal(unheld.response.status, 200);
    assert.equal(unheld.payload.transaction.holdStatus, "none");

    const confirmAfterUnhold = await request(
      "POST",
      "/transactions/txn-risk-1/confirm-delivery",
      {},
      buyer.payload.token
    );
    assert.equal(confirmAfterUnhold.response.status, 200);
    assert.equal(confirmAfterUnhold.payload.transaction.status, "completed");
  });
});
