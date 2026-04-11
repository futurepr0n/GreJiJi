import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createServer } from "../../src/server.js";

async function withTestServer(fn) {
  const tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "grejiji-trust-v5-int-"));
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

test("trust operations v5: integrity scoring, payout-risk timeline, and metrics endpoints", async () => {
  await withTestServer(async ({ request, registerUser }) => {
    const buyer = await registerUser("trust-v5-buyer", "buyer");
    const seller = await registerUser("trust-v5-seller", "seller");
    const admin = await registerUser("trust-v5-admin", "admin");

    const created = await request(
      "POST",
      "/transactions",
      {
        transactionId: "txn-trust-v5-1",
        sellerId: seller.user.id,
        amountCents: 26000
      },
      buyer.token
    );
    assert.equal(created.response.status, 201);

    for (let index = 0; index < 4; index += 1) {
      const invalidWebhook = await request(
        "POST",
        "/webhooks/stripe",
        {
          id: `evt_trust_v5_invalid_${index}`,
          type: "payment_intent.succeeded",
          data: {
            object: {
              id: `pi_trust_v5_${index}`,
              metadata: {
                transaction_id: "txn-trust-v5-1"
              }
            }
          }
        },
        null,
        { "stripe-signature": "t=1,v1=invalid" }
      );
      assert.equal(invalidWebhook.response.status, 400);
    }

    const createdPolicy = await request(
      "POST",
      "/admin/trust-operations/policies",
      {
        name: "trust-v5-integrity-payout-risk-1",
        policy: {
          autoHoldRiskScore: 40,
          clearRiskScore: 20,
          holdDurationHours: 24,
          reserveRiskScore: 30,
          manualReviewRiskScore: 40,
          reservePercent: 35,
          integrityLookbackDays: 30
        },
        cohort: {
          minAmountCents: 10000,
          maxAmountCents: 40000
        }
      },
      admin.token
    );
    assert.equal(createdPolicy.response.status, 201);
    const policyVersionId = createdPolicy.payload.policyVersion.id;

    const backtest = await request(
      "POST",
      "/admin/trust-operations/backtest",
      {
        policyVersionId,
        limit: 50
      },
      admin.token
    );
    assert.equal(backtest.response.status, 200);
    assert.equal(typeof backtest.payload.impactSummary.payoutActions.manualReview, "number");
    assert.equal(typeof backtest.payload.payoutImpactDelta.manualReviewDelta, "number");

    const recompute = await request(
      "POST",
      "/jobs/trust-operations/recompute",
      {
        policyVersionId,
        apply: true,
        limit: 50
      },
      admin.token
    );
    assert.equal(recompute.response.status, 200);
    assert.ok(recompute.payload.applied.casesCreated >= 1);

    const queue = await request(
      "GET",
      "/admin/trust-operations/cases?status=open",
      undefined,
      admin.token
    );
    assert.equal(queue.response.status, 200);
    const trustCase = queue.payload.cases.find((item) => item.transactionId === "txn-trust-v5-1");
    assert.ok(trustCase);
    assert.equal(typeof trustCase.sellerIntegrityScoreAtTrigger, "number");
    assert.equal(typeof trustCase.payoutAction, "string");

    const caseDetail = await request(
      "GET",
      `/admin/trust-operations/cases/${trustCase.id}`,
      undefined,
      admin.token
    );
    assert.equal(caseDetail.response.status, 200);
    assert.ok(Array.isArray(caseDetail.payload.payoutTimeline));
    assert.ok(caseDetail.payload.payoutTimeline.length >= 1);

    const override = await request(
      "POST",
      `/admin/trust-operations/cases/${trustCase.id}/override`,
      {
        action: "hold",
        reasonCode: "manual_investigation_hold",
        notes: "temporary payout gate pending evidence review",
        overrideExpiresInHours: 12
      },
      admin.token
    );
    assert.equal(override.response.status, 200);
    assert.ok(override.payload.trustCase.overrideExpiresAt);

    const integrity = await request(
      "GET",
      `/admin/accounts/${seller.user.id}/integrity?lookbackDays=30`,
      undefined,
      admin.token
    );
    assert.equal(integrity.response.status, 200);
    assert.equal(typeof integrity.payload.integrity.integrityScore, "number");

    const payoutMetrics = await request(
      "GET",
      "/admin/trust-operations/payout-risk/metrics?lookbackHours=48",
      undefined,
      admin.token
    );
    assert.equal(payoutMetrics.response.status, 200);
    assert.equal(typeof payoutMetrics.payload.payoutRiskQuality.falsePositiveReleaseRate, "number");
    assert.equal(typeof payoutMetrics.payload.payoutRiskQuality.preventedLossEstimateCents, "number");
    assert.equal(typeof payoutMetrics.payload.payoutRiskQuality.overrideDriftRate, "number");

    const dashboard = await request(
      "GET",
      "/admin/trust-operations/dashboard?lookbackHours=48",
      undefined,
      admin.token
    );
    assert.equal(dashboard.response.status, 200);
    assert.equal(typeof dashboard.payload.metrics.payoutRiskQuality.falsePositiveReleaseRate, "number");
  });
});
