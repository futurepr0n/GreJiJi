import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createServer } from "../../src/server.js";

async function withTestServer(fn) {
  const tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "grejiji-trust-v7-int-"));
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

test("trust operations v7: fulfillment integrity, escrow arbitration, and experiment guardrails", async () => {
  await withTestServer(async ({ request, registerUser }) => {
    const buyer = await registerUser("trust-v7-buyer", "buyer");
    const seller = await registerUser("trust-v7-seller", "seller");
    const admin = await registerUser("trust-v7-admin", "admin");

    const created = await request(
      "POST",
      "/transactions",
      {
        transactionId: "txn-trust-v7-dispute",
        sellerId: seller.user.id,
        amountCents: 42000
      },
      buyer.token
    );
    assert.equal(created.response.status, 201);

    const opened = await request(
      "POST",
      "/transactions/txn-trust-v7-dispute/disputes",
      {},
      buyer.token
    );
    assert.equal(opened.response.status, 200);

    const duplicateContentBase64 = Buffer.from("duplicate-proof-content", "utf8").toString("base64");
    const firstEvidence = await request(
      "POST",
      "/transactions/txn-trust-v7-dispute/disputes/evidence",
      {
        evidenceId: "ev-v7-1",
        fileName: "photo.png",
        mimeType: "application/pdf",
        contentBase64: duplicateContentBase64
      },
      buyer.token
    );
    assert.equal(firstEvidence.response.status, 201);
    assert.equal(typeof firstEvidence.payload.evidence.integrity.metadataConsistencyScore, "number");

    const secondEvidence = await request(
      "POST",
      "/transactions/txn-trust-v7-dispute/disputes/evidence",
      {
        evidenceId: "ev-v7-2",
        fileName: "photo-copy.png",
        mimeType: "application/pdf",
        contentBase64: duplicateContentBase64
      },
      seller.token
    );
    assert.equal(secondEvidence.response.status, 201);
    assert.equal(secondEvidence.payload.evidence.integrity.duplicateWithinTransaction, true);

    const createdPolicy = await request(
      "POST",
      "/admin/trust-operations/policies",
      {
        name: "trust-v7-arbitration-guardrails-1",
        policy: {
          autoHoldRiskScore: 35,
          clearRiskScore: 20,
          holdDurationHours: 24,
          reserveRiskScore: 30,
          manualReviewRiskScore: 45,
          reservePercent: 25,
          integrityLookbackDays: 30,
          networkRiskWeight: 45,
          propagationDecayHours: 168,
          v5Enabled: true,
          v6Enabled: true,
          v7Enabled: true,
          evidenceConfidenceWeight: 40,
          arbitrationAutoReleaseRiskScore: 25,
          arbitrationDelayedReleaseRiskScore: 55,
          arbitrationDelayHours: 12,
          experimentTrafficCapPercent: 100,
          experimentKillSwitchAppealOverturnRate: 0.1,
          experimentKillSwitchRollbackFrequency: 2,
          experimentKillSwitchFalsePositiveReleaseRate: 0.3
        },
        cohort: {
          minAmountCents: 5000,
          maxAmountCents: 100000
        }
      },
      admin.token
    );
    assert.equal(createdPolicy.response.status, 201);
    const policyVersionId = createdPolicy.payload.policyVersion.id;

    const activated = await request(
      "POST",
      `/admin/trust-operations/policies/${policyVersionId}/activate`,
      {},
      admin.token
    );
    assert.equal(activated.response.status, 200);

    const disputeDetail = await request(
      "GET",
      "/admin/disputes/txn-trust-v7-dispute",
      undefined,
      admin.token
    );
    assert.equal(disputeDetail.response.status, 200);
    assert.equal(typeof disputeDetail.payload.dispute.evidenceComparison.buyerEvidenceCount, "number");
    assert.ok(Array.isArray(disputeDetail.payload.dispute.finalDecisionActions));

    const adjudicated = await request(
      "POST",
      "/transactions/txn-trust-v7-dispute/disputes/adjudicate",
      {
        decision: "refund_to_buyer",
        reasonCode: "evidence_conflict",
        notes: "conflicting fulfillment proofs"
      },
      admin.token
    );
    assert.equal(adjudicated.response.status, 200);
    assert.equal(adjudicated.payload.decisionTransparency.policyReasonCategory, "evidence_conflict");

    const autoTxn = await request(
      "POST",
      "/transactions",
      {
        transactionId: "txn-trust-v7-auto-release",
        sellerId: seller.user.id,
        amountCents: 47000
      },
      buyer.token
    );
    assert.equal(autoTxn.response.status, 201);

    for (let index = 0; index < 4; index += 1) {
      const invalidWebhook = await request(
        "POST",
        "/webhooks/stripe",
        {
          id: `evt_trust_v7_invalid_${index}`,
          type: "payment_intent.succeeded",
          data: {
            object: {
              id: `pi_trust_v7_${index}`,
              metadata: {
                transaction_id: "txn-trust-v7-auto-release"
              }
            }
          }
        },
        null,
        { "stripe-signature": "t=1,v1=invalid" }
      );
      assert.equal(invalidWebhook.response.status, 400);
    }

    const autoRelease = await request(
      "POST",
      "/jobs/auto-release",
      { nowAt: "2030-01-01T00:00:00.000Z" },
      admin.token
    );
    assert.equal(autoRelease.response.status, 200);
    assert.equal(typeof autoRelease.payload.delayedCount, "number");
    assert.equal(typeof autoRelease.payload.manualReviewCount, "number");

    const overturnedFeedback = await request(
      "POST",
      "/admin/trust-operations/feedback",
      {
        transactionId: "txn-trust-v7-dispute",
        feedbackType: "dispute_outcome",
        outcome: "appeal_overturned_after_manual_review",
        details: { source: "integration_test" }
      },
      admin.token
    );
    assert.equal(overturnedFeedback.response.status, 201);

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
    assert.equal(typeof recompute.payload.guardrails.triggered, "boolean");

    const dashboard = await request(
      "GET",
      "/admin/trust-operations/dashboard?lookbackHours=168",
      undefined,
      admin.token
    );
    assert.equal(dashboard.response.status, 200);
    assert.equal(typeof dashboard.payload.metrics.policyGuardrails.appealOverturnRate, "number");
  });
});
