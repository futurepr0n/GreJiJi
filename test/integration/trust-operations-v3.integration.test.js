import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createServer } from "../../src/server.js";

async function withTestServer(fn) {
  const tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "grejiji-trust-v3-int-"));
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

  async function registerUser(userId, role) {
    const result = await request("POST", "/auth/register", {
      userId,
      email: `${userId}@example.com`,
      password: `${role}-password`,
      role
    });
    assert.equal(result.response.status, 201);
    return result.payload;
  }

  try {
    await fn({ request, registerUser });
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    await fs.rm(tempDirectory, { recursive: true, force: true });
  }
}

test("trust operations v3: policy sweep creates queue case, applies hold, and supports operator clear", async () => {
  await withTestServer(async ({ request, registerUser }) => {
    const buyer = await registerUser("trust-v3-buyer", "buyer");
    const seller = await registerUser("trust-v3-seller", "seller");
    const admin = await registerUser("trust-v3-admin", "admin");

    const created = await request(
      "POST",
      "/transactions",
      {
        transactionId: "txn-trust-v3-1",
        sellerId: seller.user.id,
        amountCents: 18000
      },
      buyer.token
    );
    assert.equal(created.response.status, 201);

    for (let index = 0; index < 3; index += 1) {
      const invalidWebhook = await request(
        "POST",
        "/webhooks/stripe",
        {
          id: `evt_trust_v3_invalid_${index}`,
          type: "payment_intent.succeeded",
          data: {
            object: {
              id: `pi_trust_v3_${index}`,
              metadata: {
                transaction_id: "txn-trust-v3-1"
              }
            }
          }
        },
        null,
        { "stripe-signature": "t=1,v1=invalid" }
      );
      assert.equal(invalidWebhook.response.status, 400);
    }

    const recompute = await request(
      "POST",
      "/jobs/trust-operations/recompute",
      {
        limit: 50,
        policy: {
          autoHoldRiskScore: 70,
          clearRiskScore: 30,
          holdDurationHours: 24
        },
        apply: true
      },
      admin.token
    );
    assert.equal(recompute.response.status, 200);
    assert.ok(recompute.payload.applied.holds >= 1);

    const transactionRisk = await request(
      "GET",
      "/admin/transactions/txn-trust-v3-1/risk",
      undefined,
      admin.token
    );
    assert.equal(transactionRisk.response.status, 200);
    assert.equal(transactionRisk.payload.transaction.holdStatus, "held");

    const queue = await request(
      "GET",
      "/admin/trust-operations/cases?status=open",
      undefined,
      admin.token
    );
    assert.equal(queue.response.status, 200);
    assert.ok(queue.payload.cases.length >= 1);
    const trustCase = queue.payload.cases.find((item) => item.transactionId === "txn-trust-v3-1");
    assert.ok(trustCase);

    const details = await request(
      "GET",
      `/admin/trust-operations/cases/${trustCase.id}`,
      undefined,
      admin.token
    );
    assert.equal(details.response.status, 200);
    assert.ok(details.payload.events.some((event) => event.eventType === "auto_hold_applied"));

    const simulate = await request(
      "POST",
      "/admin/trust-operations/simulate-policy",
      {
        limit: 10,
        policy: {
          autoHoldRiskScore: 100,
          clearRiskScore: 100,
          holdDurationHours: 24
        }
      },
      admin.token
    );
    assert.equal(simulate.response.status, 200);
    const simulated = simulate.payload.items.find((item) => item.transaction.id === "txn-trust-v3-1");
    assert.ok(simulated);
    assert.equal(simulated.decision.recommendedAction, "clear");

    const cleared = await request(
      "POST",
      `/admin/trust-operations/cases/${trustCase.id}/override`,
      {
        action: "clear",
        reasonCode: "false_positive_after_review",
        notes: "signals were test noise"
      },
      admin.token
    );
    assert.equal(cleared.response.status, 200);
    assert.equal(cleared.payload.trustCase.status, "resolved");

    const transactionAfterClear = await request(
      "GET",
      "/admin/transactions/txn-trust-v3-1/risk",
      undefined,
      admin.token
    );
    assert.equal(transactionAfterClear.response.status, 200);
    assert.equal(transactionAfterClear.payload.transaction.holdStatus, "none");

    const badPolicy = await request(
      "POST",
      "/jobs/trust-operations/recompute",
      {
        policy: {
          autoHoldRiskScore: 60,
          clearRiskScore: 70,
          holdDurationHours: 24
        }
      },
      admin.token
    );
    assert.equal(badPolicy.response.status, 400);
  });
});
